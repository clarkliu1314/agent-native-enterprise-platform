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
- Redis Streams provide delivery/scheduling only; correctness remains in PostgreSQL fencing, lifecycle, and outbox state.
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
- Create `packages/runtime/src/durable-worker.ts`: RuntimeFacade-driven queue consumption and bounded execution slice.
- Create `packages/runtime/src/lease-heartbeat.ts`: fenced lease renewal while a bounded execution slice is active.
- Create `packages/runtime/src/index.ts`: public runtime package exports.
- Create `packages/runtime/src/*.test.ts`: focused unit/contract tests for each service.
- Modify `packages/runtime-contract/src/durable.ts`: add exact framework-neutral result/error/port contracts only when tests require them.
- Modify `apps/api/src/handler.ts`: route HTTP requests exclusively through `RuntimeFacade` and preserve 202/200 bounded-sync semantics.
- Create `apps/api/src/composition.ts`: API composition root and infrastructure injection.
- Create `apps/worker/src/index.ts`: worker composition root, claim/lease/heartbeat, and runtime execution.
- Create `apps/recovery/src/index.ts`: recovery composition root.
- Create `apps/outbox-publisher/src/index.ts`: outbox publisher composition root.
- Create `packages/queue`: Redis Streams implementation of the framework-neutral `QueuePublisher`/`QueueConsumer` ports.
- Create `packages/queue/src/index.test.ts`: Redis command-boundary tests with an injectable fake client.
- Create `apps/*/package.json` and minimal build/typecheck configuration where required by the workspace.
- Extend `docker-compose.yml` only after the real runtime process contracts exist.
- Modify this plan and the main plan at each completed implementation gate.

## Progress Notes

- Run #343 is verified green: repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate, full 173-test suite, and Compose smoke all passed.
- Run #354 is verified green across both CI jobs; its test job passed repository typecheck, API typecheck/build, deployment boundary, benchmark hard gate, and full test suite, while Compose smoke passed benchmark, worker, and migration assertions. Its executed HEAD was `af44a90`, so it does not validate later commits.
- Lifecycle transition + Event + Outbox is now represented by one repository transaction through `transitionRunAndEmit`; RuntimeFacade lifecycle commands use that atomic primitive.
- Added a regression test proving lifecycle state is rolled back when Event/Outbox persistence fails.
- Bounded execution deadline handling now treats `TimeoutError`/`AbortError` as a durable continuation boundary and returns the current Run instead of converting request expiry into an API 500.
- Added a facade-driven `DurableWorker` queue contract and tests.
- Added a reusable fenced lease-heartbeat primitive; bounded runtime execution now renews the PostgreSQL lease with the claimed fencing token and aborts execution if the ownership check is lost.
- Added Worker, Recovery, and Outbox Publisher composition-root packages that construct PostgreSQL-backed runtime infrastructure outside the Vercel request boundary.
- Added a regression API test locking sync-deadline -> 202 behavior.
- Recovery now serializes reclaimed ownership as `{ runId, owner, fencingToken }` on the internal `agent.run` queue contract; Worker can execute an already-reclaimed RUNNING row through an internal fenced execution boundary without violating the six-state FSM.
- Added focused recovery/worker tests for reclaimed fencing handoff and ordinary queue execution.
- Added `@agent-native/queue` with Redis Streams publisher/consumer implementations using consumer groups, acknowledgements, and pending-entry reclamation; Worker, Recovery, and Outbox composition roots now expose Redis-backed constructors.
- Added an injectable Redis command-client boundary and publisher tests covering lazy connection, JSON serialization, topic stream naming, and idempotent close.
- Added `workflow_dispatch` to CI so the workflow has an explicit manual trigger contract.
- The GitHub connector currently exposes no workflow-dispatch action.
- **Integration gate:** aligned `infra/compose/migrate.sql` with the durable repository schema and retained legacy benchmark columns; added PostgreSQL repository integration coverage; CI now applies the migration before the repository test suite.
- **Correctness follow-up:** the idempotency → Run FK is deferred so atomic admission can insert the idempotency record before the Run; Outbox payloads now carry `{ eventId, runId, sequence, type, payload }` so Worker delivery has durable Run identity.
- **E2E coverage:** added `tests/durable-runtime.e2e.test.ts` for API → PostgreSQL Run/Event/Outbox → OutboxPublisher → Worker → terminal Run.
- **Recovery E2E:** added `tests/durable-recovery.e2e.test.ts` for expired lease → recovery reclaim → fencing token increment → recovered queue message → Worker continuation.
- **Redis integration:** added `RedisStreamConsumer.consumeOnce()` and configurable pending-idle threshold, plus `packages/queue/src/redis.integration.test.ts` covering ACK and pending-message reclamation. CI now provisions Redis alongside PostgreSQL.
- Fresh CI verification is still the authority; the connector currently exposes no workflow-dispatch write operation and current commit statuses have not attached a new run to the latest connector-created commits.

## Task 1: Repository and transaction primitives

- [x] Write RED tests for atomic Run admission, idempotency replay/conflict, per-Run event sequencing, and fencing-token claim.
- [x] Verify the tests fail because no PostgreSQL repository implementation exists.
- [x] Implement repository ports and SQL transaction helpers with parameterized queries.
- [x] Implement atomic `createRun`, `claimRun`, `renewLease`, and fenced durable-write primitives.
- [x] Add integration tests using the existing Compose PostgreSQL service; assert rollback leaves no Run/Event/Outbox/Idempotency residue.
- [ ] Verify the integration gate in CI and add the authoritative Run number.
- [ ] Commit `feat(runtime): add transactional durable repositories`.

## Task 2: RuntimeFacade lifecycle services

- [x] Write RED tests for `createRun`, `resumeRun`, `cancelRun`, `approveRun`, `getRun`, and event/checkpoint queries.
- [x] Implement the six-state FSM with terminal-state irreversibility and WAITING wake-up semantics.
- [x] Implement transactional Event + Outbox insertion and monotonic per-Run sequence allocation.
- [x] Implement API idempotency replay and 409 command-hash conflict semantics.
- [ ] Verify focused runtime service tests and repository integration tests.
- [ ] Commit `feat(runtime): implement durable RuntimeFacade lifecycle`.

## Task 3: Tool and Model durable execution steps

- [ ] Write RED tests for permission-before-effect, side-effecting idempotency, lost-fence result rejection, Model Call intent/result persistence, and replay policy.
- [x] Implement `ToolExecutionService` using two transactions around external execution; never hold a DB transaction over the external call.
- [x] Implement `ModelExecutionService` with logical call identity, request hash, provider attempts, and reconciliation/replay policy.
- [ ] Verify crash-point tests prove no duplicate logical side effect and no stale-worker durable write.
- [ ] Commit `feat(runtime): add durable tool and model execution services`.

## Task 4: Checkpoints and recovery

- [ ] Write RED tests for opaque checkpoint envelope persistence, expired-lease reclaim, new fencing token, REPLAYABLE retry, NON_REPLAYABLE durable wait, and deterministic recovery outcome.
- [x] Implement checkpoint service and recovery coordinator using `FOR UPDATE SKIP LOCKED`.
- [x] Ensure recovery does not mutate Run state through an unapproved transition and never reuses an old fencing token.
- [x] Add recovery E2E for expired-lease reclaim and new fencing token continuation.
- [ ] Verify crash/recovery tests and repository invariants in CI.
- [ ] Commit `feat(runtime): implement checkpoint and recovery coordination`.

## Task 5: Outbox publisher and Worker

- [ ] Write RED tests for outbox claim, publish success, retry/backoff, duplicate delivery, and worker lease/heartbeat behavior.
- [x] Implement publisher with transactional claim, delivery, retry scheduling, and published marking.
- [x] Implement Worker composition root using `RuntimeFacade`, queue delivery, bounded execution, and fenced lease heartbeat.
- [x] Add Redis Streams publisher/consumer composition wiring for durable queue delivery.
- [x] Add Redis publisher command-boundary tests with dependency injection.
- [x] Add Redis Streams ACK/pending-message integration coverage with `consumeOnce()`.
- [ ] Verify Redis-backed duplicate delivery and pending-message recovery in CI.
- [ ] Verify worker restart and duplicate-delivery tests in CI.
- [ ] Commit `feat(runtime): add worker and outbox composition roots`.

## Task 6: Vercel-compatible API composition

- [x] Write RED API tests for POST `/runs` async 202, sync terminal 200, sync deadline 202, idempotent replay, conflict 409, and GET durable state.
- [x] Implement `apps/api/src/composition.ts` so the handler receives injected `RuntimeFacade` and does not instantiate repositories/adapters inside request logic.
- [x] Update `apps/api/src/handler.ts` to expose the durable handler without moving durable execution into the request boundary.
- [ ] Verify API typecheck/build and focused handler/deployment tests on the new composition changes in fresh CI.
- [ ] Commit `feat(api): wire stateless request boundary to durable runtime`.

## Task 7: Recovery and Outbox process roots

- [x] Write RED process-contract tests proving API, Worker, Recovery, and Outbox Publisher use separate composition roots while sharing the same Runtime implementation.
- [x] Implement minimal composition roots for Worker, Recovery, and Publisher with explicit dependency injection.
- [x] Wire Redis-backed constructors into Worker, Recovery, and Outbox Publisher roots.
- [x] Keep the Vercel API stateless and outside Docker Compose; real durable process roots use PostgreSQL/Redis.
- [ ] Verify Compose health, startup ordering, worker consumption, recovery fallback, and publisher retry in fresh CI.
- [ ] Commit `feat(runtime): add durable process composition roots`.

## Task 8: End-to-end verification and documentation

- [x] Add E2E tests covering API → PostgreSQL Run/Event/Outbox → Publisher → Worker → terminal Run.
- [x] Add recovery E2E covering worker crash/lease expiry → recovery reclaim → new fencing token → continuation.
- [ ] Add sync deadline E2E proving the request boundary does not become the durable execution boundary.
- [x] Add Redis Streams integration coverage for consumer-group ACK and pending-message reclamation.
- [ ] Update the main implementation plan and design docs with completed tasks, commits, and CI run numbers.
- [ ] Run repository typecheck, full tests, API build, benchmark hard gate, and Compose smoke on the same current head.
- [ ] Commit `docs(runtime): close durable composition implementation gate`.
