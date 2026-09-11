# Agent-native Enterprise Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, enterprise-grade Agent-native runtime whose application contract is independent of AgentScope, LangGraph, Eino, and Mastra.

**Architecture:** The platform core owns Agent Run state, turns, tool execution, permissions, idempotency, outbox, event log, checkpointing, recovery, and cancellation. Frameworks are adapters behind a stable Runtime Contract. PostgreSQL is the durable system of record, Redis/queue handles asynchronous delivery, and Vercel hosts the web/API edge while the durable worker remains independently deployable.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, PostgreSQL, Redis, Node.js workers, Docker Compose, Vercel-compatible Node request boundary. Adapter packages will be added incrementally for AgentScope, LangGraph, Eino, and Mastra.

**Spec:** Project architecture and benchmark specification from the prior design conversation, including Tool Permission, Crash Recovery, Outbox + Idempotency, and the 16-case adapter benchmark.

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

**Status:** In progress — all 16 benchmark definitions, the 64-case adapter matrix, the unified runner contract, and executable scenario work through B16 are present. Run #275 exposed two issues on the then-checked-out PR merge head: the benchmark case-id contract was too broad for the B14-B16 `Extract<>` type, and the Compose benchmark reported four B16 assertion failures. The B16 log came from an older merge head whose assertion expected `terminal completions: 1`, while the current benchmark test contract expects the canonical `outbox events: 1`; the current B16 PostgreSQL scenario itself reports exactly one claim winner, one logical effect, and one outbox event. The type defect is now fixed by making the 16 benchmark IDs a closed `BenchmarkCaseId` union in commit `2aaf4f435f7b04bf98ef6e18305457abe2d54751`. A fresh CI run is required to verify the fix against the current branch head.

- [x] Encode every benchmark with fixture, initial DB state, Mock LLM/Tool, exact steps, SQL assertions, expected result, and failure criteria.
- [x] Execute the same matrix across all four adapters through one framework-neutral contract.
- [ ] Replace the contract-only runner with real scenario execution and hard safety-invariant gates.
- [x] Start real scenario execution with B01-B08 using the actual ToolExecutionService and OutboxPublisher against deterministic scenario stores.
- [x] Implement executable B09-B13 recovery/crash scenarios using the real RecoveryCoordinator and recovery-store semantics.
- [x] Implement executable B14-B16 retry/backoff, terminal-failure, and concurrent-worker scenarios.
- [ ] Emit deterministic machine-readable benchmark results and CI artifacts.

### Task 8: Local Docker Compose environment

**Status:** Complete for the current application boundary — PostgreSQL, Redis, deterministic migration/seed, worker smoke service, benchmark smoke service, Compose health/dependency gates, and CI Compose validation are implemented. The repository intentionally does not fabricate a fake model provider or a fake durable API runtime. The real request boundary is implemented under Task 9 and will be connected to a durable runtime composition when that runtime composition is available.

- [x] Bring up the currently implemented local infrastructure: PostgreSQL, Redis, migration, worker smoke service, and benchmark runner.
- [x] Add health checks and deterministic seed data.
- [x] Add a single CI-style smoke-test sequence using `docker compose up --build -d`, `docker compose wait benchmark`, and an explicit benchmark exit-code assertion.
- [x] Keep fake API/web/mock-LLM services out of Compose until their corresponding production boundaries are implemented safely.

### Task 9: Vercel deployment boundary

**Status:** Complete — package/API boundary, provider-neutral LLM gateway contract, stateless request handler, static worker-dependency safety contract, deployment documentation, explicit API typecheck/build contract, and CI verification are all passing in Run #189. The remaining unchecked composition-root item is intentionally deferred until a real durable runtime/repository composition exists.

- [x] Keep durable worker/database operations outside request-lifetime assumptions.
- [x] Route model calls through a provider-agnostic LLM gateway boundary.
- [x] Document environment variables, deployment topology, and failure semantics.
- [x] Add API typecheck/build commands and a build-contract test.
- [x] Verify the revised CI workflow with API typecheck/build passes (Run #189).
- [x] Verify focused boundary tests, full test suite, repository typecheck, API typecheck/build, and Compose smoke/configuration (Run #189).

### Task 10: CI and verification

**Status:** In progress. Run #275 failed before the normal test suite because repository typecheck stopped on B14-B16: `Extract<BenchmarkCase['id'], 'B14' | 'B15' | 'B16'>` evaluated to `never` because `BenchmarkCase['id']` was only `B${string}`. The Compose job independently executed 90 benchmark tests and reached B16; only the four adapter-specific B16 assertions failed on the older merge head, while B01-B15 passed and the worker/migration smoke checks passed. The type contract has now been corrected in commit `2aaf4f435f7b04bf98ef6e18305457abe2d54751`; the next CI run is the authoritative verification for this fix.

- [x] Run type checking, unit/integration tests, and deployment-boundary contract tests in CI.
- [x] Add a workspace packaging contract covering stable `main`/`types`/root `exports` and workspace dependency exportability.
- [ ] Verify the workspace packaging contract in CI after the entrypoint hardening changes.
- [ ] Verify the closed benchmark-case type and B09-B16 executable scenarios in CI after Run #275.
- [ ] Add/verify formatting checks if the repository adopts a formatter contract.
- [ ] Require all benchmark safety contracts before merge.
- [ ] Publish deterministic benchmark artifacts.

## Run #275 root-cause checkpoint

- `test` job failed at repository `pnpm typecheck`, before API typecheck/build, deployment-boundary verification, benchmark hard gate, and the full test suite.
- Exact compiler failures were B14/B15/B16 arguments rejected as `never` in `packages/benchmark/src/postgres-tail-scenarios.test.ts`.
- `compose-smoke` reached the real 64-scenario matrix and reported 86 passing tests / 4 failing B16 adapter assertions. PostgreSQL, Redis, migration, and worker smoke all started successfully; the benchmark container alone exited 1.
- The four B16 failures were identical and reflected an assertion-contract mismatch on the older PR merge head (`terminal completions: 1` expected versus the current canonical B16 detail contract using `outbox events: 1`). No PostgreSQL claim-safety failure was observed: the scenario reported `claim winners: 1; logical effects: 1; outbox events: 1`.
- Fix commit: `2aaf4f435f7b04bf98ef6e18305457abe2d54751` — close `BenchmarkCase['id']` over the exact B01-B16 set so the existing B14-B16 `Extract<>` types are sound.
- No CI result is claimed for the fix yet; the commit currently has no workflow run attached at the time this plan was updated.

## Resubmission checkpoint

- The PR is `#3`, targeting `main`, and its live head is `7b089fc92627364bfb1cdf4a702462ae9726a20a`.
- Run #275 was executed against the earlier merge head `b79d5a27d029aea3cacbf4e69b8f69c07ad80d79`, not the current PR head. The current head is five commits ahead of that run and contains the closed benchmark-case fix plus the synchronized plan/test changes.
- GitHub currently reports no workflow run attached to either the fix commit or the current head. Therefore this checkpoint deliberately makes no GREEN claim.
- The next authoritative evidence must be a new `pull_request` CI run for the current head, followed by inspection of every job before marking Task 10 verification items complete.
