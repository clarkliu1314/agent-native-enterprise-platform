import { randomUUID } from 'node:crypto';
import type { AuditOutcome } from '@agent-native/runtime';
import { AuditQueryService } from '@agent-native/runtime';

export interface AuditQueryHandlerOptions { service: AuditQueryService; }

export function createAuditQueryHandler(options: AuditQueryHandlerOptions) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'GET') return Response.json({ errorCode: 'NOT_FOUND' }, { status: 404 });

    const tenantId = request.headers.get('x-tenant-id');
    const actorId = request.headers.get('x-actor-id');
    if (!tenantId || !actorId) return Response.json({ errorCode: 'AUTHORIZATION_DENIED' }, { status: 403 });

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const outcome = url.searchParams.get('outcome') as AuditOutcome | null;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) return Response.json({ errorCode: 'INVALID_REQUEST' }, { status: 400 });

    try {
      const requestId = request.headers.get('x-request-id') ?? `req_${randomUUID()}`;
      const traceId = request.headers.get('x-trace-id') ?? `trace_${randomUUID()}`;
      const result = await options.service.query({
        actorId,
        tenantId,
        from,
        to,
        resourceType: url.searchParams.get('resourceType') ?? undefined,
        resourceId: url.searchParams.get('resourceId') ?? undefined,
        action: url.searchParams.get('action') ?? undefined,
        outcome: outcome ?? undefined,
        limit,
        cursor: url.searchParams.get('cursor') ?? undefined,
      });
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-trace-id': traceId } });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      if (code === 'AUTHORIZATION_DENIED') return Response.json({ errorCode: code }, { status: 403 });
      if (code.startsWith('INVALID_AUDIT_QUERY')) return Response.json({ errorCode: code }, { status: 400 });
      return Response.json({ errorCode: 'INTERNAL_ERROR' }, { status: 500 });
    }
  };
}
