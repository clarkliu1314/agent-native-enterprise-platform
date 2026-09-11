import {
  IdempotencyFinalFailureError,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolExecutionService,
} from '@agent-native/tool-runtime';

export type RecoveryState = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';

/** A persisted operation that may need deterministic recovery after a worker crash. */
export interface RecoveryCandidate {
  request: ToolExecutionRequest;
  state: RecoveryState;
  output?: unknown;
}

/**
 * Re-enters the normal tool boundary during recovery.
 *
 * Recovery never calls an effectful tool directly. It reuses ToolExecutionService so
 * authorization, idempotency reservation, result replay, and the transactional outbox
 * boundary remain identical to a normal request.
 */
export class RecoveryCoordinator {
  constructor(private readonly service: ToolExecutionService) {}

  async recover(candidate: RecoveryCandidate): Promise<ToolExecutionResult> {
    if (candidate.state === 'FAILED_FINAL') {
      throw new IdempotencyFinalFailureError(candidate.request.idempotencyKey);
    }

    // IN_PROGRESS and FAILED_RETRYABLE deliberately re-enter the same idempotency key.
    // The durable store decides whether the reservation is reclaimable. SUCCEEDED is also
    // safe to re-enter because the store returns the committed result without execution.
    return this.service.execute(candidate.request);
  }
}
