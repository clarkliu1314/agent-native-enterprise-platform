# Agent-native Enterprise Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, enterprise-grade Agent-native runtime whose application contract is independent of AgentScope, LangGraph, Eino, and Mastra.

**Architecture:** The platform core owns Agent Run state, turns, tool execution, permissions, idempotency, outbox, event log, checkpointing, recovery, and cancellation. Frameworks are adapters behind a stable Runtime Contract. PostgreSQL is the durable system of record, Redis/queue handles asynchronous delivery, and Vercel hosts the web/API edge while the durable worker remains independently deployable.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, PostgreSQL, Redis, Next.js, Node.js workers, Docker Compose. Adapter packages will be added incrementally for AgentScope, LangGraph, Eino, and Mastra.

**Spec:** Project architecture and benchmark specification from the prior design conversation, including Tool Permission, Crash Recovery, Outbox + Idempotency, and the 16-case adapter benchmark.

## Global Constraints

- Agent Framework != Agent Runtime.
- Runtime Contract is the stable application-facing abstraction.
- Every externally effectful tool call must be authorized and idempotent.
- Durable state transitions and outbox publication must use an explicit transaction boundary.
- Recovery must be deterministic from persisted state/events/checkpoints.
- Adapter behavior is measured through one identical contract and benchmark suite.
- No production code is introduced before its corresponding test has demonstrated the intended failure mode.

---

### Task 1: Runtime Contract and test harness

**Files:**
- Create: `packages/runtime-contract/src/index.ts`
- Create: `packages/runtime-contract/src/index.test.ts`
- Create: `packages/runtime-contract/package.json`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces `AgentRuntime`, `RunState`, `RunSnapshot`, `Turn`, and `ToolCall` types.
- Produces a framework-neutral runtime lifecycle: `startRun`, `executeTurn`, `checkpoint`, `recover`, `cancel`, `getRunState`.

- [ ] Write contract tests for initial run creation, valid state transitions, checkpoint/recovery, cancellation, and invalid transitions.
- [ ] Run the tests and confirm they fail because the runtime contract implementation is absent.
- [ ] Add only the minimal type/runtime implementation needed for the tests.
- [ ] Run the complete contract test suite.
- [ ] Refactor while keeping the contract tests green.

### Task 2: In-memory reference runtime

**Files:**
- Create: `packages/runtime/src/in-memory-runtime.ts`
- Create: `packages/runtime/src/in-memory-runtime.test.ts`
- Create: `packages/runtime/package.json`

**Interfaces:**
- Implements `AgentRuntime` from `@agent-native/runtime-contract`.
- Exposes deterministic state snapshots suitable for adapter contract tests.

- [ ] Write failing lifecycle tests.
- [ ] Verify RED.
- [ ] Implement minimal state machine.
- [ ] Verify GREEN.
- [ ] Add recovery and cancellation edge cases.

### Task 3: Durable persistence model

**Files:**
- Create: `packages/durability/src/schema.sql`
- Create: `packages/durability/src/repository.ts`
- Create: `packages/durability/src/repository.test.ts`
- Create: `infra/docker/postgres/init.sql`

**Interfaces:**
- Persist `agent_runs`, `turns`, `tool_calls`, `checkpoints`, `events`, `idempotency_records`, and `outbox_events`.
- Repository operations are transaction-aware and expose optimistic/concurrency-safe updates.

- [ ] Add database contract tests against PostgreSQL.
- [ ] Verify RED for missing tables/operations.
- [ ] Implement schema and repository.
- [ ] Verify GREEN and transaction rollback behavior.

### Task 4: Tool Permission, Idempotency, and Outbox

**Files:**
- Create: `packages/tool-permission/src/policy.ts`
- Create: `packages/tool-permission/src/policy.test.ts`
- Create: `packages/idempotency/src/store.ts`
- Create: `packages/idempotency/src/store.test.ts`
- Create: `packages/outbox/src/publisher.ts`
- Create: `packages/outbox/src/publisher.test.ts`

- [ ] Specify allow/deny conditions and default-deny behavior in tests.
- [ ] Specify duplicate request semantics and result replay in tests.
- [ ] Specify transactional outbox insertion and publish/retry semantics in tests.
- [ ] Implement the minimal passing versions.

### Task 5: Crash recovery

**Files:**
- Create: `packages/durability/src/recovery.ts`
- Create: `packages/durability/src/recovery.test.ts`
- Create: `apps/worker/src/recovery-worker.ts`

- [ ] Add crash-point fixtures for before tool execution, after external effect, after result persistence, and before outbox publish.
- [ ] Verify each fixture fails before recovery logic exists.
- [ ] Implement deterministic recovery using persisted state and idempotency records.
- [ ] Verify no duplicate business effect is produced.

### Task 6: Four framework adapters

**Files:**
- Create: `packages/adapters/agentscope/*`
- Create: `packages/adapters/langgraph/*`
- Create: `packages/adapters/eino/*`
- Create: `packages/adapters/mastra/*`
- Create: `tests/contract/adapter-contract.test.ts`

- [ ] Define one adapter interface over the runtime contract.
- [ ] Implement reference adapters and capability declarations.
- [ ] Run the same contract tests against every adapter.

### Task 7: 16-case benchmark

**Files:**
- Create: `packages/benchmark/src/cases/*`
- Create: `packages/benchmark/src/runner.ts`
- Create: `packages/benchmark/src/fixtures/*`
- Create: `tests/benchmark/*.test.ts`

- [ ] Encode every benchmark with fixture, initial DB state, Mock LLM/Tool, exact steps, SQL assertions, expected result, and failure criteria.
- [ ] Execute the same matrix across all four adapters.
- [ ] Emit machine-readable benchmark results.

### Task 8: Local Docker Compose environment

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/*`
- Create: `apps/worker/*`
- Create: `apps/web/*`
- Create: `infra/docker/*`

- [ ] Bring up PostgreSQL, Redis, API, worker, web, mock LLM/tools, and benchmark runner.
- [ ] Add health checks and deterministic seed data.
- [ ] Add a single smoke-test command.

### Task 9: Vercel deployment boundary

**Files:**
- Create: `apps/web/vercel.json`
- Create: `apps/api/vercel.json`
- Create: `docs/deployment/vercel.md`

- [ ] Keep durable worker/database operations outside request-lifetime assumptions.
- [ ] Route model calls through a provider-agnostic LLM gateway boundary.
- [ ] Document environment variables, deployment topology, and failure semantics.

### Task 10: CI and verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/benchmark.yml`
- Create: `CONTRIBUTING.md`

- [ ] Run formatting, type checking, unit tests, integration tests, and benchmark contract tests.
- [ ] Require all contract and safety tests before merge.
- [ ] Publish benchmark artifacts.
