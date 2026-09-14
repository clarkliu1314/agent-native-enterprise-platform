import { safeMetric, type ObservabilityMetrics } from '@agent-native/observability';
import type { RuntimeAdapter, QueuePublisher } from './ports';
import type { DurableRepositories } from './repositories';

export interface RecoveryOutcome {
  runId: string;
  recovered: boolean;
  action: 'RECLAIMED' | 'SKIPPED' | 'FAILED';
}

export interface RecoveryObservabilityOptions { metrics?: ObservabilityMetrics; }

export class RecoveryCoordinator {
  constructor(
    private readonly repos: DurableRepositories,
    private readonly adapter: RuntimeAdapter,
    private readonly leaseMs = 30_000,
    private readonly queue?: QueuePublisher,
    private readonly observability: RecoveryObservabilityOptions = {},
  ) {}

  async recoverExpired(limit = 25): Promise<RecoveryOutcome[]> {
    const candidates = await this.repos.findExpiredRuns(limit);
    const outcomes: RecoveryOutcome[] = [];
    for (const candidate of candidates) {
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_attempt_total', 1, { outcome: 'RETRYING' }));
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_retry_total', 1, { outcome: 'RETRYING' }));
      try {
        if (this.queue) {
          // Recovery only schedules expired work. The durable worker owns the
          // authoritative claim, lease and fencing transition so recovery can
          // never create a second ownership protocol.
          await this.queue.publish('agent.run', {
            runId: candidate.runId,
            recovered: true,
          });
        }
        outcomes.push({ runId: candidate.runId, recovered: true, action: 'RECLAIMED' });
      } catch (error) {
        void error;
        safeMetric(() => this.observability.metrics?.increment('agent_recovery_terminal_failure_total', 1, { outcome: 'FAILED' }));
        outcomes.push({ runId: candidate.runId, recovered: false, action: 'FAILED' });
      }
    }
    void this.adapter;
    void this.leaseMs;
    void this.repos;
    return outcomes;
  }
}
