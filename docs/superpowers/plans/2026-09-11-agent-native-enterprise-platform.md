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

[Earlier completed Tasks 1-10 remain closed as recorded below.]

### Task 7: 16-case benchmark
**Status:** Complete. All 16 benchmark definitions, the 64-case adapter matrix, framework-neutral execution, real executable scenarios through B16, deterministic machine-readable artifact generation, and CI hard safety gates are implemented. Authoritative post-fix CI runs #287 and #288 passed on the merged benchmark head.

### Task 8: Local Docker Compose environment
**Status:** Complete for the current application boundary — PostgreSQL, Redis, deterministic migration/seed, worker smoke service, benchmark smoke service, Compose health/dependency gates, and CI Compose validation are implemented.

### Task 9: Vercel deployment boundary
**Status:** Complete for the boundary contract. Durable composition wiring is now being implemented separately under the approved design.

### Task 10: CI and verification
**Status:** Complete for the benchmark/application boundary. Run #294 passed after the Vitest matcher fix from `b57741b7d6bb0f124526587fdfc1eae9413f4c06`.

## Durable Runtime Composition Implementation Gate

**Status: Implementation in progress.** The approved design has been converted into the detailed TDD-first plan `docs/superpowers/plans/2026-09-12-durable-runtime-composition.md`, and execution has started on `feat/durable-runtime-composition` / PR #5. The first implementation slice establishes PostgreSQL transaction primitives, durable repository contracts, RuntimeFacade lifecycle orchestration, opaque checkpoints, model/tool durable-step boundaries, recovery/outbox services, and the stateless durable API handler/composition root.

### Current implementation checkpoints

- Plan gate completed in commit `aeeebb69aecebee3636ca6e3945ebf0d49ba6309`.
- Runtime contract foundation commits: `3024f641` and `fedead781`.
- Run #294 passed after the Vitest Set matcher correction `b57741b7d6bb0f124526587fdfc1eae9413f4c06`.
- Current PR: #5, head is updated continuously as TDD slices land.
- Current CI verification is intentionally required before marking Task 1/2 implementation complete; compose smoke has remained green on the latest observed pre-fix run while typecheck caught and is being corrected before broader verification.

**Next execution order:** Task 1 repository/transaction primitives → Task 2 RuntimeFacade lifecycle → Task 3 Tool/Model durable steps → Task 4 Checkpoint/Recovery → Task 5 Worker/Outbox roots → Task 6 API composition → Task 7 Recovery/Publisher process roots → Task 8 E2E/documentation.
