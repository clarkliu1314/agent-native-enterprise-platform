# Equity Investment Domain Implementation Plan

> **Current phase:** Stage 10 integration verification / merge gate.

**Goal:** Build a minimal but complete equity-investment vertical slice on top of the existing durable runtime, proving durable business state, agent workflow, human approval, idempotency, recovery, auditability, and transactional outbox behavior.

**Architecture:** The investment domain owns business aggregates and commands; the durable runtime owns agent execution and recovery. Business writes flow through an application service into PostgreSQL transactions that atomically persist business state, business events, and outbox records. Agent frameworks remain adapters behind the runtime contract.

**Global constraints remain locked:** PostgreSQL is the durable system of record; Runtime Contract is framework-neutral; externally effectful tools require permission and idempotency; business state/event/outbox writes have explicit transaction boundaries; recovery re-enters Permission -> Idempotency -> Tool Execution -> Outbox; outbox transport is at-least-once and consumers are idempotent; no in-memory business-state substitute; no completion claim without verification evidence.

## Stage 10 status

| Task | Status | Evidence |
|---|---|---|
| Task 1 — Domain model and lifecycle invariants | COMPLETE | PR #7 merged; pure lifecycle/decision invariants are on `main`. |
| Task 2 — PostgreSQL business persistence | COMPLETE | `45b8ca9` merged; durable opportunity/decision repositories and schema are on `main`. |
| Task 3 — Business event and transactional outbox boundary | COMPLETE | Application-service implementation and transactional boundary are included in the merged Stage 10 line. |
| Task 4 — Investment tools and policy boundary | COMPLETE | PR #11 implementation is included in the merged Stage 10 line; deterministic tools and permission/idempotency delegation are covered. |
| Task 5 — Durable Agent workflow integration | COMPLETE | PR #12 contract is included in the merged Stage 10 line; framework-neutral workflow/runtime port and durable WAITING/resume contract are present. |
| Task 6 — End-to-end recovery and duplicate-side-effect hard gate | IMPLEMENTED | PR #13 recovery hard gate + PR #14 durable cursor/checkpoint implementation merged as `4042f4a`; branch-head Run #435 passed. |
| Task 7 — Benchmark coverage and repository integration | IMPLEMENTED | B17-B20 are defined in the existing benchmark harness for decision idempotency, approval replay, crash recovery, and duplicate outbox delivery. |
| Task 8 — Documentation, CI, and merge gate | IN PROGRESS | Post-merge authoritative CI and final documentation evidence are still required. |

## Task 6 recovery contract now implemented

The investment workflow persists its next-step cursor with the durable run state and checkpoint in one PostgreSQL transaction. A process restart therefore resumes from the last committed cursor rather than a process-local counter. The workflow persists `WAITING` for approval and resumes the same durable run after approval. The public recovery gate covers crash/restart, durable WAITING, SQL invariants, and duplicate-side-effect expectations.

The implementation deliberately remains behind the framework-neutral `InvestmentWorkflowRuntime` port; AgentScope/LangGraph/Eino/Mastra adapters do not own business persistence or recovery state.

## Benchmark extension

B17-B20 are the Stage 10 hard-gate cases:

- **B17:** investment-decision business idempotency.
- **B18:** durable approval replay after restart.
- **B19:** crash recovery from the durable workflow cursor.
- **B20:** duplicate outbox delivery with idempotent consumption.

These cases extend, rather than replace, the existing 64-case benchmark hard gate.

## Current merge/verification gate

1. Task 6 implementation was validated on exact PR #14 HEAD `a9fc8dac33e2f5f43442c433e2e5551d706d2e49` by Run #435; both CI jobs passed.
2. PR #13 recovery contract was merged into the Task 6 implementation line, and PR #14 was then retargeted to `main` and merged as `4042f4ae7abf9c6abe2e7cea479bf2618919aaed`.
3. The next authoritative verification must run against the post-merge `main` HEAD, not the pre-merge Run #435 SHA.
4. Only after that post-merge gate is green should Task 8 be marked COMPLETE and the next domain slice begin.

## Next task after the merge gate

Once the post-merge gate is green, proceed to the next business-domain slice only after recording the exact CI run, commit SHA, benchmark result, and updated plan state. No second recovery implementation should be introduced inside the investment domain.
