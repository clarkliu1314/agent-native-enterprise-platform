import { describe, expect, it, vi } from 'vitest';
import { MemoryObservabilityMetrics } from '@agent-native/observability';
import { RecoveryCoordinator } from './recovery-coordinator';

describe('runtime RecoveryCoordinator metrics', () => {
  it('records canonical recovery attempt and retry metrics', async () => {
    const metrics = new MemoryObservabilityMetrics();
    const repos = {
      findExpiredRuns: vi.fn().mockResolvedValue([{ runId: 'run-1' }]),
    };
    const queue = { publish: vi.fn().mockResolvedValue(undefined) };
    const coordinator = new RecoveryCoordinator(repos as any, {} as any, 30_000, queue as any, { metrics });

    const result = await coordinator.recoverExpired();

    expect(result).toEqual([{ runId: 'run-1', recovered: true, action: 'RECLAIMED' }]);
    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent_recovery_attempt_total', labels: { outcome: 'RETRYING' } }),
      expect.objectContaining({ name: 'agent_recovery_retry_total', labels: { outcome: 'RETRYING' } }),
    ]));
  });
});
