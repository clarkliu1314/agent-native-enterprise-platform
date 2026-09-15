# Stage 12.4 Failure & SLO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement measurable failure semantics, SLO/error-budget controls, and deterministic failure-injection coverage for the durable Agent-native runtime without changing the authoritative runtime model.

**Architecture:** Extend the existing RuntimeFacade, worker/recovery, Outbox, observability, operational-control, and audit boundaries. PostgreSQL remains authoritative; Redis remains delivery/scheduling infrastructure. Timeout/retry/backpressure behavior is expressed through the existing Run FSM and durable attempt/idempotency/fencing mechanisms.

**Tech Stack:** TypeScript, PostgreSQL, Redis, existing RuntimeFacade/application composition, Vitest, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-stage12-4-failure-slo.md`

## File map

Expected implementation touch points, to be confirmed against current code before editing:

- `packages/runtime/src/*` — failure classification, timeout/retry/backpressure policy, durable recovery semantics, and SLO-facing measurements.
- `apps/api/src/*` — API handoff/timeout boundary only where required by the existing stateless composition root.
- `tests/*failure*.test.ts`, `tests/*slo*.test.ts`, `tests/*recovery*.test.ts` — failure injection, SLO contract, crash/recovery, and regression coverage.
- `docs/superpowers/specs/2026-09-15-stage12-4-failure-slo.md` — authoritative design.
- `docs/superpowers/plans/2026-09-15-stage12-4-failure-slo.md` — implementation tracking.
- Existing Stage 12.1/12.2/12.3 files — reuse interfaces and verify no duplicate telemetry/control/audit model is introduced.

Do not create a second runtime, scheduler, event dispatcher, authoritative Redis state, or parallel audit store.

## Task 1 — Establish failure/SLO contracts

- [ ] Inspect existing error codes, lifecycle telemetry, Run FSM, attempt/recovery, and configuration patterns.
- [ ] Write failing unit/contract tests for failure classification and retryability.
- [ ] Implement minimal framework-neutral failure taxonomy and policy interfaces.
- [ ] Add tests for terminal vs retryable failures and bounded backoff.
- [ ] Verify no new Run FSM state is introduced.
- [ ] Commit `feat(stage12.4): define failure policy contracts`.

## Task 2 — Implement timeout semantics

- [ ] Write failing tests for API handoff, worker execution, tool, and recovery timeout boundaries.
- [ ] Implement typed timeout outcomes at existing boundaries.
- [ ] Verify client/API timeout after durable acceptance does not falsely mark the run failed.
- [ ] Verify effect-uncertain tool retry requires existing durable idempotency.
- [ ] Run targeted tests and commit `feat(stage12.4): implement timeout semantics`.

## Task 3 — Implement backpressure/concurrency policy

- [ ] Write failing tests for bounded worker concurrency and queue saturation.
- [ ] Implement admission/backpressure using existing durable queue state and delivery mechanisms.
- [ ] Verify saturation does not introduce process-memory authoritative state.
- [ ] Verify queued work remains durable and operational pause/resume semantics remain unchanged.
- [ ] Run targeted tests and commit `feat(stage12.4): add bounded backpressure policy`.

## Task 4 — Add SLI/SLO and error-budget measurements

- [ ] Map the five SLI definitions to existing Stage 12.1 metric/error-code primitives.
- [ ] Write failing metric-contract tests for bounded labels and required measurements.
- [ ] Implement SLI calculations and configurable SLO targets.
- [ ] Implement fast-burn/slow-burn alert-threshold configuration without hard-coding deployment-specific alert infrastructure into the runtime.
- [ ] Verify audit completeness remains a correctness invariant rather than an error-budget tradeoff.
- [ ] Run targeted observability tests and commit `feat(stage12.4): add SLO measurements`.

## Task 5 — Failure injection and recovery hardening

- [ ] Add deterministic PostgreSQL transaction-failure injections.
- [ ] Add Outbox pre-delivery and post-attempt crash/failure injections.
- [ ] Add worker crash before/after checkpoint commit.
- [ ] Add stale-worker fencing assertions.
- [ ] Add effect-uncertain tool timeout/idempotency replay tests.
- [ ] Add API timeout-after-acceptance test.
- [ ] Add Redis degradation and concurrency saturation tests.
- [ ] Add retry-exhaustion-to-`FAILED` and cancellation-race tests.
- [ ] Add audit atomicity and telemetry-isolation regression tests.
- [ ] Run all new failure-injection tests and commit `test(stage12.4): cover failure injection matrix`.

## Task 6 — Production benchmark integration

- [ ] Add Stage 12.4 benchmark cases with explicit initial DB state, injected fault, expected durable state, audit, telemetry, and replay assertions.
- [ ] Integrate them into the existing unified benchmark adapter surface without weakening the existing 64-case gate.
- [ ] Verify adapter/framework neutrality.
- [ ] Run the complete benchmark suite and commit `test(stage12.4): add failure and SLO benchmark gates`.

## Task 7 — Full verification and documentation

- [ ] Run typecheck.
- [ ] Run API build.
- [ ] Run full test suite.
- [ ] Run existing 64-case benchmark.
- [ ] Run Stage 12.4 failure/SLO tests.
- [ ] Run crash/recovery/fencing regression tests.
- [ ] Run Compose smoke.
- [ ] Review metric cardinality and sensitive-data assertions.
- [ ] Update master plan only after implementation evidence is available.
- [ ] Keep implementation PR Draft until exact branch-head CI is GREEN.
- [ ] Merge only with expected branch HEAD and then verify mainline CI against exact merge SHA.
- [ ] Create a separate Stage 12.4 closeout documentation change recording branch, PR, merge SHA, and authoritative mainline run.

## Engineering constraints

- TDD for every code/behavior change.
- Use existing transaction boundaries; never split a durable transition into compensating writes merely for metrics/audit.
- Do not turn Redis or process memory into authoritative state.
- Do not add a second event dispatcher or runtime.
- Preserve tenant isolation, actor attribution, optimistic concurrency, idempotency, fencing, and sensitive-data protections.
- Every completion claim requires fresh verification evidence.
