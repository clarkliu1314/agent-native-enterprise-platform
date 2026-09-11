# Durable Recovery

Use this skill for PostgreSQL recovery, leases, retries, worker restart, or idempotency changes.

## Invariants

- Recover only persisted `IN_PROGRESS` or `FAILED_RETRYABLE` work whose retry time has arrived.
- Claim work atomically; concurrent workers must not own the same candidate.
- A lease must have an owner/token and expiry and must be reclaimable after expiry.
- Recovery must call `RecoveryCoordinator` and the normal `ToolExecutionService` boundary.
- Reuse the original idempotency key for every retry of the same logical effect.
- Persist attempt count and retry scheduling durably.
- Non-retryable failures and exhausted retries become `FAILED_FINAL`.
- Never execute business effects directly from a recovery worker.

## Test matrix

Before implementation, add tests for candidate discovery, concurrent claim, expired lease reclaim, backoff, terminal classification, worker restart, ambiguous external outcome, persisted-result replay, and outbox publish/ack failure.

## SQL review

For PostgreSQL changes inspect transaction boundaries, indexes, row locking, `FOR UPDATE SKIP LOCKED`, lease predicates, and deterministic ordering. Every state mutation needs a corresponding assertion on the stored row.
