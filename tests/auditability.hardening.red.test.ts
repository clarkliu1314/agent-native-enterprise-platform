import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository } from '../packages/runtime/src/auditability';
import { OperationalControlService } from '../packages/runtime/src/operational-control';

function record(id: string, occurredAt: string) {
  return {
    auditId: id,
    tenantId: 'tenant-a',
    occurredAt,
    actorId: 'user-1',
    actorType: 'USER' as const,
    action: 'PAUSE',
    resourceType: 'RUN',
    resourceId: id,
    outcome: 'SUCCEEDED' as const,
    reasonClass: 'NONE' as const,
    correlation: { requestId: `req-${id}`, traceId: `trace-${id}` },
    version: 1,
    metadata: { resultingState: 'RUNNING' },
  };
}

describe('auditability hardening RED gate', () => {
  it('does not leak the target run identifier in a cross-tenant rejection audit', async () => {
    const audit = new InMemoryAuditRepository();
    const service = new OperationalControlService({
      audit,
      authorization: { authorize: () => true },
    });

    await expect(service.execute({
      commandId: 'cmd-cross-tenant',
      tenantId: 'tenant-a',
      runId: 'run-cross-tenant',
      actorId: 'user-1',
      action: 'PAUSE',
      idempotencyKey: 'idem-cross-tenant',
      correlation: {
        requestId: 'req-cross-tenant',
        traceId: 'trace-cross-tenant',
        tenantId: 'tenant-b',
        runId: 'run-cross-tenant',
        actorId: 'user-1',
      },
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const now = Date.now();
    const result = await audit.query({
      tenantId: 'tenant-a',
      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
      limit: 100,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].outcome).toBe('REJECTED');
    expect(result.items[0].resourceId).not.toBe('run-cross-tenant');
    expect(result.items[0].metadata).not.toHaveProperty('runState');
  });

  it('supports deterministic cursor pagination in the in-memory contract implementation', async () => {
    const audit = new InMemoryAuditRepository();
    await audit.append(record('audit-1', '2026-09-15T00:00:01.000Z'));
    await audit.append(record('audit-2', '2026-09-15T00:00:02.000Z'));
    await audit.append(record('audit-3', '2026-09-15T00:00:03.000Z'));

    const first = await audit.query({
      tenantId: 'tenant-a',
      from: '2026-09-15T00:00:00.000Z',
      to: '2026-09-16T00:00:00.000Z',
      limit: 2,
    });

    expect(first.items.map((item) => item.auditId)).toEqual(['audit-1', 'audit-2']);
    expect(first.nextCursor).toBeDefined();

    const second = await audit.query({
      tenantId: 'tenant-a',
      from: '2026-09-15T00:00:00.000Z',
      to: '2026-09-16T00:00:00.000Z',
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(second.items.map((item) => item.auditId)).toEqual(['audit-3']);
    expect(second.nextCursor).toBeUndefined();
  });
});
