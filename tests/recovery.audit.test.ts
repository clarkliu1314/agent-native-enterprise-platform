import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository } from '../packages/runtime/src/auditability';
import { RecoveryCoordinator } from '../packages/runtime/src/recovery-coordinator';
import type { RuntimeAdapter, QueuePublisher } from '../packages/runtime/src/ports';
import type { DurableRepositories } from '../packages/runtime/src/repositories';

const adapter: RuntimeAdapter = {
  name: 'test',
  version: '1',
  async run() { return { kind: 'SUCCEEDED' }; },
  serializeCheckpoint() { return new Uint8Array(); },
  deserializeCheckpoint() { return {}; },
};

describe('recovery auditability', () => {
  it('records one SYSTEM audit fact when an expired run is successfully scheduled for recovery', async () => {
    const audit = new InMemoryAuditRepository();
    const queue: QueuePublisher = { publish: async () => undefined };
    const repos = {
      findExpiredRuns: async () => [{
        runId: 'run-recovery-1', agentId: 'agent-1', state: 'RUNNING' as const, input: {},
        metadata: { tenantId: 'tenant-a', requestId: 'req-1', traceId: 'trace-1' },
        fencingToken: 4n, attempt: 2, createdAt: '2026-09-14T09:00:00.000Z',
      }],
    } as unknown as DurableRepositories;

    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, queue, {}, audit);
    const outcomes = await coordinator.recoverExpired(1);
    const result = await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 100 });

    expect(outcomes).toEqual([{ runId: 'run-recovery-1', recovered: true, action: 'RECLAIMED' }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      actorId: 'system', actorType: 'SYSTEM', action: 'RECOVERY_RECLAIMED',
      resourceType: 'RUN', resourceId: 'run-recovery-1', outcome: 'SUCCEEDED',
      reasonClass: 'SYSTEM',
      correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-recovery-1' },
      metadata: { attempt: 2 },
    });
  });

  it('records one FAILED SYSTEM audit fact when recovery scheduling fails', async () => {
    const audit = new InMemoryAuditRepository();
    const queue: QueuePublisher = { publish: async () => { throw new Error('queue unavailable'); } };
    const repos = {
      findExpiredRuns: async () => [{
        runId: 'run-recovery-2', agentId: 'agent-1', state: 'RUNNING' as const, input: {},
        metadata: { tenantId: 'tenant-a', requestId: 'req-2', traceId: 'trace-2' },
        fencingToken: 5n, attempt: 3, createdAt: '2026-09-14T09:00:00.000Z',
      }],
    } as unknown as DurableRepositories;

    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, queue, {}, audit);
    const outcomes = await coordinator.recoverExpired(1);
    const result = await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 100 });

    expect(outcomes).toEqual([{ runId: 'run-recovery-2', recovered: false, action: 'FAILED' }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ action: 'RECOVERY_FAILED', outcome: 'FAILED', resourceId: 'run-recovery-2' });
  });
});
