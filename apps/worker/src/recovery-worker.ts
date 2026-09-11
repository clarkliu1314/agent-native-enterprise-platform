import { RecoveryCoordinator, type RecoveryCandidate } from '@agent-native/durability';

export interface RecoveryCandidateSource {
  listRecoverable(): Promise<RecoveryCandidate[]>;
}

export interface RecoveryWorkerResult {
  recovered: number;
  skipped: number;
}

/**
 * One-shot durable recovery worker.
 *
 * Candidate discovery is intentionally separated from recovery execution: PostgreSQL (or a
 * queue-backed source) owns durable selection, while RecoveryCoordinator owns the invariant
 * that all retries re-enter the framework-neutral tool boundary.
 */
export class RecoveryWorker {
  constructor(
    private readonly source: RecoveryCandidateSource,
    private readonly coordinator: RecoveryCoordinator,
  ) {}

  async runOnce(): Promise<RecoveryWorkerResult> {
    const candidates = await this.source.listRecoverable();
    let recovered = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      if (candidate.state === 'FAILED_FINAL') {
        skipped += 1;
        continue;
      }
      await this.coordinator.recover(candidate);
      recovered += 1;
    }

    return { recovered, skipped };
  }
}
