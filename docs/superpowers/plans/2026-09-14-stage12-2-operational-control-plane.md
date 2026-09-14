# Stage 12.2 Operational Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, authorized operational control plane for pause/resume/retry/cancel/recover without introducing a second runtime or bypassing existing recovery and idempotency mechanisms.

**Architecture:** Operator API commands enter one application service. Authorization, tenant ownership, idempotency, optimistic concurrency, and Run FSM validation happen before a single PostgreSQL transaction commits the control mutation and an audit-ready outbox event. Retry/recover delegate to existing recovery infrastructure; pause/cancel use durable control intent plus existing fencing/worker boundaries.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, existing API/application/runtime/durability/tool/outbox packages, PostgreSQL integration tests.

**Spec:** `docs/superpowers/specs/2026-09-14-stage12-2-operational-control-plane.md`

## Global Constraints

- PostgreSQL remains the durable source of truth.
- Redis remains delivery/scheduling only.
- RuntimeFacade remains the single runtime boundary.
- API handlers never perform durable mutation directly and never execute long-running control work.
- Every control command is tenant-scoped, actor-attributed, permission-authorized, and idempotent.
- Existing Run FSM remains authoritative; no arbitrary durable states are introduced.
- Retry/recover reuse existing RecoveryCandidateStore, lease, fencing, backoff, and idempotency semantics.
- Control events contain safe scalar metadata only and are compatible with Stage 12.1 observability and Stage 12.3 auditability.
- TDD is mandatory: every behavior starts with a failing test.

## File Map

- Create the smallest framework-neutral control contract under the existing application/domain contract package discovered during implementation.
- Create the durable control application service beside existing run/workflow command services.
- Extend the existing PostgreSQL run persistence schema only for the minimal durable control intent/version data required by the specification.
- Extend the existing outbox event path for control events without creating a second publisher.
- Extend the existing API route/composition boundary for stateless operator commands.
- Extend worker/recovery composition only where pause/cancel/retry/recover intent must be observed or delegated.
- Add focused unit/integration tests next to each boundary and `tests/operational-control-plane.e2e.test.ts` for production-composition behavior.
- Update `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` after final mainline verification to close Stage 12.1 and mark Stage 12.2 evidence.

### Task 1: Establish the Stage 12.2 RED gate

- [ ] **Step 1: Inspect existing command, permission, run-state, persistence, and outbox contracts**
- [ ] **Step 2: Add failing tests for all 12 RED behaviors in the specification**
- [ ] **Step 3: Run focused tests and record the expected failures**
- [ ] **Step 4: Commit only the RED scaffolding**

### Task 2: Implement the framework-neutral control command contract

- [ ] **Step 1: Define `OperationalControlAction` and `OperationalControlCommand`**
- [ ] **Step 2: Define stable control error classifications including authorization, tenant, state, idempotency, and concurrency failures**
- [ ] **Step 3: Implement command validation without persistence side effects**
- [ ] **Step 4: Run contract tests and typecheck**
- [ ] **Step 5: Commit the contract**

### Task 3: Implement durable control service and transaction/outbox semantics

- [ ] **Step 1: Add failing PostgreSQL tests for pause, resume, cancel, duplicate replay, and stale-version rejection**
- [ ] **Step 2: Add the minimal durable control fields/schema migration using existing run persistence conventions**
- [ ] **Step 3: Implement authorization and tenant ownership checks before mutation**
- [ ] **Step 4: Implement one-transaction control mutation + exactly one outbox event**
- [ ] **Step 5: Implement idempotent replay returning the original durable outcome**
- [ ] **Step 6: Implement optimistic concurrency and concurrent-command serialization**
- [ ] **Step 7: Run focused integration tests**
- [ ] **Step 8: Commit the durable control service**

### Task 4: Implement pause/resume/cancel worker semantics

- [ ] **Step 1: Add failing worker tests for pause boundary and terminal cancel**
- [ ] **Step 2: Make workers observe durable pause intent before the next effectful unit**
- [ ] **Step 3: Ensure cancel invalidates/fences subsequent effectful continuation using existing concurrency semantics**
- [ ] **Step 4: Ensure resume clears pause without manufacturing a new runtime state**
- [ ] **Step 5: Run worker/recovery tests and existing durability tests**
- [ ] **Step 6: Commit worker control semantics**

### Task 5: Implement retry/recover delegation

- [ ] **Step 1: Add failing tests proving retry does not directly manufacture `RUNNING`**
- [ ] **Step 2: Delegate retry to existing retryable recovery candidate semantics**
- [ ] **Step 3: Delegate recover to existing recovery candidate claim/lease/fencing path**
- [ ] **Step 4: Prove HTTP does not execute recovery work synchronously**
- [ ] **Step 5: Run recovery and idempotency regression tests**
- [ ] **Step 6: Commit retry/recover delegation**

### Task 6: Add stateless API control endpoints

- [ ] **Step 1: Add failing API tests for authorization, tenant isolation, idempotency, and bounded-request handoff**
- [ ] **Step 2: Implement routes using the existing application command boundary**
- [ ] **Step 3: Map stable control errors to existing HTTP error conventions**
- [ ] **Step 4: Ensure no direct SQL or long-running work exists in handlers**
- [ ] **Step 5: Run API typecheck/build and focused API tests**
- [ ] **Step 6: Commit API boundary**

### Task 7: End-to-end operational control verification

- [ ] **Step 1: Implement `tests/operational-control-plane.e2e.test.ts` against the real production composition path**
- [ ] **Step 2: Prove operator command → durable mutation → outbox event → worker/recovery effect**
- [ ] **Step 3: Prove duplicate control command creates no duplicate transition/event**
- [ ] **Step 4: Prove telemetry failure does not change control outcome**
- [ ] **Step 5: Prove sensitive control metadata is not serialized**
- [ ] **Step 6: Run focused E2E tests**
- [ ] **Step 7: Commit E2E gate**

### Task 8: Full verification, documentation, and mainline merge

- [ ] **Step 1: Run the unchanged 64/64 benchmark hard gate**
- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Run typecheck, API typecheck, and API build**
- [ ] **Step 4: Review diff for second-runtime, direct-SQL, Redis-state, sensitive-data, and telemetry-coupling violations**
- [ ] **Step 5: Update Stage 12.1 and Stage 12.2 status/evidence in the main implementation plan**
- [ ] **Step 6: Create/update PR and obtain review**
- [ ] **Step 7: Merge only after all required CI gates are GREEN**
- [ ] **Step 8: Verify final merge commit with authoritative mainline CI**
- [ ] **Step 9: Record exact merge SHA and CI run in the implementation plan**
