import type { RuntimeAdapter, QueuePublisher } from './ports';
import type { DurableRepositories } from './repositories';

export interface RecoveryOutcome {
  runId: string;
  recovered: boolean;
  action: 'RECLAIMED' | 'SKIPPED' | 'FAILED';
}

export class RecoveryCoordinator {
  constructor(
    private readonly repos: DurableRepositories,
    private readonly adapter: RuntimeAdapter,
    private readonly leaseMs = 30_000,
    private readonly queue?: QueuePublisher,
  ) {}

  async recoverExpired(limit = 25): Promise<RecoveryOutcome[]> {
    const candidates = await this.repos.findExpiredRuns(limit);
    const outcomes: RecoveryOutcome[] = [];
    for (const candidate of candidates) {
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
        outcomes.push({ runId: candidate.runId, recovered: false, action: 'FAILED' });
      }
    }
    void this.adapter;
    void this.leaseMs;
    void this.repos;
    return outcomes;
  }
}
