import { randomUUID } from 'node:crypto';
import { RecoveryCandidateStore, RecoveryCoordinator } from '@agent-native/durability';

export interface RecoveryWorkerResult {
  recovered: number;
  skipped: number;
  failed: number;
}

export interface RecoveryWorkerOptions {
  owner?: string;
  leaseMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Production recovery loop: discovery is durable, ownership is leased, and execution re-enters
 * RecoveryCoordinator. Process memory contains only an ephemeral worker identity/token.
 */
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

    for (const candidate of candidates) {
      const leaseToken = randomUUID();
      const lease = await this.store.claimRecoveryCandidate(
        candidate.runId,
        this.owner,
        leaseToken,
        this.leaseMs,
        now,
      );
      if (!lease) {
        skipped += 1;
        continue;
      }

      try {
        await this.coordinator.recover({
          request: lease.request,
          state: lease.state,
        });
        const completed = await this.store.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
        if (!completed) throw new Error(`Recovery lease lost before completion: ${lease.runId}`);
        recovered += 1;
      } catch (error) {
        failed += 1;
        await this.store.recordRecoveryFailure({
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
      }
    }

    return { recovered, skipped, failed };
  }
}

function isRetryableRecoveryError(error: unknown): boolean {
  return !(error instanceof Error && (
    error.name === 'IdempotencyFinalFailureError' ||
    error.name === 'ToolPermissionDeniedError' ||
    error.name === 'IdempotencyConflictError'
  ));
}
