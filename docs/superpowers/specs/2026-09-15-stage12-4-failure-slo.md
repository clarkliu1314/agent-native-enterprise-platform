# Stage 12.4 — Failure & SLO Specification

**Status: CLOSED / COMPLETE**  
**Date:** 2026-09-15  
**Architecture baseline:** A

## 1. Goal

Define production-grade failure semantics and measurable service objectives for the durable Agent-native runtime, without introducing a second runtime, scheduler, or authoritative state store.

The design makes failures observable, bounded, recoverable where safe, and auditable where they change durable state. PostgreSQL remains the durable source of truth; Redis remains delivery/scheduling infrastructure; `RuntimeFacade` remains the framework-neutral application boundary.

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

Recovery may resume only from the last committed checkpoint. Stale workers are fenced before they can commit. Crash recovery tests prove that an interrupted step is neither silently lost nor applied twice when an effectful operation has an idempotency key.

## 7. Backpressure and concurrency

Backpressure is an admission/scheduling concern, not a new source of truth.

- Define bounded per-process worker concurrency.
- Prefer durable queue state and existing Redis delivery signals over process-local queues as authoritative state.
- When capacity is exhausted, retain durable `QUEUED` work and expose queue age/depth metrics.
- Reject or defer new work deterministically when configured admission limits are exceeded.
- Operational controls remain the mechanism for pause/resume/cancel/recover; backpressure must not invent control semantics.

## 8. SLI/SLO baseline

The initial targets are:

| SLI | Measurement | Initial SLO |
|---|---|---:|
| API handoff success | accepted durable commands / valid authorized requests | >= 99.9% |
| Durable command completion | commands reaching terminal state within configured target window | >= 99.0% |
| Worker recovery latency | recoverable failures to next valid recovery claim | >= 99.0% within 60s |
| Outbox delivery | eligible outbox records delivered within configured target | >= 99.0% within 60s |
| Audit completeness | material transitions/rejections with corresponding audit fact | 100% |

SLO windows use a rolling 30-day operational window for policy purposes. Metric labels remain bounded: tenant identifiers, run IDs, request IDs, prompts, completions, and arbitrary resource IDs are not metric labels.

## 9. Error budget and alerting

For availability-style SLOs, error budget is `1 - SLO`. Alerting has two levels:

- **Fast-burn:** sustained rapid budget consumption indicating an active incident; page/urgent operational response.
- **Slow-burn:** persistent degradation consuming budget over the rolling window; ticket/review response.

Audit completeness is a correctness invariant, not a tradeable error budget: any detected gap is a release-blocking failure until explained and remediated.

## 10. Failure-injection matrix

Required scenarios were implemented and regression-tested:

1. PostgreSQL unavailable during command transaction.
2. PostgreSQL failure after business write but before commit.
3. PostgreSQL failure during checkpoint persistence.
4. Outbox publisher failure before delivery.
5. Outbox publisher crash after delivery attempt; duplicate publication remains safe.
6. Worker crash before checkpoint commit.
7. Worker crash after checkpoint commit.
8. Stale worker attempts commit after recovery fencing.
9. Effectful tool timeout with unknown completion state.
10. API/client timeout after durable command acceptance.
11. Redis delivery degradation while PostgreSQL remains available.
12. Worker concurrency saturation and queue growth.
13. Recovery retry exhaustion leading to `FAILED`.
14. Cancellation racing with an in-flight worker transaction.
15. Audit write failure inside a transaction: business transition rolls back atomically.
16. Observability emission failure outside business transaction: business correctness remains unaffected.

Each implementation test specifies the relevant durable-state, replay/idempotency, telemetry, and audit invariant.

## 11. Observability / control / audit integration

Failure outcomes that change durable run state use Stage 12.1 correlation and structured lifecycle telemetry. Operational actions continue through Stage 12.2 APIs and authorization. Material transitions and rejected controls continue to create Stage 12.3 audit facts inside the existing transaction boundary.

No parallel failure-event dispatcher or independent failure database was introduced.

## 12. Acceptance evidence

Stage 12.4 passed the complete acceptance gate:

- Typecheck — GREEN on final feature-branch CI.
- API build — GREEN.
- Existing 64-case benchmark — GREEN and unchanged.
- Stage 12.4 Failure/SLO benchmark — GREEN: 4 scenarios × 4 adapters = 16 cases.
- Failure-injection tests — GREEN.
- Crash/recovery/fencing regression tests — GREEN.
- Compose smoke — GREEN.
- Metric-cardinality and sensitive-data assertions — GREEN.
- Full test suite — GREEN.
- Documentation consistency/closeout — recorded separately.
- Feature branch `feat/stage12-4-failure-policy-test2` final HEAD `b360d5fe808466921f1bcd5754d88d3b2d9e9bcc` — **Run #817 GREEN**.
- PR #31 — **MERGED**.
- Merge SHA `19e108a719ced4f6cb026879675102f3c8826e88` — **Run #818 GREEN** on exact mainline merge SHA.

The original 16-case × 4-adapter = 64-case benchmark was preserved. The additional 16-case Failure/SLO benchmark validates framework-neutral durable invariants; infrastructure-specific PostgreSQL/Redis fault behavior remains covered by dedicated runtime failure-injection tests.

## 13. Design gate and transition

The design/approval gate was accepted before implementation. Implementation and exact merge-SHA mainline verification are now complete.

**Stage 12.4 is CLOSED / COMPLETE.** The next planned stage is **Stage 12.5 — Security Hardening**, covering secret handling, tenant-isolation verification, least privilege, retention, and security regression gates.
