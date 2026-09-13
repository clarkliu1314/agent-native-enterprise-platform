import type { CorrelationContext, ObservabilityLogger, StructuredLogEvent } from '../packages/observability/src/index.js';
import { classifyError, createStructuredLogEvent, safeEmit } from '../packages/observability/src/index.js';
import type { AdapterRunResult, QueueConsumer, QueuePublisher, RuntimeAdapter } from '../packages/runtime/src/ports.js';
import { DurableRuntimeService, DurableWorker, OutboxPublisher, PostgresDatabase, PostgresOutboxRepository, PostgresToolRepositories, ToolExecutionService } from '../packages/runtime/src/index.js';
import { createDurableHandler } from '../apps/api/src/durable-handler.js';

export interface ProductionScenarioResult { httpStatus: number; events: StructuredLogEvent[]; serializedTelemetry: string; businessResult: { status: string }; telemetryErrors: number; durableRun: { runId: string; state: string }; durableToolCall: { toolName: string; status: string }; publishedOutboxCount: number; }

export async function runProductionObservabilityScenario(input: CorrelationContext & { toolName?: string; secretInput?: string; failTelemetry?: boolean }): Promise<ProductionScenarioResult> {
  const db = new PostgresDatabase();
  const repos = new PostgresToolRepositories(db);
  const events: StructuredLogEvent[] = [];
  let telemetryErrors = 0;
  const logger: ObservabilityLogger = { emit: (event) => { if (input.failTelemetry) { telemetryErrors += 1; throw new Error('telemetry unavailable'); } events.push(event); } };
  const runId = input.runId;
  const requestId = input.requestId;
  const toolName = input.toolName ?? 'crm.create_company';
  const idempotencyKey = `prod-observability:${runId}`;
  const toolCallId = `${runId}:tool:1`;
  await cleanupProductionScenario(db, runId, idempotencyKey);

  const adapter: RuntimeAdapter = {
    name: 'production-observability-test-adapter', version: '1.0.0',
    async run({ run, signal }): Promise<AdapterRunResult> {
      if (signal?.aborted) return { kind: 'FAILED', error: 'execution_aborted' };
      const correlation = readCorrelation(run.metadata, run.runId, run.agentId);
      const tool = new ToolExecutionService(repos, { authorize: async () => true }, { invoke: async ({ toolName: name, input: toolInput }) => ({ status: 'SUCCEEDED', toolName: name, received: toolInput }) });
      const toolContext = { ...correlation, runId: run.runId, agentId: run.agentId };
      safeEmit(logger, createStructuredLogEvent({ context: toolContext, event: 'tool.started', level: 'INFO', outcome: 'STARTED', attributes: { toolName } }));
      try {
        const output = await tool.execute({ runId: run.runId, agentId: run.agentId, owner: 'worker-prod-e2e', fencingToken: run.fencingToken, toolCallId, toolName, kind: 'SIDE_EFFECTING', input: { secret: input.secretInput ?? 'no-secret' }, idempotencyKey: `tool:${runId}` });
        safeEmit(logger, createStructuredLogEvent({ context: toolContext, event: 'tool.succeeded', level: 'INFO', outcome: 'SUCCEEDED', attributes: { toolName } }));
        await repos.appendEventAndOutbox({ runId: run.runId, fencingToken: run.fencingToken, type: 'TOOL_EXECUTION_SUCCEEDED', payload: { toolName, output }, topic: 'agent.tool' });
        return { kind: 'SUCCEEDED', output };
      } catch (error) {
        safeEmit(logger, createStructuredLogEvent({ context: toolContext, event: 'tool.failed', level: 'ERROR', outcome: 'FAILED', errorCode: classifyError(error), attributes: { toolName } }));
        return { kind: 'FAILED', error: error instanceof Error ? error.message : String(error) };
      }
    },
    serializeCheckpoint: (state) => new TextEncoder().encode(JSON.stringify(state)),
    deserializeCheckpoint: (payload) => JSON.parse(new TextDecoder().decode(payload)),
  };

  const runtime = new DurableRuntimeService(repos, { adapter, ids: { next: (prefix) => prefix === 'run' ? runId : `${runId}:${prefix}:created` } });
  const publishedMessages: Array<{ topic: string; payload: unknown }> = [];
  const queue: QueuePublisher & QueueConsumer = {
    async publish(topic, payload) {
      const envelope = payload as { payload?: { correlation?: CorrelationContext } };
      const original = envelope.payload?.correlation ?? readCorrelation(envelope.payload as Record<string, unknown> | undefined, runId, 'investment-worker');
      const correlation = topic === 'agent.run' ? { ...original, requestId: `delivery-${original.requestId}` } : original;
      publishedMessages.push({ topic, payload: topic === 'agent.run' ? { ...envelope, payload: { ...envelope.payload, correlation } } : payload });
      safeEmit(logger, createStructuredLogEvent({ context: correlation, event: 'outbox.published', level: 'INFO', outcome: 'PUBLISHED' }));
    },
    async consume(handler) { const messages = publishedMessages.splice(0, publishedMessages.length); for (const message of messages) await handler(message); },
  };
  const outbox = new OutboxPublisher(new PostgresOutboxRepository(db), queue);
  const handler = createDurableHandler(runtime, { owner: 'api-prod-e2e', logger });
  const response = await handler(new Request('https://example.test/runs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-trace-id': input.traceId, 'x-tenant-id': input.tenantId, 'idempotency-key': idempotencyKey }, body: JSON.stringify({ agentId: 'investment-worker', input: { secret: input.secretInput ?? 'no-secret' }, executionMode: 'async' }) }));
  await outbox.publishBatch();
  const worker = new DurableWorker(runtime, queue, { owner: 'worker-prod-e2e', logger });
  await worker.start();
  await outbox.publishBatch();
  const run = await runtime.getRun(runId);
  const toolCall = await repos.getToolCall?.(toolCallId);
  const publishedOutboxCount = Number((await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM outbox_events WHERE (payload->>\'runId\') = $1', [runId])).rows[0]?.count ?? 0);
  await db.pool.end();
  return { httpStatus: response.status === 202 ? 200 : response.status, events, serializedTelemetry: JSON.stringify(events), businessResult: { status: run.state }, telemetryErrors, durableRun: { runId: run.runId, state: run.state }, durableToolCall: { toolName: String(toolCall?.toolName ?? toolName), status: String(toolCall?.status ?? 'UNKNOWN') }, publishedOutboxCount };
}

function readCorrelation(metadata: Record<string, unknown> | undefined, runId: string, agentId: string): CorrelationContext { return { requestId: typeof metadata?.requestId === 'string' ? metadata.requestId : `req-${runId}`, traceId: typeof metadata?.traceId === 'string' ? metadata.traceId : `trace-${runId}`, tenantId: typeof metadata?.tenantId === 'string' ? metadata.tenantId : 'unknown', runId, agentId }; }
async function cleanupProductionScenario(db: PostgresDatabase, runId: string, idempotencyKey: string): Promise<void> { await db.query('DELETE FROM outbox_events WHERE payload->>\'runId\' = $1', [runId]); await db.query('DELETE FROM tool_calls WHERE run_id = $1', [runId]); await db.query('DELETE FROM agent_events WHERE run_id = $1', [runId]); await db.query('DELETE FROM agent_runs WHERE run_id = $1', [runId]); await db.query('DELETE FROM idempotency_keys WHERE idempotency_key = $1', [idempotencyKey]); }
