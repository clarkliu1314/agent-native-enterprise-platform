# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 12 — Production Readiness & Operability; Stage 12.7 Final Mainline Verification — CLOSED.

The approved architecture baseline **A** remains locked. PostgreSQL is the durable source of truth; Redis is delivery/scheduling only; RuntimeFacade is the framework-neutral application boundary; API, Worker, Recovery, and Outbox Publisher are separate composition roots; the Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

## Completed platform foundation

The Runtime Contract, PostgreSQL durability, Tool Permission/Idempotency/Outbox, crash recovery, four adapter contract surface, 64-case benchmark hard gate, Docker Compose environment, stateless Vercel boundary, and equity-investment vertical slice are complete. Durable runtime hardening is part of the authoritative mainline baseline.

## Stage 10 — Equity Investment Domain

The equity-investment vertical slice covers durable opportunity/decision state, lifecycle invariants, transactional business events and outbox, deterministic research/analysis tools, explicit permission mapping, business idempotency, framework-neutral workflow execution, durable WAITING/resume, crash recovery, duplicate-side-effect protection, and B17-B20 durability benchmark definitions across AgentScope/LangGraph/Eino/Mastra.

Authoritative verification:

- Task 6 branch-head Run #435: GREEN.
- Post-merge `main` HEAD: `005d67e9ea63ecfae68b73622d820276c7c41d6e`.
- Post-merge authoritative CI: **Run #437 — GREEN**.

## Stage 11 — Application/API Integration and Hardening

Stage 11 exposes durable investment capabilities through the existing stateless application boundary, preserving tenant ownership, optimistic concurrency, permission, transaction/outbox, idempotency, and request-lifetime boundaries.

### H3 — Crash consistency

The investment worker persists workflow cursor metadata and checkpoint state through one PostgreSQL transaction; checkpoint failure rolls back the cursor update and fencing rejects stale workers.

Authoritative evidence: PR #23 merged; **Run #507 — GREEN**.

### B14-B16 — Recovery and production idempotency

Retryable recovery uses durable attempts and bounded backoff; terminal failures transition to `FAILED_FINAL`; recovery claims use PostgreSQL row locking/lease/fencing; concurrent effectful tool calls use durable idempotency.

Authoritative evidence:

- B14-B16 implementation merged through PR #24.
- PR #25 production idempotency audit merged after Run #515 — GREEN.
- Post-merge authoritative mainline CI: **Run #516 — GREEN**.

## Stage 12 — Production Readiness & Operability

Stage 12 advances the verified durable platform toward production operability without introducing a second durable execution model.

### Stage 12.1 — Observability Contract

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-13-stage12-1-observability-contract.md`
- `docs/superpowers/plans/2026-09-13-stage12-1-observability-contract.md`

Authoritative evidence: final mainline HEAD `bdbcdd6906af2b89f39698b5468bd8ab395ea302`; **Run #625 — GREEN**.

### Stage 12.2 — Operational Control Plane

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-14-stage12-2-operational-control-plane.md`
- `docs/superpowers/plans/2026-09-14-stage12-2-operational-control-plane.md`

Authoritative evidence: PR #27 merged; merge commit `b07ccde129ecc83cf37ed48c79f5e1f4ea20d32f`; **Run #673 — GREEN** on the exact merge SHA.

### Stage 12.3 — Auditability

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-14-stage12-3-auditability.md`
- `docs/superpowers/plans/2026-09-14-stage12-3-auditability.md`
- `docs/superpowers/plans/2026-09-15-stage12-3-closeout.md`

Authoritative evidence: PR #28 merged; merge commit `69f356bc2af3d4e8481ee3b1b47f48d73d2181e8`; **Run #763 — GREEN** on the exact merge SHA.

### Stage 12.4 — Failure & SLO

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-15-stage12-4-failure-slo.md`
- `docs/superpowers/plans/2026-09-15-stage12-4-failure-slo.md`
- `docs/superpowers/plans/2026-09-15-stage12-4-closeout.md`

Authoritative evidence: PR #31 merged; merge commit `19e108a719ced4f6cb026879675102f3c8826e88`; **Run #818 — GREEN** on the exact merge SHA.

### Stage 12.5 — Security Hardening

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-15-stage12-5-security-hardening.md`
- `docs/superpowers/plans/2026-09-15-stage12-5-security-hardening.md`
- `docs/superpowers/plans/2026-09-15-stage12-5-closeout.md`

Scope completed: immutable fail-closed security context, durable tenant isolation, least-privilege component authorization and Tool Permission verification, secret-safe error/audit/telemetry/durable-data boundaries, authorized tenant-scoped retention/purge, and deterministic Security Regression S01–S16 CI hard gate. The existing 64-case adapter benchmark remains unchanged in semantics.

Authoritative evidence:

- Implementation branch: `feat/stage12-5-security-hardening-task6`.
- Final implementation HEAD: `6b321a16ec8e7a839067ba3d24aa940fb137a018`.
- PR #38 merged.
- Merge commit: `3442f2bfb63071f534939e58651ebd238b11bab2`.
- **Run #840 — GREEN** on the exact implementation HEAD.
- **Run #841 — GREEN** on the exact mainline merge SHA.

Run #841 is the authoritative implementation completion evidence for Stage 12.5.

### Stage 12.6 — Production Readiness Benchmark

**Status: CLOSED / COMPLETE.**

Authoritative closeout plan:

- `docs/superpowers/plans/2026-09-16-stage12-6-closeout.md`
- `docs/superpowers/plans/2026-09-16-stage12-6-task5-closeout.md`

Scope completed: executable production-readiness benchmark coverage P01-P15 spanning benchmark harness, resilience, security/observability, failure/SLO, retention/purge, sensitive-data boundaries, and concurrency/duplicate-request behavior.

Authoritative evidence:

- PR #45 merged at `435dc56c5462c85b6478a33494a349a91d1facbc`; **Run #886 — GREEN** for branch validation and **Run #887 — GREEN** on the exact implementation merge SHA.
- PR #47 merged the Task 5 documentation closeout at `fd702405cad2614c50ff569d7c3c3c7ffdc5f34b`.
- **Run #889 — GREEN** on the exact Stage 12.6 closeout merge SHA.

Run #889 is the authoritative mainline completion evidence for Stage 12.6.

### Stage 12.7 — Final Mainline Verification

**Status: CLOSED / COMPLETE.**

Scope: final verification of the complete Stage 12 baseline on `main`, including the full test/typecheck/build/deployment-boundary path, the 64-case benchmark hard gate, failure/SLO gate, security regression gate, and Docker Compose smoke verification.

Authoritative evidence:

- PR #48 fixed the stale Compose benchmark-command contract assertion; fixed branch-head **Run #892 — GREEN**.
- PR #48 merged to `main` at merge commit `3022fffabdeb503d2ae044521422e582d84213cc`.
- Exact merge-SHA verification **Run #893 — GREEN**.
- Final push-triggered `main` verification **Run #894 — GREEN** on commit `87a593f77a33da4b409f0cb92c1afcf26d624779`, whose tree is identical to the Stage 12.7 implementation merge tree.

Run #893 is the authoritative exact-merge verification for the Stage 12.7 implementation; Run #894 is the final push-triggered mainline verification.

### Stage 12 roadmap

- **12.5 Security Hardening:** CLOSED / COMPLETE.
- **12.6 Production Readiness Benchmark:** CLOSED / COMPLETE.
- **12.7 Final Mainline Verification:** CLOSED / COMPLETE.

Stage 12 is fully closed.

## Branch and merge discipline

- Each stage/task requiring code changes uses a dedicated feature branch from the verified `main` baseline.
- Documentation closeout uses a dedicated branch from the exact stage merge SHA.
- Never continue implementation on an already-merged feature branch.
- Keep PRs Draft until branch-head CI is GREEN; merge only after required gates are GREEN.
- After every merge, verify CI against the exact merge SHA before declaring the stage closed.
- Documentation must record the authoritative branch/PR/merge SHA and mainline CI run before advancing to the next stage.
