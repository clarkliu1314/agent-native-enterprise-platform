# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 12 — Production Readiness & Operability; Stage 12.4 Failure & SLO design/approval gate.

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

The implementation establishes framework-neutral correlation, structured lifecycle telemetry, sensitive-data protection, bounded-cardinality metrics, stable operational error codes, explicit propagation, and telemetry failure isolation.

Authoritative evidence:

- Final mainline HEAD: `bdbcdd6906af2b89f39698b5468bd8ab395ea302`.
- Final verification: **Run #625 — GREEN**.

### Stage 12.2 — Operational Control Plane

**Status: CLOSED / COMPLETE.**

Authoritative specification/plan:

- `docs/superpowers/specs/2026-09-14-stage12-2-operational-control-plane.md`
- `docs/superpowers/plans/2026-09-14-stage12-2-operational-control-plane.md`

Scope completed: durable pause/resume/retry/cancel/recover controls, authorization and tenant isolation, optimistic concurrency, idempotency, existing recovery/fencing/outbox reuse, stateless API boundary, production worker composition, and audit-ready control events.

Authoritative evidence:

- PR #27 merged.
- Merge commit: `b07ccde129ecc83cf37ed48c79f5e1f4ea20d32f`.
- Mainline CI: **Run #673 — GREEN** on the exact merge SHA.
- Run #670 was the implementation verification on commit `3d9f3b8086ae4d6c0d104d187881a3d81cb1b302`.

Run #673 is the authoritative completion evidence for Stage 12.2.

### Stage 12.3 — Auditability

**Status: CLOSED / COMPLETE.**

Authoritative specification:

- `docs/superpowers/specs/2026-09-14-stage12-3-auditability.md`

Implementation plan:

- `docs/superpowers/plans/2026-09-14-stage12-3-auditability.md`

The implementation establishes immutable, tenant-scoped, actor-attributed audit facts for operational controls and material durable runtime/business transitions. Audit persistence remains inside existing PostgreSQL transaction boundaries; existing `agent_events` remain canonical; Outbox remains the publication boundary; audit queries are bounded, authorized, tenant-scoped, and deterministic; sensitive data is fail-closed; no second runtime or authoritative Redis/process-memory audit store is introduced.

Authoritative evidence:

- Feature branch: `feat/stage12-3-auditability`.
- Final feature-branch verification: **Run #762 — GREEN** on `f12a1df5b40009797082085658eb058eb4e6d7d1`.
- PR #28 merged.
- Merge commit: `69f356bc2af3d4e8481ee3b1b47f48d73d2181e8`.
- Final mainline verification: **Run #763 — GREEN** on the exact merge SHA.
- Run #763 required a Compose Smoke rerun after a transient Docker Hub registry connection reset; no application-code change was required.

Run #763 is the authoritative completion evidence for Stage 12.3.

## Stage 12.4 — Failure & SLO

**Status: DESIGN / APPROVAL GATE PENDING.**

Do not begin implementation until the Stage 12.4 design/specification and implementation plan are reviewed and explicitly approved.

Planned scope:

1. Explicit SLIs/SLOs for API handoff, durable command completion, worker/recovery latency, outbox delivery, and audit completeness.
2. Error-budget policy and alert thresholds with bounded-cardinality operational metrics.
3. Timeout, retry, backpressure, cancellation, and overload semantics consistent with the existing Run FSM and durable transaction boundaries.
4. Failure-injection coverage for PostgreSQL, Outbox, worker crash, recovery, fencing, API handoff, and dependency degradation.
5. Integration with the existing Stage 12.1 observability and Stage 12.2 operational control surfaces; no second runtime or second authoritative scheduler.
6. Production-readiness benchmark cases and exact CI acceptance gates.

### Stage 12 roadmap

- **12.4 Failure & SLO:** SLI/SLO definitions, alert thresholds, timeout/backpressure policy, and failure-injection tests.
- **12.5 Security Hardening:** secret handling, tenant isolation verification, least privilege, retention, and security regression gates.
- **12.6 Production Readiness Benchmark:** production-operability benchmark matrix covering observability, control, audit, SLO, and security invariants.
- **12.7 Final Mainline Verification:** complete Stage 12 only after all gates pass on mainline.

## Branch and merge discipline

- Each stage/task requiring code changes uses a dedicated feature branch from the verified `main` baseline.
- Documentation closeout uses a dedicated branch from the exact Stage 12.3 merge SHA: `docs/stage12-3-closeout`.
- Never continue implementation on an already-merged feature branch.
- Keep PRs Draft until branch-head CI is GREEN; merge only after required gates are GREEN.
- After every merge, verify CI against the exact merge SHA before declaring the stage closed.
- Documentation must record the authoritative branch/PR/merge SHA and mainline CI run before advancing to the next stage.
