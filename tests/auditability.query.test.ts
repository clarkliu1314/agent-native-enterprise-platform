import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository, type AuditRecord } from '../packages/runtime/src/auditability';
import { AuditQueryService } from '../packages/runtime/src/audit-query-service';
import { createAuditQueryHandler } from '../apps/api/src/audit-query-handler';

const record = (auditId: string, tenantId: string): AuditRecord => ({ auditId, tenantId, occurredAt: '2026-09-14T10:00:00.000Z', actorId: 'user-1', actorType: 'USER', action: 'PAUSE', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED', reasonClass: 'NONE', correlation: { requestId: `req-${auditId}`, traceId: `trace-${auditId}` }, metadata: {} });

describe('audit query application/API boundary', () => {
  it('queries only the authenticated tenant and enforces bounded query parameters', async () => {
    const repository = new InMemoryAuditRepository();
    await repository.append(record('audit-a', 'tenant-a')); await repository.append(record('audit-b', 'tenant-b'));
    const service = new AuditQueryService(repository, { authorize: () => true });
    const result = await service.query({ actorId: 'user-1', tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 100 });
    expect(result.items.map((item) => item.auditId)).toEqual(['audit-a']);
    await expect(service.query({ actorId: 'user-1', tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-16T00:00:00.000Z', limit: 100 })).rejects.toThrow('INVALID_AUDIT_QUERY_WINDOW');
  });
  it('rejects unauthorized audit reads without querying the repository', async () => {
    const repository = new InMemoryAuditRepository(); await repository.append(record('audit-a', 'tenant-a'));
    const service = new AuditQueryService(repository, { authorize: () => false });
    await expect(service.query({ actorId: 'user-1', tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 10 })).rejects.toThrow('AUTHORIZATION_DENIED');
  });
  it('exposes tenant and actor from headers, never from the query string or request body', async () => {
    const repository = new InMemoryAuditRepository(); await repository.append(record('audit-a', 'tenant-a'));
    const service = new AuditQueryService(repository, { authorize: (actorId, tenantId) => actorId === 'user-1' && tenantId === 'tenant-a' });
    const handler = createAuditQueryHandler(service);
    const response = await handler(new Request('https://example.test/api/audit?tenantId=tenant-b&from=2026-09-14T00:00:00.000Z&to=2026-09-15T00:00:00.000Z&limit=10', { headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-1' } }));
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ items: [{ auditId: 'audit-a', tenantId: 'tenant-a' }] });
  });
});
