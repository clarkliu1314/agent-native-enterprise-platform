# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 12 — Production Readiness & Operability; Task 12.1 Observability Contract design approved and implementation plan established.

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

### Execution order

1. Establish Stage 11 API RED gate.
2. Implement the thinnest application adapter over existing domain services/runtime port.
3. Add durable integration tests for idempotency, optimistic concurrency, tenant isolation, and WAITING/resume.
4. Add Vercel bounded-request handoff tests.
5. Run full CI and record exact SHA/run evidence.

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

The production-path concurrency test intentionally uses two independent runtime service instances and an unsuppressed external-effect callback; the assertion is therefore not supplied by benchmark-only duplicate-effect suppression.

Authoritative evidence:

- B14-B16 implementation merged through PR #24.
- PR #25 production idempotency audit merged after Run #515 — GREEN.
- Post-merge authoritative mainline CI: **Run #516 — GREEN**.

### Mainline hard gates

Run #516 completed successfully on the merge commit `be38ecf30b377e93e912e775e92f8f75e35335c1` and passed the following CI gates:

- Compose smoke: GREEN.
- Typecheck: GREEN.
- API Typecheck: GREEN.
- API Build: GREEN.
- Deployment Boundary verification: GREEN.
- Benchmark hard gate: GREEN.
- Full test job: GREEN.

### Stage 11 status

**CLOSED / COMPLETE.**

Stage 11 completion requires the post-merge mainline verification above; earlier feature-branch runs are retained as implementation evidence but are not treated as the final completion gate.

## Stage 12 — Production Readiness & Operability

Stage 12 moves the verified durable platform from engineering correctness toward production operability. The work remains layered over the existing runtime and persistence architecture and does not introduce a second durable execution model.

### Stage 12.1 — Observability Contract

**Status: DESIGN APPROVED / IMPLEMENTATION NOT YET COMPLETE.**

Authoritative design specification: `docs/superpowers/specs/2026-09-13-stage12-1-observability-contract.md`.

Implementation plan: `docs/superpowers/plans/2026-09-13-stage12-1-observability-contract.md`.

Scope:

1. Framework-neutral `CorrelationContext` covering request, trace, tenant, run, workflow, agent, and actor identity.
2. Structured lifecycle events for API, run, tool, recovery, and outbox operations.
3. Deterministic sensitive-data sanitization with deny-by-default handling of prompts, tool payloads, credentials, and arbitrary objects.
4. Bounded-cardinality metrics for run, tool, recovery, outbox, and WAITING operational behavior.
5. Stable operational error codes.
6. Explicit correlation propagation across `API → Runtime → Worker → Recovery → Tool → Outbox`.
7. Telemetry failure isolation so logger/metric failures cannot alter durable business outcomes.
8. End-to-end tests proving correlation and non-leakage through the production composition path.

Engineering gates:

- RED contract tests before production implementation.
- No vendor/OpenTelemetry SDK type in framework-neutral contracts for Task 12.1.
- No prompt/tool payload/credential serialization into telemetry.
- No high-cardinality identifiers as metric labels.
- No telemetry dependency inside critical PostgreSQL transaction semantics.
- Existing 64/64 benchmark and all existing durability invariants must remain GREEN.
- Completion requires post-merge mainline verification on the final merge commit.

Execution order:

1. Commit RED observability contract tests.
2. Implement the framework-neutral contract, sanitizer, and test adapters.
3. Wire correlation through application/runtime/recovery/tool/outbox boundaries.
4. Prove end-to-end propagation, sensitive-data protection, metric cardinality, and telemetry failure isolation.
5. Run the unchanged 64/64 benchmark hard gate plus full test/typecheck/build gates.
6. Review, merge, verify post-merge mainline CI, and record exact evidence.

### Stage 12 roadmap

After Task 12.1 closes, the next approved production-readiness workstreams are:

- **12.2 Operational Control Plane:** safe pause/resume/retry/cancel/recover operations with authorization and audit trails.
- **12.3 Auditability:** immutable operational/business audit records and queryable actor/action/reason metadata.
- **12.4 Failure & SLO:** explicit SLI/SLO definitions, alert thresholds, timeout/backpressure policy, and failure-injection tests.
- **12.5 Security Hardening:** secret handling, tenant isolation verification, least privilege, retention, and security regression gates.
- **12.6 Production Readiness Benchmark:** production-operability benchmark matrix covering observability, control, audit, SLO, and security invariants.
- **12.7 Final Mainline Verification:** complete Stage 12 only after all gates pass on mainline.
