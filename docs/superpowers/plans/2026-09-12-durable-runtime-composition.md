# Durable Runtime Composition Implementation Plan

> **Status:** Final hardening and authoritative CI gate.

**Goal:** Turn the approved framework-neutral durable Runtime Contract into a PostgreSQL-backed application runtime with explicit API, Worker, Recovery, and Outbox Publisher composition roots.

**Architecture baseline:** A remains locked. PostgreSQL is the lifecycle/ownership source of truth. Redis is delivery/scheduling only. RuntimeFacade is framework-neutral and is the sole application boundary. Run states are exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`. Fencing tokens are monotonic PostgreSQL `BIGINT` values and every durable worker write checks the current token. Event + Outbox insertion is atomic. Side-effecting tools require idempotency/reconciliation/wait. API execution is bounded and may continue durably after the request deadline.

## Completed implementation

- Repository transaction primitives: atomic admission, idempotency, event sequencing, claim/lease/fencing, rollback coverage.
- RuntimeFacade lifecycle: six-state FSM, terminal irreversibility, WAITING wake-up, API idempotency replay/conflict, atomic lifecycle Event + Outbox.
- Tool execution: permission-before-effect, durable tool identity, successful replay, in-flight side-effect replay protection, stale-fence result rejection.
- Model execution: durable logical call identity, request hash, provider attempts, replay policy, successful logical-call replay.
- Checkpoints: runtime-owned envelope with adapter-owned opaque payload; persistence is fenced to the current RUNNING token.
- Recovery: SKIP LOCKED expired-lease discovery/reclaim, monotonic fencing increment, durable `{ runId, owner, fencingToken }` handoff.
- Worker/Outbox: facade-driven worker, lease heartbeat, Redis Streams consumer groups, ACK, pending reclamation, outbox claim/publish/retry.
- API/process roots: stateless Vercel-compatible boundary plus separate Worker, Recovery, and Outbox Publisher roots.
- E2E: API → PostgreSQL → Outbox → Worker, lease expiry → Recovery → new fence → Worker, and sync-deadline handoff.
- Benchmark: authoritative hard gate remains 64/64 across four adapters × 16 cases.

## Final hardening added

- `test(runtime): lock checkpoint fencing contract`
- `fix(runtime): fence checkpoint persistence writes`
- `test(runtime): lock tool permission idempotency and fencing`
- `test(runtime): cover in-flight side-effect replay boundary`
- `fix(runtime): prevent replay of in-flight side effects`
- `test(runtime): lock durable model call intent and replay policy`
- `test(runtime): lock durable model replay semantics`
- `fix(runtime): make model calls replay-safe by logical identity`
- `fix(runtime): persist and replay logical model call state`
- `test(e2e): prove sync deadline hands off to durable execution`
- `fix(e2e): enforce a bounded sync budget in deadline coverage`

## Verification gate

Current branch HEAD is `145067ac1ca5137086a174a647f9ffd5630ef96c`.

Historical Run #354 is green but executed `af44a90`; it is not authoritative for the final hardening commits. The required final gate is a fresh CI run against the exact current HEAD and must pass both jobs:

1. repository typecheck
2. API typecheck
3. API build
4. deployment-boundary tests
5. 64/64 benchmark hard gate with zero invariant violations
6. full test suite
7. PostgreSQL integration after `infra/compose/migrate.sql`
8. Redis ACK/pending-message integration
9. Compose benchmark smoke
10. Compose worker smoke
11. Compose migration smoke
12. Recovery E2E and sync-deadline E2E

The GitHub connector currently does not expose a workflow-dispatch write operation. A draft PR may therefore need a GitHub lifecycle event to cause the authoritative pull-request workflow to execute. **Do not merge the PR until the fresh current-HEAD workflow is green.**

## Final workflow

- [x] Durable implementation and crash/replay hardening.
- [x] Sync-deadline E2E.
- [x] Implementation-plan/documentation checkpoint.
- [ ] Fresh CI on exact current HEAD.
- [ ] Record authoritative Run number and all green jobs here.
- [ ] Only then mark PR #5 Ready.
- [ ] Only after the durable-runtime gate is green, begin the equity-investment domain.

## Architecture decision

No new architecture decision is requested. The previously approved **A** baseline remains authoritative.
