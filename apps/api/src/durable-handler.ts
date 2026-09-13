import { randomUUID } from 'node:crypto';
import type { CreateRunCommand, RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { IdempotencyConflictError, RunNotFoundError } from '@agent-native/runtime';
import { createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger } from '@agent-native/observability';
import type { MemoryObservabilityMetrics } from '@agent-native/observability';

export interface DurableHandlerOptions {
  syncBudgetMs?: number;
  owner?: string;
  logger?: ObservabilityLogger;
  metrics?: Pick<MemoryObservabilityMetrics, 'increment'>;
}

export function createDurableHandler(runtime: RuntimeFacade, options: DurableHandlerOptions = {}) {
  const syncBudgetMs = options.syncBudgetMs ?? 8_000;
  const owner = options.owner ?? `api-${randomUUID()}`;
  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/runs') {
        const body = await request.json() as { agentId?: unknown; input?: unknown; metadata?: unknown; executionMode?: unknown };
        if (typeof body.agentId !== 'string' || !body.agentId || !('input' in body)) return Response.json({ error: 'invalid_request' }, { status: 400 });
        const executionMode = body.executionMode === 'sync' ? 'sync' : 'async';
        const requestId = request.headers.get('x-request-id') || `req_${randomUUID()}`;
        const traceId = request.headers.get('x-trace-id') || `trace_${randomUUID()}`;
        const suppliedMetadata = isRecord(body.metadata) ? body.metadata : {};
        const tenantId = request.headers.get('x-tenant-id') || (typeof suppliedMetadata.tenantId === 'string' ? suppliedMetadata.tenantId : 'unknown');
        const context: CorrelationContext = { requestId, traceId, tenantId };
        const metadata = { ...suppliedMetadata, requestId, traceId, tenantId };
        const command: CreateRunCommand = { agentId: body.agentId, input: body.input, metadata, executionMode, idempotencyKey: request.headers.get('idempotency-key') ?? undefined };
        emit(options.logger, createStructuredLogEvent({ context: { ...context, agentId: body.agentId }, event: 'api.accepted', level: 'INFO', outcome: 'STARTED' }));
        increment(options.metrics, 'agent_run_started_total', { agent: body.agentId, outcome: 'STARTED' });
        const created = await runtime.createRun(command);
        if (executionMode === 'sync' && !created.replayed) {
          const result = await runtime.executeRunBounded(created.run.runId, owner, new Date(Date.now() + syncBudgetMs));
          return jsonResponse(result.run, result.terminal ? 200 : 202);
        }
        return jsonResponse(created.run, created.run.state === 'SUCCEEDED' || created.run.state === 'FAILED' || created.run.state === 'CANCELLED' ? 200 : 202);
      }
      const match = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (request.method === 'GET' && match) return jsonResponse(await runtime.getRun(decodeURIComponent(match[1])), 200);
      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: 'invalid_json' }, { status: 400 });
      if (error instanceof IdempotencyConflictError) return Response.json({ error: 'idempotency_conflict' }, { status: 409 });
      if (error instanceof RunNotFoundError) return Response.json({ error: 'run_not_found' }, { status: 404 });
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  };
}

function emit(logger: ObservabilityLogger | undefined, event: Parameters<ObservabilityLogger['emit']>[0]): void {
  if (logger) safeEmit(logger, event);
}

function increment(metrics: Pick<MemoryObservabilityMetrics, 'increment'> | undefined, name: string, labels: Record<string, string>): void {
  if (!metrics) return;
  try { metrics.increment(name, 1, labels); } catch { /* telemetry is best-effort */ }
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item), { status, headers: { 'content-type': 'application/json' } });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
