# Crash Recovery

Recovery is deterministic from durable state. Recoverable work is persisted work whose state is `IN_PROGRESS` or `FAILED_RETRYABLE` and whose retry time has arrived.

Production workers must atomically claim candidates, persist an owner/token and lease expiry, reclaim expired leases, and record retry attempts and scheduling durably.

Recovery re-enters `RecoveryCoordinator` and therefore the normal Permission + Idempotency + Tool Runtime + Outbox path. It must never call a business tool directly.

The target failure cases are process termination after claim, during tool execution, after an external effect, after result persistence, and around outbox publication. The correctness property is no duplicate logical business effect.
