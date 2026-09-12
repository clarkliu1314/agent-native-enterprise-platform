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

## Task 1: Runtime Contract and test harness
- [x] Write contract tests for initial run creation, valid state transitions, checkpoint/recovery, cancellation, and invalid transitions.
- [x] Run the tests and confirm they fail because the runtime contract implementation is absent.
- [x] Add only the minimal type/runtime implementation needed for the tests.
- [x] Run the complete contract test suite.
- [x] Refactor while keeping the contract tests green.

## Task 2: In-memory reference runtime
- [x] Write failing lifecycle tests.
- [x] Verify RED.
- [x] Implement minimal state machine.
- [x] Verify GREEN.
- [x] Add recovery and cancellation edge cases.

## Task 3: Durable persistence model
- [x] Add database contract tests against PostgreSQL.
- [x] Verify RED for missing tables/operations.
- [x] Implement schema and repository.
- [x] Verify GREEN and transaction rollback behavior.

## Task 4: Tool Permission, Idempotency, and Outbox
- [x] Specify allow/deny conditions and default-deny behavior in tests.
- [x] Specify duplicate request semantics and result replay in tests.
- [x] Specify transactional outbox insertion and publish/retry semantics in tests.
- [x] Implement the minimal passing versions.

## Task 5: Crash recovery
- [x] Add crash-point fixtures for before tool execution, after external effect, after result persistence, and before outbox publish.
- [x] Verify each fixture fails before recovery logic exists.
- [x] Implement deterministic recovery using persisted state and idempotency records.
- [x] Verify no duplicate business effect is produced.

**Production follow-up:** Issue #2 was completed after durable candidate discovery, atomic `FOR UPDATE SKIP LOCKED` claims, lease/token ownership, expired-lease reclaim, durable retry/backoff and terminal classification, crash-safe restart tests, structured recovery outcomes, and CI Run #141 passed.

## Task 6: Four framework adapters
- [x] Define one adapter interface over the runtime contract.
- [x] Implement reference adapters and capability declarations.
- [x] Run the same contract tests against every adapter.

## Task 7: 16-case benchmark

**Status:** Complete. All 16 benchmark definitions, the 64-case adapter matrix, framework-neutral execution, real executable scenarios through B16, deterministic machine-readable artifact generation, and CI hard safety gates are implemented. The authoritative post-fix CI runs #287 and #288 both passed on the merged benchmark head. The benchmark artifact is uploaded as `benchmark-results` and the hard gate requires schemaVersion 1, exactly 64 results, 64 passed, zero failed, and zero invariant violations.

- [x] Encode every benchmark with fixture, initial DB state, Mock LLM/Tool, exact steps, SQL assertions, expected result, and failure criteria.
- [x] Execute the same matrix across all four adapters through one framework-neutral contract.
- [x] Replace the contract-only runner with real scenario execution and hard safety-invariant gates.
- [x] Start real scenario execution with B01-B08 using the actual ToolExecutionService and OutboxPublisher against deterministic scenario stores.
- [x] Implement executable B09-B13 recovery/crash scenarios using the real RecoveryCoordinator and recovery-store semantics.
- [x] Implement executable B14-B16 retry/backoff, terminal-failure, and concurrent-worker scenarios.
- [x] Emit deterministic machine-readable benchmark results and CI artifacts.

## Task 8: Local Docker Compose environment

**Status:** Complete for the current application boundary. PostgreSQL, Redis, deterministic migration/seed, worker smoke service, benchmark smoke service, Compose health/dependency gates, and CI Compose validation are implemented. The durable API/worker runtime composition is now being wired under the approved Durable Runtime Composition plan.

- [x] Bring up the currently implemented local infrastructure: PostgreSQL, Redis, migration, worker smoke service, and benchmark runner.
- [x] Add health checks and deterministic seed data.
- [x] Add a single CI-style smoke-test sequence using `docker compose up --build -d`, `docker compose wait benchmark`, and an explicit benchmark exit-code assertion.
- [x] Keep fake API/web/mock-LLM services out of Compose until their corresponding production boundaries are implemented safely.

## Task 9: Vercel deployment boundary

**Status:** Complete for the stateless request boundary; durable composition wiring is in progress under the approved 2026-09-12 implementation plan.

- [x] Keep durable worker/database operations outside request-lifetime assumptions.
- [x] Route model calls through a provider-agnostic LLM gateway boundary.
- [x] Document environment variables, deployment topology, and failure semantics.
- [x] Add API typecheck/build commands and a build-contract test.
- [x] Verify the revised CI workflow with API typecheck/build passes (Run #189).
- [x] Verify focused boundary tests, full test suite, repository typecheck, API typecheck/build, and Compose smoke (Run #189).
- [x] Add the stateless durable handler contract: async 202, bounded sync 200/202, idempotency conflict 409, and durable GET state.
- [ ] Verify the new RuntimeFacade-backed composition against fresh CI.

## Task 10: CI and verification

**Status:** Benchmark/application foundation is complete; durable runtime composition is now the active verification gate. Run #354 is the latest fully green validation of the pre-integration composition head. Later commits added PostgreSQL schema alignment, repository integration tests, and a CI migration step; they require a fresh authoritative run.

- [x] Run type checking, unit/integration tests, and deployment-boundary contract tests in CI.
- [x] Add a workspace packaging contract covering stable `main`/`types`/root `exports` and workspace dependency exportability.
- [x] Verify the workspace packaging contract in CI after the entrypoint hardening changes.
- [x] Verify the closed benchmark-case type and B09-B16 executable scenarios in CI after Run #275.
- [x] Add/verify formatting checks if the repository adopts a formatter contract.
- [x] Require all benchmark safety contracts before merge.
- [x] Publish deterministic benchmark artifacts.
- [ ] Verify durable PostgreSQL repository integration against the migrated schema in fresh CI.
- [ ] Verify end-to-end API → durable state → Worker/Recovery/Outbox behavior.

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

## Durable Runtime Composition checkpoint

The approved Durable Runtime Composition + Vercel Request-Boundary Design has moved from design-only status into implementation on `feat/durable-runtime-composition` (PR #5). The dedicated implementation plan is `docs/superpowers/plans/2026-09-12-durable-runtime-composition.md`.

Implemented in the current slice: framework-neutral durable RuntimeFacade contracts, PostgreSQL repository/transaction primitives, atomic Run admission, six-state lifecycle transitions, Event + Outbox atomic persistence, API idempotency replay/conflict, lease/fencing, Tool/Model durable-step boundaries, opaque checkpoints, RecoveryCoordinator, OutboxPublisher, facade-driven DurableWorker, fenced lease heartbeat, Redis Streams publisher/consumer, and separate API/Worker/Recovery/Outbox composition roots. The API preserves stateless request semantics and bounded sync execution.

A material schema drift was found before claiming the new slice green: the existing Compose migration still described the earlier benchmark-oriented `agent_runs`/`outbox_events` shape, while the new repositories require fencing, lifecycle timestamps, event sequencing, idempotency, checkpoints, tool calls, and publisher claim fields. The migration was aligned and a real PostgreSQL integration test was added. CI now explicitly applies `infra/compose/migrate.sql` before running the repository suite.

Current authoritative verification boundary: **fresh CI after commits `54629dc`, `a8d7271`, `8fd3436`, and the documentation checkpoint is required.** Do not mark this composition phase GREEN until the integration tests, full suite, benchmark hard gate, API build/boundary, and Compose smoke all pass on the same current head.

### Approved durable runtime architecture remains locked

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

## Next implementation gate

Do not move to the investment-domain application until the durable runtime composition is green under a fresh authoritative CI run and the end-to-end API → PostgreSQL → Outbox/Redis → Worker/Recovery path is verified. After that gate, proceed to the equity-investment domain layer on top of the stable RuntimeFacade rather than coupling business logic to any framework adapter.
