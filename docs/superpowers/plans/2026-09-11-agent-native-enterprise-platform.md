# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Durable Runtime Composition final verification.

The approved architecture baseline **A** remains locked. PostgreSQL is the durable source of truth; Redis is delivery/scheduling only; RuntimeFacade is the framework-neutral application boundary; API, Worker, Recovery, and Outbox Publisher are separate composition roots; the Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

## Completed foundation

The Runtime Contract, in-memory reference runtime, PostgreSQL durability, Tool Permission/Idempotency/Outbox, crash recovery, four adapter contract surface, 64-case benchmark hard gate, Docker Compose environment, and stateless Vercel boundary are complete. Benchmark Runs #287/#288 are the authoritative benchmark-green validation.

## Durable Runtime Composition

PR #5 (`feat/durable-runtime-composition`) implements the approved durable composition design. Completed work includes atomic Run/Event/Outbox transactions, transactional idempotency replay/conflict, monotonic fencing and fenced writes, lease heartbeat, durable Tool and Model execution boundaries, opaque checkpoints, SKIP LOCKED recovery, Redis Streams ACK/pending reclamation, Outbox publishing/retry, facade-driven Worker execution, API bounded sync 200/202 semantics, separate process roots, and API→PostgreSQL→Outbox→Worker plus lease-expiry recovery E2E coverage.

Final hardening added tests and fixes for permission-before-effect, successful side-effect replay, in-flight side-effect protection, lost-fence result rejection, durable Model Call intent ordering and logical-call replay, fenced checkpoint persistence, and sync-deadline handoff.

The Compose migration was aligned with the durable repository schema before the final gate, and CI applies the migration before the repository test suite.

## Final verification gate

The branch has been advanced through the implementation and documentation checkpoints. The final authoritative CI must target the exact latest HEAD and pass both CI jobs for: repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate, full test suite, PostgreSQL integration, Redis ACK/pending integration, Recovery E2E, sync-deadline E2E, and Compose benchmark/worker/migration smoke.

Run #354 is historical and validated `af44a90`; it must not be used as the final-green claim for the hardened branch.

## Next steps

1. Obtain fresh authoritative CI on the exact latest HEAD.
2. Inspect both CI jobs and every required gate.
3. Record the authoritative Run number in the implementation plan.
4. Only after all gates are green, mark PR #5 Ready.
5. Do not begin the equity-investment domain until this durable-runtime gate is closed.
