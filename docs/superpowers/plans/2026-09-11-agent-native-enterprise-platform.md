# Agent-native Enterprise Platform Implementation Plan

> **Current phase:** Stage 10 complete; Stage 11 application/API integration.

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

Stage 11 exposes the durable investment capabilities through the existing stateless application boundary. It must reuse existing domain services and the framework-neutral runtime port rather than introducing another runtime or persistence implementation.

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
