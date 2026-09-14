import { describe, expect, it } from 'vitest';

describe('operational control auditability RED gate', () => {
  it('records exactly one accepted audit fact for a committed PAUSE', async () => {
    const { OperationalControlService } = await import('../packages/runtime/src/operational-control');
    const { InMemoryAuditRepository } = await import('../packages/runtime/src/auditability');
    const audit = new InMemoryAuditRepository();
    const service = new OperationalControlService({ audit });
    const result = await service.execute({
      commandId: 'cmd-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'user-1', action: 'PAUSE',
      idempotencyKey: 'idem-1', correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'user-1' },
    });
    expect(result.outcome).toBe('SUCCEEDED');
    const rows = (await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 20 })).items;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('PAUSE');
    expect(rows[0].actorId).toBe('user-1');
  });
});