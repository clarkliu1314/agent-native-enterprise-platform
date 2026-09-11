import { randomUUID } from 'node:crypto';
import type { RuntimeAdapter } from './ports';
import type { DurableRepositories } from './repositories';

export interface RecoveryOutcome {
  runId: string;
  recovered: boolean;
  fencingToken?: bigint;
  action: 'RECLAIMED' | 'SKIPPED' | 'FAILED';
}

export class RecoveryCoordinator {
  constructor(private readonly repos: DurableRepositories, private readonly adapter: RuntimeAdapter, private readonly leaseMs = 30_000) {}

  async recoverExpired(limit = 25): Promise<RecoveryOutcome[]> {
    const candidates = await this.repos.findExpiredRuns(limit);
    const outcomes: RecoveryOutcome[] = [];
    for (const candidate of candidates) {
      const owner = `recovery:${randomUUID()}`;
      const claim = await this.repos.reclaimExpiredRun(candidate.runId, owner, this.leaseMs);
      if (!claim) {
        outcomes.push({ runId: candidate.runId, recovered: false, action: 'SKIPPED' });
        continue;
      }
      outcomes.push({ runId: candidate.runId, recovered: true, fencingToken: claim.fencingToken, action: 'RECLAIMED' });
      void this.adapter;
    }
    return outcomes;
  }
}
