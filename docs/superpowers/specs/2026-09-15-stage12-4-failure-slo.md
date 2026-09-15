# Stage 12.4 — Failure & SLO Specification

**Status:** IMPLEMENTATION IN PROGRESS — DESIGN/APPROVAL GATE ACCEPTED  
**Date:** 2026-09-15  
**Architecture baseline:** A

## 1. Goal

Define production-grade failure semantics and measurable service objectives for the durable Agent-native runtime, without introducing a second runtime, scheduler, or authoritative state store.

The design must make failures observable, bounded, recoverable where safe, and auditable where they change durable state. PostgreSQL remains the durable source of truth; Redis remains delivery/scheduling infrastructure; `RuntimeFacade` remains the framework-neutral application boundary.

## 2. Scope

Stage 12.4 covers:

1. SLI/SLO definitions for API handoff, durable command completion, worker/recovery latency, Outbox delivery, and audit completeness.
2. Error-budget policy and alert thresholds using bounded-cardinality Stage 12.1 telemetry.
3. Timeout, retry, cancellation, backpressure, and overload semantics aligned with the existing Run FSM.
4. Failure injection across PostgreSQL, Outbox, worker crash, recovery/fencing, API handoff, and dependency degradation.
5. Integration with Stage 12.1 observability, Stage 12.2 operational control, and Stage 12.3 auditability.
6. Production-readiness benchmark cases and exact CI acceptance gates.

Out of scope: new agent frameworks, a new scheduler, a new event bus, a second audit store, business-domain expansion, and Stage 12.5 security hardening.

## 3. Existing invariants that remain locked

- Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- PostgreSQL is authoritative for durable workflow/run state, checkpoints, attempts, idempotency, audit facts, and outbox records.
- Redis is not authoritative and must not become a second execution model.
- Transactional state transitions remain atomic with their existing business/outbox/audit boundaries.
- Recovery uses durable attempts plus existing lease/fencing semantics.
- Effectful tools use durable idempotency; retry must never intentionally duplicate an accepted effect.
- Observability failures are isolated from business correctness.
- Audit facts are immutable, tenant-scoped, actor-attributed, and safe-data only.

## 4. Failure taxonomy

| Class | Examples | Durable outcome | Retry policy |
|---|---|---|---|
| Validation | malformed command, invalid transition | no state change | no retry |
| Authorization | denied permission / tenant mismatch | rejected operation + audit | no retry |
| Conflict | optimistic-version mismatch / stale fence | no conflicting state change | caller/recovery may retry with fresh state |
| Dependency-transient | PostgreSQL connection reset, Redis unavailable, downstream timeout | transaction remains atomic; no false success | bounded retry where operation is safe |
| Worker crash | process/container termination mid-step | last committed checkpoint remains authoritative | recovery claims and resumes |
| Effect uncertainty | timeout after effectful tool invocation | durable idempotency decides replay | retry only through idempotency key |
| Terminal business/runtime failure | invariant failure, exhausted retry budget | `FAILED` | no automatic retry after terminal classification |
| Overload | queue/concurrency saturation | admission delayed/rejected | bounded backoff / operator intervention |
| Telemetry-only | metrics/log/audit publication failure outside transaction | business state unaffected | best-effort isolated handling |

No failure path may manufacture `SUCCEEDED` or erase a committed durable fact.

## 5. Timeout semantics

Timeouts are measured at explicit boundaries rather than by wall-clock cancellation alone:

- **API handoff timeout:** bounds synchronous request processing. Once a durable command has been accepted, client timeout does not imply command failure.
- **Workflow/worker execution timeout:** bounds one execution lease/attempt. Expiry makes the attempt recoverable; it does not directly overwrite durable state to `FAILED` unless the retry/terminal policy says so.
- **Tool timeout:** produces a typed dependency/effect-uncertainty result. Effectful retries require the existing idempotency contract.
- **Recovery timeout:** bounds a recovery claim/lease and allows another eligible recovery attempt after fencing.

Cancellation is cooperative at safe transaction boundaries. A cancellation request is a durable control command; an already committed transaction is never rolled back merely because the client disconnected.

## 6. Retry and recovery policy

Retryability is explicit and bounded by failure class. Each retry must have a durable attempt identity and use existing idempotency/fencing mechanisms. Backoff must be bounded and observable. Exhaustion transitions the run to the existing terminal `FAILED` state; no new FSM state is introduced.

Recovery may resume only from the last committed checkpoint. Stale workers are fenced before they can commit. Crash recovery tests must prove that an interrupted step is neither silently lost nor applied twice when an effectful operation has an idempotency key.

## 7. Backpressure and concurrency

Backpressure is an admission/scheduling concern, not a new source of truth.

- Define bounded per-process worker concurrency.
- Prefer durable queue state and existing Redis delivery signals over process-local queues as authoritative state.
- When capacity is exhausted, retain durable `QUEUED` work and expose queue age/depth metrics.
- Reject or defer new work deterministically when configured admission limits are exceeded.
- Operational controls remain the mechanism for pause/resume/cancel/recover; backpressure must not invent control semantics.

## 8. SLI/SLO baseline

The following initial targets are the design baseline and must be measured from production-like test data before final rollout thresholds are changed:

| SLI | Measurement | Initial SLO |
|---|---|---:|
| API handoff success | accepted durable commands / valid authorized requests | >= 99.9% |
| Durable command completion | commands reaching terminal state within configured target window | >= 99.0% |
| Worker recovery latency | recoverable failures to next valid recovery claim | >= 99.0% within 60s |
| Outbox delivery | eligible outbox records delivered within configured target | >= 99.0% within 60s |
| Audit completeness | material transitions/rejections with corresponding audit fact | 100% |

SLO windows use a rolling 30-day operational window for policy purposes. The implementation must keep metric labels bounded: tenant identifiers, run IDs, request IDs, prompts, completions, and arbitrary resource IDs must not become unbounded metric labels.

## 9. Error budget and alerting

For availability-style SLOs, error budget is `1 - SLO`. Alerting has two levels:

- **Fast-burn:** sustained rapid budget consumption indicating an active incident; page/urgent operational response.
- **Slow-burn:** persistent degradation consuming budget over the rolling window; ticket/review response.

Exact burn-rate constants and thresholds are implementation/configuration details to be validated against the repository's existing observability metric names. The implementation must not create duplicate telemetry concepts where Stage 12.1 already provides a stable metric/error-code surface.

Audit completeness is a correctness invariant, not a tradeable error budget: any detected gap is a release-blocking failure until explained and remediated.

## 10. Failure-injection matrix

Required scenarios:

1. PostgreSQL unavailable during command transaction.
2. PostgreSQL failure after business write but before commit.
3. PostgreSQL failure during checkpoint persistence.
4. Outbox publisher failure before delivery.
5. Outbox publisher crash after delivery attempt; duplicate publication must remain safe.
6. Worker crash before checkpoint commit.
7. Worker crash after checkpoint commit.
8. Stale worker attempts commit after recovery fencing.
9. Effectful tool timeout with unknown completion state.
10. API/client timeout after durable command acceptance.
11. Redis delivery degradation while PostgreSQL remains available.
12. Worker concurrency saturation and queue growth.
13. Recovery retry exhaustion leading to `FAILED`.
14. Cancellation racing with an in-flight worker transaction.
15. Audit write failure inside a transaction: business transition must roll back atomically.
16. Observability emission failure outside business transaction: business correctness must remain unaffected.

Each case must specify initial state, injected fault, expected durable state, expected audit fact, expected telemetry/error code, and idempotency/replay assertion.

### Implementation evidence — 2026-09-15

- Design/approval gate is accepted; production implementation is proceeding on PR #31 (`feat/stage12-4-failure-policy-test2`).
- Run #801 passed the Stage 12.4 failure-injection contract and Compose/full test gates on commit `5ddf10a6a13667ee0b8f253250cdb29515060cb8`.
- Durable PostgreSQL fencing coverage now verifies lease expiry and reclaim increment the fencing token, and that the stale owner is rejected for Run transition, Event append, Checkpoint persistence, and atomic Run-progress/checkpoint persistence. The newer owner remains authoritative and no stale Event/Checkpoint/metadata artifact is committed.
- Existing cancellation-race and checkpoint transaction-rollback tests remain in the same PostgreSQL integration surface.
- This evidence validates the existing fencing mechanism; it does not introduce a second runtime, queue, scheduler, or authoritative state store.

## 11. Observability / control / audit integration

Every failure outcome that changes durable run state must use Stage 12.1 correlation and structured lifecycle telemetry. Operational actions continue through Stage 12.2 APIs and authorization. Material transitions and rejected controls continue to create Stage 12.3 audit facts inside the existing transaction boundary.

The implementation must not add a parallel failure-event dispatcher or independent failure database.

## 12. Acceptance gates

Stage 12.4 implementation is complete only when all of the following are GREEN on the exact feature-branch HEAD:

- typecheck
- API build
- existing full test suite
- existing 64-case benchmark
- new failure-injection tests
- new SLO/metric contract tests
- crash/recovery/fencing regression tests
- Compose smoke
- no forbidden telemetry cardinality or sensitive-data regression
- documentation consistency checks

Then merge only after branch-head CI is GREEN, and verify a separate mainline CI run against the exact merge SHA.

## 13. Design gate

The design/approval gate has been **accepted**. Implementation is now permitted under the locked failure taxonomy, SLO baseline, timeout/retry semantics, backpressure model, failure-injection matrix, and acceptance gates above. No second durable runtime model may be introduced.
