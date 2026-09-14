# Stage 12.2 — Operational Control Plane Specification

**Status:** IMPLEMENTATION COMPLETE; final verification recorded against production-composition CI Run #670.

## Goal

Provide a safe, framework-neutral operational control plane for authorized pause, resume, retry, cancel, and recover actions over durable runs without introducing a second execution engine or bypassing existing recovery, fencing, idempotency, and outbox semantics.

## Architectural constraints

1. PostgreSQL remains the durable source of truth.
2. Redis remains delivery/scheduling only.
3. RuntimeFacade remains the single framework-neutral runtime boundary.
4. API handlers do not mutate durable state directly and do not execute long-running work.
5. Every control command is tenant-scoped, actor-attributed, permission-authorized, and idempotent.
6. Control actions must use the existing Run FSM and cannot create arbitrary durable states.
7. Retry/recover reuse the existing recovery candidate, lease, fencing, backoff, and tool-idempotency mechanisms.
8. Control telemetry uses the Stage 12.1 observability contract and never becomes authoritative business state.
9. Control commands emit durable outbox events suitable for the Stage 12.3 audit trail.
10. No framework/vendor runtime types cross domain or application contracts.

## Control command contract

Introduce a framework-neutral command model with an explicit action union:

```ts
export type OperationalControlAction =
  | 'PAUSE'
  | 'RESUME'
  | 'RETRY'
  | 'CANCEL'
  | 'RECOVER';

export interface OperationalControlCommand {
  commandId: string;
  tenantId: string;
  runId: string;
  actorId: string;
  action: OperationalControlAction;
  reason?: string;
  idempotencyKey: string;
  expectedVersion?: number;
  correlation: CorrelationContext;
}
```

The command is an application intent, not a database mutation. The durable service validates authorization, ownership, idempotency, expected version, and the current run state before committing a transition and its outbox event in one PostgreSQL transaction.

## Semantics

### PAUSE

Pause is a durable operator intent that prevents the run from starting additional execution work while preserving resumability. A running worker must observe the pause boundary before beginning the next effectful unit. PAUSE is not a second FSM state; it is a durable control flag associated with an otherwise valid run state.

### RESUME

Resume clears the durable pause intent and makes the run eligible for normal continuation. It is valid only for a paused run that is not terminally cancelled or failed-final.

### CANCEL

Cancel is terminal operator intent. Once durably cancelled, normal resume is forbidden. In-flight workers are fenced/invalidated through the existing concurrency mechanism before any subsequent effectful continuation is accepted.

### RETRY

Retry is permitted only for retryable failed work and must reuse existing bounded recovery semantics. It must not directly manufacture a RUNNING state or bypass recovery candidate creation/claiming.

### RECOVER

Recover requests recovery processing through the existing RecoveryCandidateStore/worker path. It must preserve fencing, lease, backoff, and idempotency guarantees and may not perform recovery work inside the HTTP request.

## Authorization and tenant isolation

Authorization is checked before durable mutation. The command actor must be authorized for the requested action and the target run must belong to the command tenant. Cross-tenant run IDs are rejected without revealing target-run state.

Recommended permission names:

- `run.pause`
- `run.resume`
- `run.retry`
- `run.cancel`
- `run.recover`

## Idempotency and concurrency

The command ID/idempotency key uniquely identifies an operator intent within tenant scope. Replaying the same command returns the original durable outcome and does not create another business transition or duplicate outbox event.

`expectedVersion` is optional optimistic concurrency protection. A stale expected version yields a stable `CONCURRENCY_CONFLICT` error code and leaves durable state unchanged.

## Durable audit-ready events

Each accepted control command writes a safe scalar outbox event containing at minimum:

- commandId
- tenantId
- runId
- actorId
- action
- outcome
- reason classification or sanitized reason
- resulting run state/control flag
- previous and new version
- correlation identifiers needed for continuation

No prompt, tool input/output, credentials, arbitrary request body, or investment document content may be persisted in control metadata.

## HTTP boundary

Expose stateless control endpoints through the existing API application boundary. Exact route shape should follow existing API conventions, but all operations must map to the same application command service. Accepted asynchronous operations return the existing bounded-request handoff semantics rather than executing durable work in-process.

## Failure semantics

- Authorization, tenant, state, idempotency, and concurrency failures do not mutate durable state.
- Database transaction failure rolls back both control mutation and outbox event.
- Outbox publication failure does not roll back an already committed control decision.
- Telemetry failure does not alter control outcomes.
- A stale worker cannot continue effectful work after cancellation/pause fencing requirements are met.

## RED Gate

Before implementation, tests must fail for:

1. authorized pause creates a durable pause intent and one outbox event;
2. unauthorized or cross-tenant control is rejected without mutation;
3. duplicate command replay returns the original outcome without a duplicate event;
4. stale expected version is rejected;
5. resume clears pause and permits normal continuation;
6. cancel is terminal and normal resume is rejected;
7. retry delegates to existing recovery semantics rather than manufacturing RUNNING;
8. recover delegates to existing recovery candidate processing without running inside HTTP;
9. concurrent control commands serialize correctly;
10. telemetry failure does not change durable control outcome;
11. control events preserve safe correlation and contain no sensitive payloads;
12. stale workers are prevented from effectful continuation after a terminal control decision.

## Acceptance criteria

Stage 12.2 is complete only when:

- all control-plane contract and integration tests pass;
- authorization and tenant isolation are proven;
- command idempotency and optimistic concurrency are proven under concurrent execution;
- pause/resume/cancel semantics are proven against real durable state;
- retry/recover reuse the existing recovery path;
- at least one production-composition E2E test proves operator command → durable mutation → outbox event → worker/recovery behavior;
- telemetry failure isolation remains proven;
- existing 64/64 benchmark and full suite remain GREEN;
- Typecheck and API Build remain GREEN;
- final merge commit has a GREEN mainline CI run recorded in the main implementation plan.
