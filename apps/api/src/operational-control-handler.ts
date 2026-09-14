import { randomUUID } from 'node:crypto';
import { OperationalControlError, OperationalControlService, type OperationalControlAction, type OperationalControlCommand } from '@agent-native/runtime';
import type { CorrelationContext } from '@agent-native/observability';

export interface OperationalControlHandlerOptions { service: OperationalControlService; authorize?: (actorId: string, action: OperationalControlAction, tenantId: string, runId: string) => Promise<boolean> | boolean; }

const ROUTE_ACTIONS: Record<string, OperationalControlAction> = { pause: 'PAUSE', resume: 'RESUME', retry: 'RETRY', cancel: 'CANCEL', recover: 'RECOVER' };

export function createOperationalControlHandler(options: OperationalControlHandlerOptions) {
  return async function handler(request: Request): Promise<Response> {
    const match = new URL(request.url).pathname.match(/^\/api\/runs\/([^/]+)\/(pause|resume|retry|cancel|recover)$/);
    if (request.method !== 'POST' || !match) return Response.json({ errorCode: 'NOT_FOUND' }, { status: 404 });
    try {
      const body = await request.json() as Record<string, unknown>;
      const action = ROUTE_ACTIONS[match[2]];
      const tenantId = request.headers.get('x-tenant-id');
      const actorId = request.headers.get('x-actor-id');
      if (!tenantId || !actorId) return Response.json({ errorCode: 'AUTHORIZATION_DENIED' }, { status: 403 });
      const runId = decodeURIComponent(match[1]);
      if (options.authorize && !(await options.authorize(actorId, action, tenantId, runId))) return Response.json({ errorCode: 'AUTHORIZATION_DENIED' }, { status: 403 });

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
      return jsonResponse({ ...result, action, runId }, result.replayed ? 200 : 202);
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ errorCode: 'INVALID_REQUEST' }, { status: 400 });
      if (error instanceof OperationalControlError) return Response.json({ errorCode: error.code }, { status: statusFor(error.code) });
      return Response.json({ errorCode: 'INTERNAL_ERROR' }, { status: 500 });
    }
  };
}

function statusFor(code: string): number {
  if (code === 'AUTHORIZATION_DENIED') return 403;
  if (code === 'RUN_NOT_FOUND') return 404;
  return 409;
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item), { status, headers: { 'content-type': 'application/json' } });
}
