# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 12 — Production Readiness & Operability; Stage 12.2 Operational Control Plane implementation and final verification.

The approved architecture baseline **A** remains locked. PostgreSQL is the durable source of truth; Redis is delivery/scheduling only; RuntimeFacade is the framework-neutral application boundary; API, Worker, Recovery, and Outbox Publisher are separate composition roots; the Run FSM is exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

## Completed platform foundation

The Runtime Contract, PostgreSQL durability, Tool Permission/Idempotency/Outbox, crash recovery, four adapter contract surface, 64-case benchmark hard gate, Docker Compose environment, and stateless Vercel boundary are complete. The durable runtime composition was hardened and verified before the equity-investment vertical slice began.

## Stage 10 — Equity Investment Domain

The equity-investment vertical slice is complete. It covers durable opportunity/decision state, lifecycle invariants, transactional business events and outbox, deterministic research/analysis tools, explicit permission mapping, business idempotency, framework-neutral workflow execution, durable WAITING/resume, crash recovery, duplicate-side-effect protection, and B17-B20 durability benchmark definitions across AgentScope/LangGraph/Eino/Mastra.

Authoritative verification:

- Task 6 branch-head Run #435: GREEN.
- Post-merge `main` HEAD: `005d67e9ea63ecfae68b73622d820276c7c41d6e`.
- Post-merge authoritative CI: **Run #437 — GREEN**.

Run #437 is the completion evidence for Stage 10 and supersedes earlier pre-merge CI as the final mainline verification record.

## Stage 11 — Application/API Integration

Stage 11 exposes the durable investment capabilities through the existing stateless application boundary. It reuses existing domain services and the framework-neutral runtime port without introducing another runtime or persistence implementation.

### Scope

1. HTTP/application command contracts for investment opportunity creation and lifecycle advancement.
2. Durable investment decision submission/replay using the existing business idempotency semantics.
3. Workflow start/status/resume endpoints over the existing runtime boundary.
4. Tenant ownership, optimistic concurrency, permission, and transaction/outbox invariants at the API boundary.
5. PostgreSQL-backed integration tests plus Vercel request-lifetime/200-vs-202 handoff tests.
6. Explicit protection against authoritative long-running work inside the request process.

### Engineering gates

- TDD: establish RED contract tests before implementation.
- No direct SQL in HTTP handlers.
- No durable business state in Redis or process memory.
- No framework-specific runtime dependency in API/domain contracts.
- Every externally effectful command remains permission-authorized and idempotent.
- Every completion claim requires exact CI evidence.

## Stage 11 Hardening — Final Verification

The durability hardening wave is complete and is now part of the authoritative mainline baseline.

### H3 — Crash consistency

The investment worker persists workflow cursor metadata and checkpoint state through one PostgreSQL transaction. A failure during checkpoint persistence rolls back the cursor update as well, so recovery resumes from the last committed progress. Fencing tokens continue to reject stale workers.

Authoritative evidence:

- H3 implementation merged through PR #23.
- Post-merge verification: **Run #507 — GREEN**.

### B14 — Retryable recovery

Retryable recovery failures increment durable attempts, clear the recovery lease, and schedule the next attempt using bounded exponential backoff. A subsequent worker can reclaim the candidate only after the retry time is reached.

### B15 — Terminal recovery failure

Non-retryable failures transition the run to `FAILED_FINAL` and do not leave a future retry candidate.

### B16 — Recovery claim exclusivity + production idempotency

B16 now validates two independent protections:

1. `RecoveryCandidateStore` provides exclusive recovery claiming through PostgreSQL row locking and lease/fencing semantics.
2. `ToolExecutionService` + `PostgresToolExecutionStore` independently enforce idempotency for concurrent same-key effectful tool calls, with exactly one durable idempotency row and one outbox event.

Authoritative evidence:

- B14-B16 implementation merged through PR #24.
- PR #25 production idempotency audit merged after Run #515 — GREEN.
- Post-merge authoritative mainline CI: **Run #516 — GREEN**.

## Stage 12 — Production Readiness & Operability

Stage 12 moves the verified durable platform from engineering correctness toward production operability. The work remains layered over the existing runtime and persistence architecture and does not introduce a second durable execution model.

### Stage 12.1 — Observability Contract

**Status: CLOSED / COMPLETE.**

Authoritative implementation/specification:

- `docs/superpowers/specs/2026-09-13-stage12-1-observability-contract.md`
- `docs/superpowers/plans/2026-09-13-stage12-1-observability-contract.md`

The implementation establishes framework-neutral correlation, structured lifecycle telemetry, sensitive-data protection, bounded-cardinality metrics, stable operational error codes, explicit propagation, and telemetry failure isolation.

Authoritative evidence:

- Final Stage 12.1 mainline HEAD: `bdbcdd6906af2b89f39698b5468bd8ab395ea302`.
- Final verification: **Run #625 — GREEN**.

Run #625 is the authoritative completion evidence for Stage 12.1.

### Stage 12.2 — Operational Control Plane

**Status: IMPLEMENTATION COMPLETE — FINAL MAINLINE VERIFICATION PENDING.**

Goal: provide safe, tenant-scoped, actor-attributed pause/resume/retry/cancel/recover operations while reusing the existing runtime, recovery, fencing, idempotency, and outbox architecture.

Authoritative design specification:

- `docs/superpowers/specs/2026-09-14-stage12-2-operational-control-plane.md`

Implementation plan:

- `docs/superpowers/plans/2026-09-14-stage12-2-operational-control-plane.md`

Execution branch / PR:

- Branch: `feat/stage12-2-operational-control-plane`
- PR #27 (draft)
- RED gate established before implementation.

Completed implementation tasks:

1. Framework-neutral operational control command contract.
2. Durable control service with authorization, tenant isolation, optimistic concurrency, idempotency, and transaction/outbox semantics.
3. Pause/resume/cancel worker semantics using durable control intent and existing fencing boundaries.
4. Retry/recover delegation to existing recovery semantics without manufacturing `RUNNING`.
5. Stateless API control endpoints and bounded-request handoff.
6. Production-composition E2E verification across API → PostgreSQL → worker/recovery → outbox.
7. Production worker composition corrected to use PostgreSQL-backed operational control by default; absent legacy control state is treated as no operator intent rather than blocking execution.

Task 7 authoritative verification:

- **Run #670 — GREEN** on commit `3d9f3b8086ae4d6c0d104d187881a3d81cb1b302`.
- Verified Typecheck, API Typecheck, API Build, Deployment Boundary, 64/64 Benchmark, full tests, and Compose Smoke.
- The production composition uses PostgreSQL for operational control in both API and Worker composition roots.

Task 8 finalization checklist:

- [x] Review architecture for second-runtime, direct-SQL, Redis-state, sensitive-data, and telemetry-coupling violations.
- [x] Close Stage 12.2 specification status after implementation evidence.
- [ ] Run final branch-head CI after documentation closeout.
- [ ] Mark PR #27 Ready for Review only after final branch-head CI is GREEN.
- [ ] Merge PR #27 only after all required CI gates are GREEN.
- [ ] Verify the final merge commit with authoritative mainline CI.
- [ ] Record final merge SHA and mainline CI run here.

### Stage 12 roadmap

After Stage 12.2 closes, the remaining production-readiness workstreams are:

- **12.3 Auditability:** immutable operational/business audit records and queryable actor/action/reason metadata.
- **12.4 Failure & SLO:** explicit SLI/SLO definitions, alert thresholds, timeout/backpressure policy, and failure-injection tests.
- **12.5 Security Hardening:** secret handling, tenant isolation verification, least privilege, retention, and security regression gates.
- **12.6 Production Readiness Benchmark:** production-operability benchmark matrix covering observability, control, audit, SLO, and security invariants.
- **12.7 Final Mainline Verification:** complete Stage 12 only after all gates pass on mainline.
