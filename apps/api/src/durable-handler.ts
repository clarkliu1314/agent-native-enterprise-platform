import { randomUUID } from 'node:crypto';
import type { CreateRunCommand, RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { IdempotencyConflictError, RunNotFoundError } from '@agent-native/runtime';

export interface DurableHandlerOptions { syncBudgetMs?: number; owner?: string; }

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
        const command: CreateRunCommand = { agentId: body.agentId, input: body.input, metadata: isRecord(body.metadata) ? body.metadata : undefined, executionMode, idempotencyKey: request.headers.get('idempotency-key') ?? undefined };
        const created = await runtime.createRun(command);
        if (executionMode === 'sync' && !created.replayed) {
          const result = await runtime.executeRunBounded(created.run.runId, owner, new Date(Date.now() + syncBudgetMs));
          return Response.json(result.run, { status: result.terminal ? 200 : 202 });
        }
        return Response.json(created.run, { status: created.run.state === 'SUCCEEDED' || created.run.state === 'FAILED' || created.run.state === 'CANCELLED' ? 200 : 202 });
      }
      const match = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (request.method === 'GET' && match) return Response.json(await runtime.getRun(decodeURIComponent(match[1])), { status: 200 });
      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: 'invalid_json' }, { status: 400 });
      if (error instanceof IdempotencyConflictError) return Response.json({ error: 'idempotency_conflict' }, { status: 409 });
      if (error instanceof RunNotFoundError) return Response.json({ error: 'run_not_found' }, { status: 404 });
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
