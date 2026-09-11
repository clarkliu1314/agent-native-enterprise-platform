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

**Status:** In progress — benchmark schema, all 16 data-driven cases, 64-case adapter matrix, and unified adapter execution contract are implemented. CI Run #149 passed. The remaining work is real scenario execution against permission/idempotency/outbox/recovery semantics and deterministic result artifacts.

- [x] Encode every benchmark with fixture, initial DB state, Mock LLM/Tool, exact steps, SQL assertions, expected result, and failure criteria.
- [x] Execute the same matrix across all four adapters through one framework-neutral contract.
- [ ] Replace the contract-only runner with real scenario execution and hard safety-invariant gates.
- [ ] Emit deterministic machine-readable benchmark results and CI artifacts.

### Task 8: Local Docker Compose environment

**Status:** In progress — PostgreSQL, Redis, deterministic migration/seed, worker smoke service, benchmark smoke service, Compose health/dependency gates, and CI Compose validation are implemented. The repository intentionally does not fabricate a fake model provider or a durable API runtime. The Vercel request boundary is now documented separately; a runnable API service remains gated on a real durable runtime composition.

- [x] Bring up the currently implemented local infrastructure: PostgreSQL, Redis, migration, worker smoke service, and benchmark runner.
- [x] Add health checks and deterministic seed data.
- [x] Add a single CI-style smoke-test sequence using `docker compose up --build -d`, `docker compose wait benchmark`, and an explicit benchmark exit-code assertion.
- [ ] Add a real API/web/mock-LLM service only when the corresponding application/runtime boundaries are implemented safely.

### Task 9: Vercel deployment boundary

**Status:** Complete — package/API boundary, provider-neutral LLM gateway contract, stateless request handler, static worker-dependency safety contract, deployment documentation, explicit API typecheck/build contract, and CI verification are all passing.

- [x] Keep durable worker/database operations outside request-lifetime assumptions.
- [x] Route model calls through a provider-agnostic LLM gateway boundary.
- [x] Document environment variables, deployment topology, and failure semantics.
- [x] Add API typecheck/build commands and a build-contract test.
- [x] Verify the revised CI workflow with API typecheck/build passes (Run #189).
- [x] Verify focused boundary tests, full test suite, repository typecheck, API typecheck/build, and Compose smoke/configuration (Run #189).

### Task 10: CI and verification

**Status:** In progress — CI now explicitly verifies repository typecheck, API typecheck/build, deployment-boundary tests, full tests, and Compose smoke. Remaining work is benchmark result artifact publication and final merge-gate hardening.

- [x] Run type checking, unit/integration tests, and deployment-boundary contract tests in CI.
- [ ] Add/verify formatting checks if the repository adopts a formatter contract.
- [ ] Require all benchmark safety contracts before merge.
- [ ] Publish deterministic benchmark artifacts.
