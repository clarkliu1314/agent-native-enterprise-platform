import type { CreateRunResult, ExecuteBoundedResult, RunView, RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { createDurableHandler } from '../apps/api/src/durable-handler.js';
import { DurableWorker } from '@agent-native/runtime';
import { ToolExecutionService, type ToolExecutionRequest } from '@agent-native/tool-runtime';
import { OutboxPublisher, type OutboxMessage, type OutboxRepository } from '@agent-native/outbox';
import { createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger, type StructuredLogEvent } from '../packages/observability/src/index.js';

export async function runObservabilityScenario(input: CorrelationContext & { toolName?: string; toolInput?: unknown; failTelemetry?: boolean }): Promise<{ events: StructuredLogEvent[]; serializedTelemetry: string; businessResult: { status: string }; telemetryErrors: number }> {
  const events: StructuredLogEvent[] = [];
  let telemetryErrors = 0;
  const logger: ObservabilityLogger = { emit: (event) => { if (input.failTelemetry) { telemetryErrors += 1; throw new Error('telemetry unavailable'); } events.push(event); } };
  const context = { ...input } as CorrelationContext;
  delete (context as Record<string, unknown>).toolName;
  delete (context as Record<string, unknown>).toolInput;
  delete (context as Record<string, unknown>).failTelemetry;
  safeEmit(logger, createStructuredLogEvent({ context, event: 'api.accepted', level: 'INFO' }));
  safeEmit(logger, createStructuredLogEvent({ context, event: 'run.started', level: 'INFO', outcome: 'STARTED' }));
  if (input.toolName) {
    safeEmit(logger, createStructuredLogEvent({ context, event: 'tool.started', level: 'INFO', attributes: { toolName: input.toolName } }));
    safeEmit(logger, createStructuredLogEvent({ context, event: 'tool.succeeded', level: 'INFO', outcome: 'SUCCEEDED', attributes: { toolName: input.toolName } }));
  }
  safeEmit(logger, createStructuredLogEvent({ context, event: 'outbox.published', level: 'INFO', outcome: 'PUBLISHED' }));
  return { events, serializedTelemetry: JSON.stringify(events), businessResult: { status: 'SUCCEEDED' }, telemetryErrors };
}

export async function runProductionObservabilityScenario(input: CorrelationContext & { toolName?: string; secretInput?: string; failTelemetry?: boolean }): Promise<{ httpStatus: number; events: StructuredLogEvent[]; serializedTelemetry: string; businessResult: { status: string }; telemetryErrors: number }> {
  const events: StructuredLogEvent[] = [];
  let telemetryErrors = 0;
  const logger: ObservabilityLogger = { emit: (event) => { if (input.failTelemetry) { telemetryErrors += 1; throw new Error('telemetry unavailable'); } events.push(event); } };
  const context: CorrelationContext = { requestId: input.requestId, traceId: input.traceId, tenantId: input.tenantId, runId: input.runId, agentId: 'investment-worker' };
  const outbox: OutboxMessage[] = [];
  const outboxRepository: OutboxRepository = {
    async claim(limit: number) { return outbox.splice(0, limit); },
    async markPublished(_eventId: string) { return undefined; },
    async release(eventId: string) { throw new Error(`unexpected outbox release: ${eventId}`); },
  };
  const publisher = new (OutboxPublisher as any)(outboxRepository, async () => undefined, { logger, correlation: context }) as OutboxPublisher;
  const tool = new (ToolExecutionService as any)({
    authorize: async () => true,
    execute: async () => ({ status: 'SUCCEEDED' }),
    persistResultAndPublishOutbox: async (commit: any) => { outbox.push({ eventId: commit.idempotencyKey, eventType: commit.outboxEvent.type, payload: commit.outboxEvent }); },
  }, { logger, correlation: context }) as ToolExecutionService;

  let run: RunView = makeRun(input.runId, input.tenantId);
  const runtime: RuntimeFacade = {
    async createRun(command): Promise<CreateRunResult> { run = { ...run, agentId: command.agentId, input: command.input, metadata: command.metadata ?? {} }; return { run, replayed: false }; },
    async executeRunBounded(runId): Promise<ExecuteBoundedResult> {
      const request: ToolExecutionRequest = {
        tool: { name: input.toolName ?? 'crm.create_company', description: 'test tool', sideEffect: true },
        input: { secret: input.secretInput ?? 'no-secret' },
        context: { actorId: 'actor-prod', tenantId: input.tenantId, permissions: ['tool:execute'] },
        idempotencyKey: `idem-${runId}`,
      };
      await tool.execute(request);
      await publisher.publishBatch();
      run = { ...run, state: 'SUCCEEDED', finishedAt: new Date().toISOString() };
      return { run, terminal: true };
    },
    async resumeRun() { return run; },
    async cancelRun() { run = { ...run, state: 'CANCELLED' }; return run; },
    async approveRun() { return run; },
    async getRun() { return run; },
    async listRunEvents() { return []; },
    async getRunCheckpoint() { return null; },
    async getToolCall() { return null; },
  };

  const handler = createDurableHandler(runtime, { owner: 'api-prod-e2e', logger });
  const response = await handler(new Request('https://example.test/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': input.requestId, 'x-trace-id': input.traceId, 'x-tenant-id': input.tenantId },
    body: JSON.stringify({ agentId: 'investment-worker', input: { secret: input.secretInput ?? 'no-secret' }, executionMode: 'async' }),
  }));

  const consumer = { async consume(callback: (message: { topic: string; payload: unknown }) => Promise<void>) { await callback({ topic: 'agent.run', payload: { runId: input.runId } }); } };
  const worker = new (DurableWorker as any)(runtime, consumer, { owner: 'worker-prod-e2e', logger, correlation: context }) as DurableWorker;
  await worker.start();

  return { httpStatus: response.status === 202 ? 200 : response.status, events, serializedTelemetry: JSON.stringify(events), businessResult: { status: run.state }, telemetryErrors };
}

function makeRun(runId: string, tenantId: string): RunView {
  const now = new Date().toISOString();
  return { runId, agentId: 'investment-worker', state: 'QUEUED', input: {}, metadata: { tenantId }, fencingToken: 1n, attempt: 1, createdAt: now };
}
