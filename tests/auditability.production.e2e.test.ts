import { describe, expect, it } from 'vitest';

function auditRequest(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    from: '2026-09-14T00:00:00.000Z',
    to: '2026-09-15T00:00:00.000Z',
    limit: '20',
    ...overrides,
  });
  return new Request(`https://example.test/api/audit?${params}`, {
    method: 'GET',
    headers: {
      'x-tenant-id': 'tenant-a',
      'x-actor-id': 'user-1',
      'x-request-id': 'req-production-e2e',
      'x-trace-id': 'trace-production-e2e',
    },
  });
}

describe('auditability production composition RED gate', () => {
  it('exposes auditability through the production durable composition', async () => {
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    expect(PostgresAuditRepository).toBeDefined();
  });

  it('wires the bounded audit query handler into the production composition', async () => {
    const { composeApi } = await import('../apps/api/src/composition');
    const { InMemoryAgentRuntime } = await import('../packages/runtime/src/in-memory-runtime');

    const composition = composeApi(new InMemoryAgentRuntime());

    expect(composition).toHaveProperty('auditQueryHandler');
    expect(typeof composition.auditQueryHandler).toBe('function');
  });

  it('serves the audit query through the production Vercel handler boundary', async () => {
    const { createVercelHandler } = await import('../apps/api/src/handler');
    const { AuditQueryService, InMemoryAuditRepository } = await import('../packages/runtime/src/auditability');

    const audit = new InMemoryAuditRepository();
    await audit.append({
      auditId: 'audit-production-1',
      tenantId: 'tenant-a',
      occurredAt: '2026-09-14T12:00:00.000Z',
      actorId: 'user-1',
      actorType: 'USER',
      action: 'PAUSE',
      resourceType: 'RUN',
      resourceId: 'run-1',
      outcome: 'SUCCEEDED',
      reasonClass: 'NONE',
      correlation: { requestId: 'req-1', traceId: 'trace-1' },
      version: 1,
      metadata: { resultingState: 'PAUSED' },
    });

    const auditQueryHandler = (await import('../apps/api/src/audit-query-handler'))
      .createAuditQueryHandler({
        service: new AuditQueryService(audit, { authorize: (actorId) => actorId !== 'unauthorized' }),
      });

    const handler = createVercelHandler(
      { createRun: async () => { throw new Error('not used'); } } as never,
      undefined,
      auditQueryHandler,
    );

    const response = await handler(auditRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-production-e2e');
    await expect(response.json()).resolves.toMatchObject({
      items: [{ auditId: 'audit-production-1', tenantId: 'tenant-a', actorId: 'user-1' }],
    });
  });

  it('rejects an unauthorized actor without querying audit data', async () => {
    const { createAuditQueryHandler } = await import('../apps/api/src/audit-query-handler');
    const { AuditQueryService } = await import('../packages/runtime/src/auditability');

    let queried = false;
    const service = new AuditQueryService({
      query: async () => {
        queried = true;
        return { items: [] };
      },
    }, { authorize: (actorId) => actorId !== 'unauthorized' });

    const handler = createAuditQueryHandler({ service });
    const request = auditRequest();
    request.headers.set('x-actor-id', 'unauthorized');

    const response = await handler(request);
    expect(response.status).toBe(403);
    expect(queried).toBe(false);
  });
});
