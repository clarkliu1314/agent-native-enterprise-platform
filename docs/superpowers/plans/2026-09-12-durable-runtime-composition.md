# Durable Runtime Composition Implementation Plan

> **Status:** Durable runtime gate closed; mainline verification passed. Equity-investment domain is the next implementation phase.

Architecture A remains locked. PostgreSQL is the lifecycle/ownership source of truth; Redis is delivery/scheduling only; RuntimeFacade is the framework-neutral application boundary; the Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

Completed: atomic Run/Event/Outbox transactions, idempotency replay/conflict, monotonic fencing and fenced writes, lease heartbeat, permission-before-effect tools, side-effect replay protection, durable Model Call logical identity/replay, opaque checkpoints with fenced persistence, SKIP LOCKED recovery, Redis Streams ACK/pending reclamation, Outbox publish/retry, facade-driven Worker, stateless API bounded sync, separate process roots, API→PostgreSQL→Outbox→Worker E2E, lease-expiry recovery E2E, and sync-deadline E2E.

Final hardening tests cover checkpoint fencing, tool permission/idempotency/lost-fence behavior, Model Call intent/replay policy, and sync deadline handoff.

Authoritative branch gate: Run #370 passed on the exact hardened branch HEAD `9ff84c6546c271a8b9dd13a9e37d42eaef695523`. It covered repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate, full tests, Compose smoke, and the durable-runtime integration/recovery coverage.

Mainline merge gate: PR #6 was merged as `02839ec3f012ba584131758597252157726b947e`. Main push Run #371 passed on that exact merge commit, with both `test` and `compose-smoke` jobs green. This closes the durable-runtime implementation gate on `main`.

- [x] Durable implementation and crash/replay hardening
- [x] Sync-deadline E2E
- [x] Documentation checkpoint
- [x] Fresh CI on exact hardened HEAD (Run #370)
- [x] Record authoritative Run number and all green jobs
- [x] PR #6 Ready and merged
- [x] Post-merge main CI green (Run #371)
- [x] Durable-runtime gate closed
- [ ] Begin equity-investment domain implementation
