# Durable Runtime Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved framework-neutral durable Runtime Contract into a PostgreSQL-backed application runtime with explicit API, Worker, Recovery, and Outbox Publisher composition roots.

**Architecture:** PostgreSQL is the source of truth for Run lifecycle, ownership, events, idempotency, steps, checkpoints, and waits. `RuntimeFacade` is the only application boundary; repositories and infrastructure are injected by separate process roots. Redis is delivery/scheduling only, with PostgreSQL `FOR UPDATE SKIP LOCKED` recovery fallback.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, PostgreSQL (`pg`), Redis-compatible queue client, Node.js, Vercel-compatible API handler, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-12-durable-runtime-composition-design.md`

## Global Constraints

- Agent Framework != Agent Runtime.
- Runtime Contract is framework-neutral and adapter types never cross the application boundary.
- Run states are exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- PostgreSQL is the lifecycle/ownership source of truth.
- Fencing tokens are PostgreSQL-generated monotonic `BIGINT` values and every durable worker write checks the current token.
- Side-effecting tools require external idempotency or durable reconciliation/wait.
- Event + Outbox insertion is one PostgreSQL transaction and event sequence is monotonic per Run.
- API requests are stateless; sync execution is bounded and may fall back to durable async continuation.
- Every production behavior is introduced TDD-first: RED, minimal GREEN, then focused verification.

## File Map

- Create `packages/runtime/src/errors.ts`: framework-neutral runtime error taxonomy.
- Create `packages/runtime/src/ports.ts`: PostgreSQL/queue/clock/id generators and adapter ports.
- Create `packages/runtime/src/repositories.ts`: repository interfaces used by services.
- Create `packages/runtime/src/postgres-runtime-repositories.ts`: PostgreSQL repository implementation and transaction helpers.
- Create `packages/runtime/src/runtime-service.ts`: transactional admission, lifecycle, lease/fencing, and bounded execution orchestration.
- Create `packages/runtime/src/outbox-publisher.ts`: claim/publish/retry outbox records.
- Create `packages/runtime/src/recovery-coordinator.ts`: expired lease recovery and PostgreSQL polling fallback.
- Create `packages/runtime/src/tool-execution-service.ts`: permission/idempotency/tool execution boundary.
- Create `packages/runtime/src/model-execution-service.ts`: durable Model Call intent/attempt/result boundary.
- Create `packages/runtime/src/checkpoint-service.ts`: runtime envelope persistence with opaque adapter payload.
- Create `packages/runtime/src/index.ts`: public runtime package exports.
- Create `packages/runtime/src/*.test.ts`: focused unit/contract tests for each service.
- Modify `packages/runtime-contract/src/durable.ts`: add exact framework-neutral result/error/port contracts only when tests require them.
- Modify `apps/api/src/handler.ts`: route HTTP requests exclusively through `RuntimeFacade` and preserve 202/200 bounded-sync semantics.
- Create `apps/api/src/composition.ts`: API composition root and infrastructure injection.
- Create `apps/worker/src/index.ts`: worker composition root, claim/lease/heartbeat, and runtime execution.
- Create `apps/recovery/src/index.ts`: recovery composition root.
- Create `apps/outbox-publisher/src/index.ts`: outbox publisher composition root.
- Create `apps/*/package.json` and minimal build/typecheck configuration where required by the workspace.
- Extend `docker-compose.yml` only after the real runtime process contracts exist.
- Modify this plan and the main plan at each completed implementation gate.

## Task 1: Repository and transaction primitives

- [ ] Write RED tests for atomic Run admission, idempotency replay/conflict, per-Run event sequencing, and fencing-token claim.
- [ ] Verify the tests fail because no PostgreSQL repository implementation exists.
- [ ] Implement repository ports and SQL transaction helpers with parameterized queries.
- [ ] Implement atomic `createRun`, `claimRun`, `renewLease`, and fenced durable-write primitives.
- [ ] Add integration tests using the existing Compose PostgreSQL service; assert rollback leaves no Run/Event/Outbox/Idempotency residue.
- [ ] Commit `feat(runtime): add transactional durable repositories`.

## Task 2: RuntimeFacade lifecycle services

- [ ] Write RED tests for `createRun`, `resumeRun`, `cancelRun`, `approveRun`, `getRun`, and event/checkpoint queries.
- [ ] Implement the six-state FSM with terminal-state irreversibility and WAITING wake-up semantics.
- [ ] Implement transactional Event + Outbox insertion and monotonic per-Run sequence allocation.
- [ ] Implement API idempotency replay and 409 command-hash conflict semantics.
- [ ] Verify focused runtime service tests and repository integration tests.
- [ ] Commit `feat(runtime): implement durable RuntimeFacade lifecycle`.

## Task 3: Tool and Model durable execution steps

- [ ] Write RED tests for permission-before-effect, side-effecting idempotency, lost-fence result rejection, Model Call intent/result persistence, and replay policy.
- [ ] Implement `ToolExecutionService` using two transactions around external execution; never hold a DB transaction over the external call.
- [ ] Implement `ModelExecutionService` with logical call identity, request hash, provider attempts, and reconciliation/replay policy.
- [ ] Verify crash-point tests prove no duplicate logical side effect and no stale-worker durable write.
- [ ] Commit `feat(runtime): add durable tool and model execution services`.

## Task 4: Checkpoints and recovery

- [ ] Write RED tests for opaque checkpoint envelope persistence, expired-lease reclaim, new fencing token, REPLAYABLE retry, NON_REPLAYABLE durable wait, and deterministic recovery outcome.
- [ ] Implement checkpoint service and recovery coordinator using `FOR UPDATE SKIP LOCKED`.
- [ ] Ensure recovery does not mutate Run state through an unapproved transition and never reuses an old fencing token.
- [ ] Verify crash/recovery tests and repository invariants.
- [ ] Commit `feat(runtime): implement checkpoint and recovery coordination`.

## Task 5: Outbox publisher and Worker

- [ ] Write RED tests for outbox claim, publish success, retry/backoff, duplicate delivery, and worker lease/heartbeat behavior.
- [ ] Implement publisher with transactional claim, delivery, retry scheduling, and published marking.
- [ ] Implement Worker composition root using `RuntimeFacade`, queue delivery, claim/lease, heartbeat, and fencing-aware execution.
- [ ] Verify worker restart and duplicate-delivery tests.
- [ ] Commit `feat(runtime): add worker and outbox composition roots`.

## Task 6: Vercel-compatible API composition

- [ ] Write RED API tests for POST `/runs` async 202, sync terminal 200, sync deadline 202, idempotent replay, conflict 409, and GET durable state.
- [ ] Implement `apps/api/src/composition.ts` so the handler receives injected `RuntimeFacade` and does not instantiate repositories/adapters inside request logic.
- [ ] Update `apps/api/src/handler.ts` to use only the facade and preserve deployment-boundary guarantees.
- [ ] Verify API typecheck/build and focused handler/deployment tests.
- [ ] Commit `feat(api): wire stateless request boundary to durable runtime`.

## Task 7: Recovery and Outbox process roots

- [ ] Write RED process-contract tests proving API, Worker, Recovery, and Outbox Publisher use separate composition roots while sharing the same Runtime implementation.
- [ ] Implement minimal Node entrypoints and environment validation for Worker, Recovery, and Publisher.
- [ ] Add Compose services only for the real durable processes; keep the Vercel API stateless.
- [ ] Verify Compose health, startup ordering, worker consumption, recovery fallback, and publisher retry.
- [ ] Commit `feat(runtime): add durable process composition roots`.

## Task 8: End-to-end verification and documentation

- [ ] Add E2E tests covering API → PostgreSQL Run/Event/Outbox → Publisher → Worker → terminal Run.
- [ ] Add recovery E2E covering worker crash/lease expiry → recovery reclaim → new fencing token → continuation.
- [ ] Add sync deadline E2E proving the request boundary does not become the durable execution boundary.
- [ ] Update the main implementation plan and design docs with completed tasks, commits, and CI run numbers.
- [ ] Run repository typecheck, full tests, API build, benchmark hard gate, and Compose smoke.
- [ ] Commit `docs(runtime): close durable composition implementation gate`.
