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

  it('records a rejected authorization decision without mutating the run or leaking target state', async () => {
    const { OperationalControlService, OperationalControlError } = await import('../packages/runtime/src/operational-control');
    const { InMemoryAuditRepository } = await import('../packages/runtime/src/auditability');
    const audit = new InMemoryAuditRepository();
    const service = new OperationalControlService({ audit });
    await expect(service.execute({
      commandId: 'cmd-reject-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'unauthorized', action: 'CANCEL',
      idempotencyKey: 'idem-reject-1', correlation: { requestId: 'req-reject-1', traceId: 'trace-reject-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'unauthorized' },
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' } satisfies Partial<InstanceType<typeof OperationalControlError>>);
    const rows = (await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 20 })).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'REJECTED', action: 'CANCEL', actorId: 'unauthorized', resourceType: 'RUN', resourceId: 'run-1', reasonClass: 'SYSTEM' });
    expect(rows[0].metadata).not.toHaveProperty('resultingState');
  });

  it('replays an idempotent control without creating a second accepted audit fact', async () => {
    const { OperationalControlService } = await import('../packages/runtime/src/operational-control');
    const { InMemoryAuditRepository } = await import('../packages/runtime/src/auditability');
    const audit = new InMemoryAuditRepository();
    const service = new OperationalControlService({ audit });
    const command = {
      commandId: 'cmd-replay-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'user-1', action: 'PAUSE' as const,
      idempotencyKey: 'idem-replay-1', correlation: { requestId: 'req-replay-1', traceId: 'trace-replay-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'user-1' },
    };
    await service.execute(command);
    const replay = await service.execute(command);
    const rows = (await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 20 })).items;
    expect(replay.replayed).toBe(true);
    expect(replay.eventsCreated).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('SUCCEEDED');
  });
});
