import { randomUUID } from 'node:crypto';
import { OperationalControlError, OperationalControlService, type OperationalControlAction, type OperationalControlCommand } from '@agent-native/runtime';
import type { CorrelationContext } from '@agent-native/observability';

export interface OperationalControlHandlerOptions { service: OperationalControlService; authorize?: (actorId: string, action: OperationalControlAction, tenantId: string, runId: string) => Promise<boolean> | boolean; }

export function createOperationalControlHandler(options: OperationalControlHandlerOptions) {
  return async function handler(request: Request): Promise<Response> {
    const match = new URL(request.url).pathname.match(/^\/runs\/([^/]+)\/control$/);
    if (request.method !== 'POST' || !match) return Response.json({ error: 'not_found' }, { status: 404 });
    try {
      const body = await request.json() as Record<string, unknown>;
      const action = body.action;
      if (!isAction(action)) return Response.json({ error: 'invalid_request' }, { status: 400 });
      const tenantId = request.headers.get('x-tenant-id'); const actorId = request.headers.get('x-actor-id');
      if (!tenantId || !actorId) return Response.json({ error: 'authorization_denied' }, { status: 403 });
      const runId = decodeURIComponent(match[1]);
      if (options.authorize && !(await options.authorize(actorId, action, tenantId, runId))) return Response.json({ error: 'authorization_denied' }, { status: 403 });
      const requestId = request.headers.get('x-request-id') ?? `req_${randomUUID()}`;
      const traceId = request.headers.get('x-trace-id') ?? `trace_${randomUUID()}`;
      const correlation: CorrelationContext = { requestId, traceId, tenantId, runId, actorId };
      const command: OperationalControlCommand = {
        commandId: typeof body.commandId === 'string' ? body.commandId : `cmd_${randomUUID()}`,
        tenantId, runId, actorId, action,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        idempotencyKey: request.headers.get('idempotency-key') ?? (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : `idem_${randomUUID()}`),
        expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
        correlation,
      };
      const result = await options.service.execute(command);
      return jsonResponse(result, result.replayed ? 200 : 202);
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: 'invalid_json' }, { status: 400 });
      if (error instanceof OperationalControlError) return Response.json({ error: error.code.toLowerCase() }, { status: error.code === 'AUTHORIZATION_DENIED' ? 403 : error.code === 'RUN_NOT_FOUND' ? 404 : 409 });
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  };
}
function isAction(value: unknown): value is OperationalControlAction { return value === 'PAUSE' || value === 'RESUME' || value === 'RETRY' || value === 'CANCEL' || value === 'RECOVER'; }
function jsonResponse(value: unknown, status: number): Response { return new Response(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item), { status, headers: { 'content-type': 'application/json' } }); }
