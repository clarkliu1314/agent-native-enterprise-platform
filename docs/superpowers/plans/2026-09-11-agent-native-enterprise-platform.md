# Agent-native Enterprise Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, enterprise-grade Agent-native runtime whose application contract is independent of AgentScope, LangGraph, Eino, and Mastra.

**Architecture:** The platform core owns Agent Run state, turns, tool execution, permissions, idempotency, outbox, event log, checkpointing, recovery, and cancellation. Frameworks are adapters behind a stable Runtime Contract. PostgreSQL is the durable system of record, Redis/queue handles asynchronous delivery, and Vercel hosts the web/API edge while the durable worker remains independently deployable.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, PostgreSQL, Redis, Node.js workers, Docker Compose, Vercel-compatible Node request boundary. Adapter packages will be added incrementally for AgentScope, LangGraph, Eino, and Mastra.

**Spec:** Project architecture and benchmark specification from the prior design conversation, including Tool Permission, Crash Recovery, Outbox + Idempotency, the 16-case adapter benchmark, and the approved Durable Runtime Composition + Vercel Request-Boundary Design in `docs/superpowers/specs/2026-09-12-durable-runtime-composition-design.md`.

## Global Constraints

- Agent Framework != Agent Runtime.
- Runtime Contract is the stable application-facing abstraction.
- Every externally effectful tool call must be authorized and idempotent.
- Durable state transitions and outbox publication must use an explicit transaction boundary.
- Recovery must be deterministic from persisted state/events/checkpoints.
- Adapter behavior is measured through one identical contract and benchmark suite.
- No production code is introduced before its corresponding test has demonstrated the intended failure mode.

### Task 1: Runtime Contract and test harness
- [x] Write contract tests for initial run creation, valid state transitions, checkpoint/recovery, cancellation, and invalid transitions.
- [x] Run the tests and confirm they fail because the runtime contract implementation is absent.
- [x] Add only the minimal type/runtime implementation needed for the tests.
- [x] Run the complete contract test suite.
- [x] Refactor while keeping the contract tests green.

### Task 2: In-memory reference runtime
- [x] Write failing lifecycle tests.
- [x] Verify RED.
- [x] Implement minimal state machine.
- [x] Verify GREEN.
- [x] Add recovery and cancellation edge cases.

### Task 3: Durable persistence model
- [x] Add database contract tests against PostgreSQL.
- [x] Verify RED for missing tables/operations.
- [x] Implement schema and repository.
- [x] Verify GREEN and transaction rollback behavior.

### Task 4: Tool Permission, Idempotency, and Outbox
- [x] Specify allow/deny conditions and default-deny behavior in tests.
- [x] Specify duplicate request semantics and result replay in tests.
- [x] Specify transactional outbox insertion and publish/retry semantics in tests.
- [x] Implement the minimal passing versions.

### Task 5: Crash recovery
- [x] Add crash-point fixtures for before tool execution, after external effect, after result persistence, and before outbox publish.
- [x] Verify each fixture fails before recovery logic exists.
- [x] Implement deterministic recovery using persisted state and idempotency records.
- [x] Verify no duplicate business effect is produced.

**Production follow-up:** Issue #2 was completed after durable candidate discovery, atomic `FOR UPDATE SKIP LOCKED` claims, lease/token ownership, expired-lease reclaim, durable retry/backoff and terminal classification, crash-safe restart tests, structured recovery outcomes, and CI Run #141 passed.

### Task 6: Four framework adapters
- [x] Define one adapter interface over the runtime contract.
- [x] Implement reference adapters and capability declarations.
- [x] Run the same contract tests against every adapter.

### Task 7: 16-case benchmark

**Status:** Complete. All 16 benchmark definitions, the 64-case adapter matrix, framework-neutral execution, real executable scenarios through B16, deterministic machine-readable artifact generation, and CI hard safety gates are implemented. The authoritative post-fix CI runs #287 and #288 both passed on the merged benchmark head. The benchmark artifact is uploaded as `benchmark-results` and the hard gate requires schemaVersion 1, exactly 64 results, 64 passed, zero failed, and zero invariant violations.

- [x] Encode every benchmark with fixture, initial DB state, Mock LLM/Tool, exact steps, SQL assertions, expected result, and failure criteria.
- [x] Execute the same matrix across all four adapters through one framework-neutral contract.
- [x] Replace the contract-only runner with real scenario execution and hard safety-invariant gates.
- [x] Start real scenario execution with B01-B08 using the actual ToolExecutionService and OutboxPublisher against deterministic scenario stores.
- [x] Implement executable B09-B13 recovery/crash scenarios using the real RecoveryCoordinator and recovery-store semantics.
- [x] Implement executable B14-B16 retry/backoff, terminal-failure, and concurrent-worker scenarios.
- [x] Emit deterministic machine-readable benchmark results and CI artifacts.

### Task 8: Local Docker Compose environment

**Status:** Complete for the current application boundary — PostgreSQL, Redis, deterministic migration/seed, worker smoke service, benchmark smoke service, Compose health/dependency gates, and CI Compose validation are implemented. The repository intentionally does not fabricate a fake model provider or a fake durable API runtime. The real request boundary is implemented under Task 9 and will be connected to a durable runtime composition when that runtime composition is available.

- [x] Bring up the currently implemented local infrastructure: PostgreSQL, Redis, migration, worker smoke service, and benchmark runner.
- [x] Add health checks and deterministic seed data.
- [x] Add a single CI-style smoke-test sequence using `docker compose up --build -d`, `docker compose wait benchmark`, and an explicit benchmark exit-code assertion.
- [x] Keep fake API/web/mock-LLM services out of Compose until their corresponding production boundaries are implemented safely.

### Task 9: Vercel deployment boundary

**Status:** Complete for the current architecture. The remaining unchecked composition-root item is intentionally deferred because the durable runtime/repository composition must be established before wiring it into the stateless request boundary.

- [x] Keep durable worker/database operations outside request-lifetime assumptions.
- [x] Route model calls through a provider-agnostic LLM gateway boundary.
- [x] Document environment variables, deployment topology, and failure semantics.
- [x] Add API typecheck/build commands and a build-contract test.
- [x] Verify the revised CI workflow with API typecheck/build passes (Run #189).
- [x] Verify focused boundary tests, full test suite, repository typecheck, API typecheck/build, and Compose smoke/configuration (Run #189).

### Task 10: CI and verification

**Status:** Complete for the current benchmark/application boundary. The previous Run #275 typecheck and B16 assertion failures were corrected. Authoritative Runs #287 and #288 on head `855994d58903c7cbc826d2fd7693e982f7fe7828` completed successfully; `test` and `compose-smoke` both passed. The test job passed repository typecheck, API typecheck/build, deployment-boundary verification, benchmark hard gate, artifact upload, and the full test suite. Compose smoke passed configuration, benchmark, worker, and migration assertions.

- [x] Run type checking, unit/integration tests, and deployment-boundary contract tests in CI.
- [x] Add a workspace packaging contract covering stable `main`/`types`/root `exports` and workspace dependency exportability.
- [x] Verify the workspace packaging contract in CI after the entrypoint hardening changes.
- [x] Verify the closed benchmark-case type and B09-B16 executable scenarios in CI after Run #275.
- [x] Add/verify formatting checks if the repository adopts a formatter contract.
- [x] Require all benchmark safety contracts before merge.
- [x] Publish deterministic benchmark artifacts.

## Run #275 root-cause checkpoint

- `test` job failed at repository `pnpm typecheck`, before API typecheck/build, deployment-boundary verification, benchmark hard gate, and the full test suite.
- Exact compiler failures were B14/B15/B16 arguments rejected as `never` in `packages/benchmark/src/postgres-tail-scenarios.test.ts`.
- `compose-smoke` reached the real 64-scenario matrix and reported 86 passing tests / 4 failing B16 adapter assertions. PostgreSQL, Redis, migration, and worker smoke all started successfully; the benchmark container alone exited 1.
- The four B16 failures were identical and reflected an assertion-contract mismatch on the older merge head (`terminal completions: 1` expected versus the current canonical B16 detail contract using `outbox events: 1`). No PostgreSQL claim-safety failure was observed: the scenario reported `claim winners: 1; logical effects: 1; outbox events: 1`.
- Fix commit: `2aaf4f435f7b04bf98ef6e18305457abe2d54751` — close `BenchmarkCase['id']` over the exact B01-B16 set so the existing B14-B16 `Extract<>` types are sound.
- This was subsequently validated by the authoritative post-fix CI runs #287/#288.

## Resubmission and merge checkpoint

- The benchmark work was resubmitted as PR #4 targeting `main`.
- PR #4 was merged into `main` at merge commit `36ed39503eae72f0878d2147e5997b49f2451e00`.
- Authoritative CI runs #287 and #288 both completed with `success` against benchmark head `855994d58903c7cbc826d2fd7693e982f7fe7828`.
- No benchmark GREEN claim is based on the earlier failed Runs #275/#277/#278; only the fresh post-fix runs are authoritative.

## Durable Runtime Composition Implementation Gate

**Status: Implementation in progress.** The approved design was converted into `docs/superpowers/plans/2026-09-12-durable-runtime-composition.md` in commit `aeeebb69aecebee3636ca6e3945ebf0d49ba6309`, and execution is underway on `feat/durable-runtime-composition` / PR #5.

Run #343 is authoritative GREEN for the preceding runtime slice: repository typecheck, API typecheck/build, deployment-boundary verification, benchmark hard gate (64/64), full test suite (173/173), and Compose smoke all passed. After that GREEN checkpoint, the implementation advanced with atomic lifecycle transition + Event + Outbox persistence, bounded-deadline continuation handling, and the first facade-driven durable worker queue service. These newest commits are separately gated by the next CI run and are not yet marked GREEN until verified.

**Design decisions locked:**

1. `POST /runs`: async by default (`202`), optional bounded sync (`200` if terminal within budget; otherwise `202` and durable continuation).
2. Scheduler: Outbox/Redis primary path with PostgreSQL `FOR UPDATE SKIP LOCKED` recovery fallback.
3. Worker ownership: lease + fencing token.
4. Fencing: PostgreSQL monotonic `BIGINT`, database-generated, checked on every durable worker write.
5. Run FSM: `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
6. PostgreSQL ownership: lifecycle, turns, model calls, tool calls, events, outbox, idempotency, checkpoints, and wait conditions have explicit responsibilities.
7. Application boundary: `RuntimeFacade` is the sole API/Worker/Recovery application boundary.
8. Dependency direction: RuntimeFacade depends only on framework-neutral Ports; composition roots inject infrastructure.
9. Tool execution: permission before effect; side-effecting tools require external idempotency or durable reconciliation/wait.
10. Model execution: independent durable Model Step with logical call identity, request hash, provider attempts, and replay policy.
11. Framework adapters: Runtime is the execution authority; adapters only drive framework execution and translate to the Runtime Contract.
12. Checkpoints: Runtime-owned envelope + Adapter-owned opaque payload.
13. API idempotency: PostgreSQL transactional idempotency key + command hash + original-response replay.
14. Event ordering: transactional Event + Outbox with per-Run monotonic sequence.
15. Composition roots: API, Worker, Recovery, and Outbox Publisher are separate processes/roots sharing the same Runtime implementation and framework-neutral Ports.

### Execution tracking

- [x] Write the detailed TDD-first implementation plan with explicit affected files, repository contracts, composition-root wiring, E2E cases, and verification checkpoints.
- [ ] Task 1 — PostgreSQL repository/transaction primitives.
- [ ] Task 2 — RuntimeFacade lifecycle services.
- [ ] Task 3 — Tool/Model durable execution steps.
- [ ] Task 4 — Checkpoint/Recovery.
- [ ] Task 5 — Worker/Outbox process roots.
- [ ] Task 6 — Vercel API composition.
- [ ] Task 7 — Recovery/Publisher process roots.
- [ ] Task 8 — API→durable state→Worker/Recovery E2E and documentation closeout.
