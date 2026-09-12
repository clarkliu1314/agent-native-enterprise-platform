import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '@agent-native/runtime-contract/durable';
import type { RuntimeAdapter, QueuePublisher } from './ports';
import type { DurableRepositories, RunClaim } from './repositories';
import { RecoveryCoordinator } from './recovery-coordinator';

const candidate: RunView = {
  runId: 'run-expired', agentId: 'agent', state: 'RUNNING', input: {}, metadata: {}, fencingToken: 3n,
  attempt: 2, createdAt: new Date(0).toISOString(),
};

const adapter: RuntimeAdapter = {
  name: 'test', version: '1',
  async run() { return { kind: 'SUCCEEDED' }; },
  serializeCheckpoint: () => new Uint8Array(),
  deserializeCheckpoint: () => ({}),
};

describe('RecoveryCoordinator', () => {
  it('reclaims expired work and publishes the new fencing ownership', async () => {
    const publish = vi.fn<QueuePublisher['publish']>().mockResolvedValue();
    const queue: QueuePublisher = { publish };
    const claim: RunClaim = { run: { ...candidate, fencingToken: 4n, attempt: 3 }, fencingToken: 4n };
    const repos = {
      findExpiredRuns: vi.fn(async () => [candidate]),
      reclaimExpiredRun: vi.fn(async () => claim),
    } as unknown as DurableRepositories;
    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, queue);

    const result = await coordinator.recoverExpired(1);

    expect(result).toEqual([{ runId: 'run-expired', recovered: true, fencingToken: 4n, action: 'RECLAIMED' }]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe('agent.run');
    expect(publish.mock.calls[0][1]).toMatchObject({ runId: 'run-expired', recovered: true, fencingToken: '4' });
    expect(repos.reclaimExpiredRun).toHaveBeenCalledWith('run-expired', expect.stringMatching(/^recovery:/), 30_000);
  });

  it('does not publish when the atomic reclaim loses the race', async () => {
    const publish = vi.fn<QueuePublisher['publish']>().mockResolvedValue();
    const repos = {
      findExpiredRuns: vi.fn(async () => [candidate]),
      reclaimExpiredRun: vi.fn(async () => null),
    } as unknown as DurableRepositories;
    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, { publish });

    const result = await coordinator.recoverExpired(1);

    expect(result).toEqual([{ runId: 'run-expired', recovered: false, action: 'SKIPPED' }]);
    expect(publish).not.toHaveBeenCalled();
  });
});
