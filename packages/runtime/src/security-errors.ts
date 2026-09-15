import { classifyError, type StableErrorCode } from '@agent-native/observability';

const SAFE_MESSAGES: Record<StableErrorCode, string> = {
  AUTHORIZATION_DENIED: 'Authorization denied',
  IDEMPOTENCY_CONFLICT: 'Idempotency conflict',
  STALE_FENCING_TOKEN: 'Stale fencing token',
  RUN_NOT_FOUND: 'Run not found',
  INVALID_STATE_TRANSITION: 'Invalid state transition',
  RECOVERY_LEASE_LOST: 'Recovery lease lost',
  RECOVERY_RETRYABLE: 'Recovery retryable failure',
  RECOVERY_FINAL: 'Recovery failed',
  OUTBOX_PUBLISH_FAILED: 'Outbox publish failed',
  INTERNAL_ERROR: 'Internal error',
};

export function sanitizeSecurityError(error: unknown): { code: StableErrorCode; message: string } {
  const code = classifyError(error);
  return { code, message: SAFE_MESSAGES[code] };
}
