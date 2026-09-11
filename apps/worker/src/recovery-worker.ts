import { randomUUID } from 'node:crypto';
import { RecoveryCandidateStore, RecoveryCoordinator } from '@agent-native/durability';

export type RecoveryOutcomeClassification = 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'SKIPPED';

export interface RecoveryOutcome {
  candidateId: string;
  attempt: number;
  owner: string;
  classification: RecoveryOutcomeClassification;
  nextAttemptAt: Date | null;
}

export interface RecoveryWorkerResult {
  recovered: number;
  skipped: number;
  failed: number;
  outcomes: RecoveryOutcome[];
}

export interface RecoveryWorkerOptions {
  owner?: string;
  leaseMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class RecoveryWorker {
  private readonly owner: string;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly store: RecoveryCandidateStore,
    private readonly coordinator: RecoveryCoordinator,
    ownerOrOptions: string | RecoveryWorkerOptions = {},
  ) {
    const options = typeof ownerOrOptions === 'string' ? { owner: ownerOrOptions } : ownerOrOptions;
    this.owner = options.owner ?? `recovery-worker-${randomUUID()}`;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
  }

  async runOnce(now = new Date()): Promise<RecoveryWorkerResult> {
    await this.store.reclaimExpiredRecoveryCandidates(now);
    const candidates = await this.store.findRecoverableCandidates(this.batchSize, now);
    let recovered = 0;
    let skipped = 0;
    let failed = 0;
    const outcomes: RecoveryOutcome[] = [];

    for (const candidate of candidates) {
      const leaseToken = randomUUID();
      const lease = await this.store.claimRecoveryCandidate(candidate.runId, this.owner, leaseToken, this.leaseMs, now);
      if (!lease) {
        skipped += 1;
        outcomes.push({ candidateId: candidate.runId, attempt: candidate.attempts + 1, owner: this.owner, classification: 'SKIPPED', nextAttemptAt: null });
        continue;
      }

      const attempt = lease.attempts + 1;
      const heartbeat = setInterval(() => {
        void this.store.renewRecoveryLease(lease.runId, lease.owner, lease.leaseToken, this.leaseMs).catch(() => undefined);
      }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
      heartbeat.unref?.();

      try {
        await this.coordinator.recover({ request: lease.request, state: lease.state });
        const completed = await this.store.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
        if (!completed) throw new Error(`Recovery lease lost before completion: ${lease.runId}`);
        recovered += 1;
        outcomes.push({ candidateId: lease.runId, attempt, owner: lease.owner, classification: 'SUCCEEDED', nextAttemptAt: null });
      } catch (error) {
        failed += 1;
        try {
          const failure = await this.store.recordRecoveryFailure({
            runId: lease.runId,
            owner: lease.owner,
            leaseToken: lease.leaseToken,
            retryable: isRetryableRecoveryError(error),
            error,
            now,
            maxAttempts: this.maxAttempts,
            baseBackoffMs: this.baseBackoffMs,
            maxBackoffMs: this.maxBackoffMs,
          });
          outcomes.push({ candidateId: lease.runId, attempt: failure.attempts, owner: lease.owner, classification: failure.state, nextAttemptAt: failure.nextAttemptAt });
        } catch {
          // A lost lease is already recoverable by another worker after expiry; do not strand the loop.
          outcomes.push({ candidateId: lease.runId, attempt, owner: lease.owner, classification: 'FAILED_RETRYABLE', nextAttemptAt: null });
        }
      } finally {
        clearInterval(heartbeat);
      }
    }

    return { recovered, skipped, failed, outcomes };
  }
}

function isRetryableRecoveryError(error: unknown): boolean {
  return !(error instanceof Error && (
    error.name === 'IdempotencyFinalFailureError' ||
    error.name === 'ToolPermissionDeniedError' ||
    error.name === 'IdempotencyConflictError'
  ));
}
