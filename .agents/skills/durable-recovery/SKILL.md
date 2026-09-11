---
name: durable-recovery
description: Implement or review PostgreSQL recovery, leases, retries, worker restart, and idempotent crash recovery without bypassing Permission, Idempotency, or Outbox boundaries.
---

# Durable Recovery

- Recover only persisted `IN_PROGRESS` or `FAILED_RETRYABLE` work whose retry time has arrived.
- Claim work atomically; concurrent workers must not own the same candidate.
- A lease has an owner/token and expiry and is reclaimable after expiry.
- Recovery calls `RecoveryCoordinator` and the normal `ToolExecutionService` boundary.
- Reuse the original idempotency key for the same logical effect.
- Persist attempt count and retry scheduling durably.
- Non-retryable failures and exhausted retries become `FAILED_FINAL`.
- Never execute a business tool directly from a recovery worker.

Before implementation, add tests for candidate discovery, concurrent claim, expired lease reclaim, backoff, terminal classification, worker restart, ambiguous external outcome, persisted-result replay, and outbox publish/ack failure.

For PostgreSQL changes inspect transaction boundaries, indexes, row locks, `FOR UPDATE SKIP LOCKED`, lease predicates, and deterministic ordering. Every state mutation needs a corresponding SQL assertion.
