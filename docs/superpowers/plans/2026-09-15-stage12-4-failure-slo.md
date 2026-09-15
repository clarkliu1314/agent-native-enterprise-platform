# Stage 12.4 Failure & SLO Implementation Plan

> **Status: CLOSED / COMPLETE (2026-09-15).** This document remains the historical task-by-task implementation record; the closeout record is authoritative for final evidence.

**Goal:** Implement measurable failure semantics, SLO/error-budget controls, and deterministic failure-injection coverage for the durable Agent-native runtime without changing the authoritative runtime model.

**Architecture:** Extend the existing RuntimeFacade, worker/recovery, Outbox, observability, operational-control, and audit boundaries. PostgreSQL remains authoritative; Redis remains delivery/scheduling infrastructure. Timeout/retry/backpressure behavior is expressed through the existing Run FSM and durable attempt/idempotency/fencing mechanisms.

**Tech Stack:** TypeScript, PostgreSQL, Redis, existing RuntimeFacade/application composition, Vitest, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-stage12-4-failure-slo.md`

**Final status (2026-09-15):** Tasks 1–7 completed. Feature branch `feat/stage12-4-failure-policy-test2` passed exact branch-head CI Run #817 on `b360d5fe808466921f1bcd5754d88d3b2d9e9bcc`. PR #31 merged to `main` as `19e108a719ced4f6cb026879675102f3c8826e88`. Authoritative mainline CI Run #818 passed on the exact merge SHA. Stage 12.4 is closed; transition to Stage 12.5 Security Hardening is now permitted.

## File map

- `packages/runtime/src/*` — failure classification, timeout/retry/backpressure policy, durable recovery semantics, and SLO-facing measurements.
- `apps/api/src/*` — API handoff/timeout boundary where required by the existing stateless composition root.
- `tests/*failure*.test.ts`, `tests/*slo*.test.ts`, `tests/*recovery*.test.ts` — failure injection, SLO contract, crash/recovery, and regression coverage.
- `docs/superpowers/specs/2026-09-15-stage12-4-failure-slo.md` — authoritative design/specification.
- `docs/superpowers/plans/2026-09-15-stage12-4-failure-slo.md` — this historical implementation plan.

Do not create a second runtime, scheduler, event dispatcher, authoritative Redis state, or parallel audit store.

## Task 1 — Establish failure/SLO contracts

- [x] Inspect existing error codes, lifecycle telemetry, Run FSM, attempt/recovery, and configuration patterns.
- [x] Write failing unit/contract tests for failure classification and retryability.
- [x] Implement minimal framework-neutral failure taxonomy and policy interfaces.
- [x] Add tests for terminal vs retryable failures and bounded backoff.
- [x] Verify no new Run FSM state is introduced.
- [x] Commit `feat(stage12.4): define failure policy contracts`.

## Task 2 — Implement timeout semantics

- [x] Write failing tests for API handoff, worker execution, tool, and recovery timeout boundaries.
- [x] Implement typed timeout outcomes at existing boundaries.
- [x] Verify client/API timeout after durable acceptance does not falsely mark the run failed.
- [x] Verify effect-uncertain tool retry requires existing durable idempotency.
- [x] Run targeted tests and commit `feat(stage12.4): implement timeout semantics`.

## Task 3 — Implement backpressure/concurrency policy

- [x] Write failing tests for bounded worker concurrency and queue saturation.
- [x] Implement admission/backpressure using existing durable queue state and delivery mechanisms.
- [x] Verify saturation does not introduce process-memory authoritative state.
- [x] Verify queued work remains durable and operational pause/resume semantics remain unchanged.
- [x] Run targeted tests and commit `feat(stage12.4): add bounded backpressure policy`.

## Task 4 — Add SLI/SLO and error-budget measurements

- [x] Map the five SLI definitions to existing Stage 12.1 metric/error-code primitives.
- [x] Write failing metric-contract tests for bounded labels and required measurements.
- [x] Implement SLI calculations and configurable SLO targets.
- [x] Implement fast-burn/slow-burn alert-threshold configuration without hard-coding deployment-specific alert infrastructure into the runtime.
- [x] Verify audit completeness remains a correctness invariant rather than an error-budget tradeoff.
- [x] Run targeted observability tests and commit `feat(stage12.4): add SLO measurements`.

## Task 5 — Failure injection and recovery hardening

- [x] Add deterministic PostgreSQL transaction-failure injections.
- [x] Add Outbox pre-delivery and post-attempt crash/failure injections.
- [x] Add worker crash before/after checkpoint commit.
- [x] Add stale-worker fencing assertions across run transition, event append, checkpoint, and atomic run-progress writes.
- [x] Add effect-uncertain tool timeout/idempotency replay tests.
- [x] Add API timeout-after-acceptance test.
- [x] Add Redis degradation and concurrency saturation tests.
- [x] Add retry-exhaustion-to-`FAILED` and cancellation-race tests.
- [x] Add audit atomicity and telemetry-isolation regression tests.
- [x] Run all new failure-injection tests and commit `test(stage12.4): cover failure injection matrix`.

### Task 5 evidence recorded

- PostgreSQL transaction-failure coverage proves post-write failure before commit rolls back both Run and Event writes.
- Durable PostgreSQL coverage exercises lease expiry → reclaim → fencing token increment, then proves the stale owner cannot transition the Run, append an Event, persist a Checkpoint, or commit Run metadata/checkpoint progress.
- Existing cancellation-race and checkpoint-transaction-rollback integration tests remain part of the durable regression surface.
- `packages/runtime/src/outbox-publisher.failure-injection.test.ts` covers both pre-delivery failure and post-attempt acknowledgement loss under existing at-least-once semantics.
- Effect-uncertain replay, API timeout-after-acceptance, Redis degradation, worker saturation, retry exhaustion, audit atomicity, and telemetry isolation are covered by the Stage 12.4 failure-injection regression suite.
- No runtime architecture change was introduced; existing PostgreSQL fencing, Outbox claim/ack/retry, recovery, and observability boundaries are being regression-tested rather than duplicated.

## Task 6 — Production benchmark integration

- [x] Add Stage 12.4 benchmark cases with explicit initial DB state, injected fault, expected durable state, audit, telemetry, and replay assertions.
- [x] Integrate them into the existing unified benchmark adapter surface without weakening the existing 64-case gate.
- [x] Verify adapter/framework neutrality.
- [x] Run the complete benchmark suite and commit `test(stage12.4): add failure and SLO benchmark gates`.

### Task 6 evidence recorded

- Added `packages/benchmark/src/failure-slo-benchmark.ts` and its contract test.
- Four failure/SLO scenarios (`F01`–`F04`) are exercised across all four adapters (`agentscope`, `langgraph`, `eino`, `mastra`) for 16 adapter/scenario combinations.
- The new gate validates durable lifecycle, checkpoint/recovery identity, replay invariants, and absence of invariant violations across the unified adapter surface.
- The original 16-case × 4-adapter = 64-case hard gate remains unchanged.
- Infrastructure-specific PostgreSQL/Redis failure semantics remain covered by the runtime failure-injection suite; the cross-adapter benchmark intentionally validates framework-neutral durable invariants rather than duplicating infrastructure fault machinery.
- CI Run #817 passed on exact feature-branch HEAD `b360d5fe808466921f1bcd5754d88d3b2d9e9bcc`, including typecheck, API build, 64-case benchmark, Failure/SLO benchmark gate, full tests, and Compose smoke.

## Task 7 — Full verification and documentation

- [x] Run typecheck.
- [x] Run API build.
- [x] Run full test suite.
- [x] Run existing 64-case benchmark.
- [x] Run Stage 12.4 failure/SLO tests.
- [x] Run crash/recovery/fencing regression tests.
- [x] Run Compose smoke.
- [x] Review metric cardinality and sensitive-data assertions.
- [x] Update master plan after implementation evidence was available.
- [x] Keep implementation PR Draft until exact branch-head CI is GREEN.
- [x] Merge only with expected branch HEAD and verify mainline CI against exact merge SHA.
- [x] Create a separate Stage 12.4 closeout documentation change recording branch, PR, merge SHA, and authoritative mainline run.

### Task 7 evidence recorded

- Implementation branch: `feat/stage12-4-failure-policy-test2`.
- Final feature-branch HEAD: `b360d5fe808466921f1bcd5754d88d3b2d9e9bcc`.
- Final feature-branch CI: **Run #817 — GREEN**.
- PR #31: merged after exact branch-head verification.
- Merge SHA: `19e108a719ced4f6cb026879675102f3c8826e88`.
- Authoritative mainline CI: **Run #818 — GREEN** on the exact merge SHA.
- Documentation closeout is maintained separately on `docs/stage12-4-closeout`.

## Engineering constraints

- TDD for every code/behavior change.
- Use existing transaction boundaries; never split a durable transition into compensating writes merely for metrics/audit.
- Do not turn Redis or process memory into authoritative state.
- Do not add a second event dispatcher or runtime.
- Preserve tenant isolation, actor attribution, optimistic concurrency, idempotency, fencing, and sensitive-data protections.
- Every completion claim requires fresh verification evidence.
