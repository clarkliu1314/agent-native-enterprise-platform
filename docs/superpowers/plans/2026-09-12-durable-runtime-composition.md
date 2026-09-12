# Durable Runtime Composition Implementation Plan

> **Status:** Final hardening and authoritative CI gate.

Architecture A remains locked. PostgreSQL is the lifecycle/ownership source of truth; Redis is delivery/scheduling only; RuntimeFacade is the framework-neutral application boundary; the Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

Completed: atomic Run/Event/Outbox transactions, idempotency replay/conflict, monotonic fencing and fenced writes, lease heartbeat, permission-before-effect tools, side-effect replay protection, durable Model Call logical identity/replay, opaque checkpoints with fenced persistence, SKIP LOCKED recovery, Redis Streams ACK/pending reclamation, Outbox publish/retry, facade-driven Worker, stateless API bounded sync, separate process roots, API→PostgreSQL→Outbox→Worker E2E, lease-expiry recovery E2E, and sync-deadline E2E.

Final hardening tests cover checkpoint fencing, tool permission/idempotency/lost-fence behavior, Model Call intent/replay policy, and sync deadline handoff.

Current final gate: obtain a fresh authoritative CI run on the exact latest HEAD and require repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate with zero invariant violations, full tests, PostgreSQL integration, Redis integration, Recovery E2E, sync-deadline E2E, and Compose benchmark/worker/migration smoke. Historical Run #354 executed `af44a90` and is not authoritative for the hardened branch.

- [x] Durable implementation and crash/replay hardening
- [x] Sync-deadline E2E
- [x] Documentation checkpoint
- [ ] Fresh CI on exact current HEAD
- [ ] Record authoritative Run number and all green jobs
- [ ] Mark PR #5 Ready only after the fresh gate is green
- [ ] Begin equity-investment domain only after the durable-runtime gate is closed
