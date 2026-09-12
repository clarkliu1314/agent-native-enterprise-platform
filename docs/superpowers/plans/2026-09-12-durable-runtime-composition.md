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

- checkpoint fencing regression coverage
- permission-before-effect and side-effect replay regression coverage
- lost-fence result rejection coverage
- durable Model Call intent ordering and logical-call replay coverage
- sync-deadline E2E coverage

## Verification gate

The final authoritative CI must target the exact latest HEAD and pass both CI jobs for repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate, full test suite, PostgreSQL integration, Redis ACK/pending integration, Recovery E2E, sync-deadline E2E, and Compose benchmark/worker/migration smoke.

Run #354 is historical and executed `af44a90`; it is not authoritative for the final hardened branch.

The GitHub connector currently does not expose a workflow-dispatch write operation. The PR lifecycle may therefore be required to cause the pull-request workflow to execute. **Do not merge until the fresh current-HEAD workflow is green.**

## Final workflow

- [x] Durable implementation and crash/replay hardening.
- [x] Sync-deadline E2E.
- [x] Documentation checkpoint.
- [ ] Fresh CI on exact current HEAD.
- [ ] Record authoritative Run number and all green jobs.
- [ ] Only then mark PR #5 Ready.
- [ ] Only after the durable-runtime gate is green, begin the equity-investment domain.

## Architecture decision

No new architecture decision is requested. The previously approved **A** baseline remains authoritative.
