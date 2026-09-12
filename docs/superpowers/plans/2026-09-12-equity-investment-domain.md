# Equity Investment Domain Implementation Plan

> **Current phase:** Stage 10 COMPLETE; Stage 11 application/API integration planning.

**Goal:** Build a minimal but complete equity-investment vertical slice on top of the existing durable runtime, proving durable business state, agent workflow, human approval, idempotency, recovery, auditability, and transactional outbox behavior.

**Architecture:** The investment domain owns business aggregates and commands; the durable runtime owns agent execution and recovery. Business writes flow through an application service into PostgreSQL transactions that atomically persist business state, business events, and outbox records. Agent frameworks remain adapters behind the runtime contract.

**Global constraints remain locked:** PostgreSQL is the durable system of record; Runtime Contract is framework-neutral; externally effectful tools require permission and idempotency; business state/event/outbox writes have explicit transaction boundaries; recovery re-enters Permission -> Idempotency -> Tool Execution -> Outbox; outbox transport is at-least-once and consumers are idempotent; no in-memory business-state substitute; no completion claim without verification evidence.

## Stage 10 final status

| Task | Status | Evidence |
|---|---|---|
| Task 1 — Domain model and lifecycle invariants | COMPLETE | PR #7 merged. |
| Task 2 — PostgreSQL business persistence | COMPLETE | `45b8ca9` merged. |
| Task 3 — Business event and transactional outbox boundary | COMPLETE | Merged Stage 10 application-service implementation and transaction tests. |
| Task 4 — Investment tools and policy boundary | COMPLETE | Deterministic tools, permission mapping, and application-service delegation merged. |
| Task 5 — Durable Agent workflow integration | COMPLETE | Framework-neutral workflow/runtime port and durable WAITING/resume contract merged. |
| Task 6 — End-to-end recovery and duplicate-side-effect hard gate | COMPLETE | PR #13 + PR #14 implementation merged as `4042f4a`; Run #435 passed. |
| Task 7 — Benchmark coverage and repository integration | COMPLETE | B17-B20 are in the shared benchmark harness across AgentScope/LangGraph/Eino/Mastra. |
| Task 8 — Documentation, CI, and merge gate | COMPLETE | Post-merge `main` HEAD `005d67e9ea63ecfae68b73622d820276c7c41d6e`; authoritative Run #437 passed. |

## Verification record

- PR #14 recovery implementation: `a9fc8dac33e2f5f43442c433e2e5551d706d2e49`; Run #435 passed.
- Task 6 merge commit: `4042f4ae7abf9c6abe2e7cea479bf2618919aaed`.
- Final documentation commit on `main`: `005d67e9ea63ecfae68b73622d820276c7c41d6e`.
- Authoritative post-merge CI: **Run #437 — GREEN**.
- The post-merge gate validates the repository typecheck, API typecheck/build, deployment boundary, benchmark hard gate, full test suite, PostgreSQL/Redis integration, recovery/sync-deadline E2E, and Compose smoke gates.

## Recovery contract now implemented

The investment workflow persists its next-step cursor with durable run state and checkpoint in one PostgreSQL transaction. A process restart resumes from the last committed cursor rather than a process-local counter. Approval persists `WAITING` and resumes the same durable run. Recovery remains behind the framework-neutral `InvestmentWorkflowRuntime` port; AgentScope/LangGraph/Eino/Mastra do not own business persistence or recovery state.

## Benchmark extension

B17-B20 are the Stage 10 durability cases:

- **B17:** investment-decision business idempotency.
- **B18:** durable approval replay after restart.
- **B19:** crash recovery from the durable workflow cursor.
- **B20:** duplicate outbox delivery with idempotent consumption.

They extend the existing 64-case benchmark hard gate.

## Stage 11 — Application/API integration

The next slice is not a second runtime implementation. It exposes the already-durable investment capabilities through the existing stateless application boundary.

### Stage 11 goals

1. Define an HTTP/application command boundary for creating and advancing investment opportunities.
2. Expose durable investment decision submission/replay through the same business idempotency contract.
3. Expose workflow start/status/resume without moving durable state into the API process.
4. Preserve tenant ownership, optimistic versioning, permission checks, and transaction/outbox semantics at the application boundary.
5. Add contract/integration tests that exercise the API boundary against the existing application services and runtime port.
6. Keep Vercel request execution bounded: long-running workflow work is handed to the durable worker rather than executed authoritatively inside the request.

### Stage 11 non-goals

- No new Agent Framework runtime.
- No business state in Redis or process memory.
- No direct SQL from HTTP handlers.
- No provider-specific LLM dependency in the domain/API contract.
- No weakening of existing idempotency, permission, lease/fencing, recovery, or outbox invariants.

### Stage 11 execution order

1. RED: write API contract tests for opportunity commands, decision submission, run start/status, and approval resume.
2. Implement the thinnest application adapter over existing domain services/runtime port.
3. Add PostgreSQL-backed integration coverage for idempotency, optimistic concurrency, tenant isolation, and durable WAITING.
4. Add request-lifetime / 200-vs-202 handoff assertions at the Vercel boundary.
5. Run the complete CI gate and update this plan with exact SHA/run evidence.

No Stage 11 implementation should begin by duplicating runtime or persistence logic already present in Stage 10.
