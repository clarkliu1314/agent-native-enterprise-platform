# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 12 — Production Readiness & Operability; Stage 12.5 Security Hardening.

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

Scope completed: failure taxonomy and retryability, explicit timeout semantics, bounded backpressure/concurrency, SLI/SLO/error-budget measurements, deterministic failure-injection and crash/recovery/fencing coverage, failure/SLO benchmark integration, and exact acceptance gates. The existing 64-case benchmark remains unchanged; the additional Failure/SLO gate covers 4 scenarios × 4 adapters = 16 cases. No second runtime, scheduler, authoritative Redis state, or parallel audit store was introduced.

Authoritative evidence:

- Implementation branch: `feat/stage12-4-failure-policy-test2`.
- Final feature-branch HEAD: `b360d5fe808466921f1bcd5754d88d3b2d9e9bcc`.
- **Run #817 — GREEN** on the exact feature-branch HEAD.
- PR #31 merged.
- Merge commit: `19e108a719ced4f6cb026879675102f3c8826e88`.
- **Run #818 — GREEN** on the exact mainline merge SHA.

Run #818 is the authoritative completion evidence for Stage 12.4.

### Stage 12 roadmap

- **12.5 Security Hardening:** secret handling, tenant-isolation verification, least privilege, retention, and security regression gates.
- **12.6 Production Readiness Benchmark:** production-operability benchmark matrix covering observability, control, audit, SLO, and security invariants.
- **12.7 Final Mainline Verification:** complete Stage 12 only after all gates pass on mainline.

## Branch and merge discipline

- Each stage/task requiring code changes uses a dedicated feature branch from the verified `main` baseline.
- Documentation closeout uses a dedicated branch from the exact stage merge SHA.
- Never continue implementation on an already-merged feature branch.
- Keep PRs Draft until branch-head CI is GREEN; merge only after required gates are GREEN.
- After every merge, verify CI against the exact merge SHA before declaring the stage closed.
- Documentation must record the authoritative branch/PR/merge SHA and mainline CI run before advancing to the next stage.
