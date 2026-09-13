import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '@agent-native/runtime-contract/durable';
import type { RuntimeAdapter, QueuePublisher } from './ports';
import type { DurableRepositories } from './repositories';
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
  it('schedules expired work without creating a competing claim or fencing protocol', async () => {
    const publish = vi.fn<QueuePublisher['publish']>().mockResolvedValue();
    const queue: QueuePublisher = { publish };
    const repos = {
      findExpiredRuns: vi.fn(async () => [candidate]),
      reclaimExpiredRun: vi.fn(),
    } as unknown as DurableRepositories;
    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, queue);

    const result = await coordinator.recoverExpired(1);

    expect(result).toEqual([{ runId: 'run-expired', recovered: true, action: 'RECLAIMED' }]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe('agent.run');
    expect(publish.mock.calls[0][1]).toEqual({ runId: 'run-expired', recovered: true });
    expect(repos.reclaimExpiredRun).not.toHaveBeenCalled();
  });

  it('does not report recovery when scheduling fails', async () => {
    const publish = vi.fn<QueuePublisher['publish']>().mockRejectedValue(new Error('queue unavailable'));
    const queue: QueuePublisher = { publish };
    const repos = {
      findExpiredRuns: vi.fn(async () => [candidate]),
      reclaimExpiredRun: vi.fn(),
    } as unknown as DurableRepositories;
    const coordinator = new RecoveryCoordinator(repos, adapter, 30_000, queue);

    const result = await coordinator.recoverExpired(1);

    expect(result).toEqual([{ runId: 'run-expired', recovered: false, action: 'FAILED' }]);
    expect(repos.reclaimExpiredRun).not.toHaveBeenCalled();
  });
});
