# Stage 12.1 — Observability Contract Specification

**Status:** Approved design baseline; implementation pending TDD RED gate.

## Goal

Establish a framework-neutral, production-grade observability contract that allows every durable execution to be correlated from the HTTP/application boundary through Runtime, Worker, Recovery, Tool Execution, and Outbox without leaking prompts, credentials, authorization material, or effect payloads.

## Architectural constraints

1. PostgreSQL remains the durable source of truth; observability must not become a second state store.
2. The RuntimeFacade and domain contracts remain framework-neutral; no OpenTelemetry/vendor SDK types may cross those boundaries in Task 12.1.
3. Redis remains delivery/scheduling only.
4. Existing Runtime, RecoveryCandidateStore, ToolExecutionService, and Outbox contracts remain authoritative for business behavior.
5. Logging and metrics are side-channel telemetry. Telemetry failure must not change durable business outcomes.
6. Telemetry must be structured and machine-queryable; free-form log strings are not the contract.
7. Secrets and sensitive execution payloads are deny-by-default.

## 1. Correlation context

Introduce a small immutable context contract:

```ts
export interface CorrelationContext {
  requestId: string;
  traceId: string;
  tenantId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
  actorId?: string;
}
```

Rules:

- `requestId` identifies the inbound application request or worker trigger.
- `traceId` identifies one end-to-end execution trace and may be propagated across asynchronous handoffs.
- `tenantId` is mandatory for application/runtime operations that already have tenant scope.
- `runId`, `workflowId`, `agentId`, and `actorId` are optional only where the current operation legitimately lacks them.
- Context is passed explicitly through framework-neutral contracts; AsyncLocalStorage is not the source of truth.
- Worker/recovery/outbox continuations must retain the original `traceId` when the durable message/event contains it; a new `requestId` may identify the new delivery attempt.

## 2. Structured logging contract

Define an adapter-neutral logger:

```ts
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  context: CorrelationContext;
  outcome?: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'RETRYING';
  durationMs?: number;
  errorCode?: string;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface ObservabilityLogger {
  emit(event: StructuredLogEvent): void;
}
```

Required event families:

- `run.started`, `run.waiting`, `run.succeeded`, `run.failed`, `run.cancelled`
- `tool.started`, `tool.succeeded`, `tool.failed`, `tool.replayed`, `tool.rejected`
- `recovery.claimed`, `recovery.reclaimed`, `recovery.retry_scheduled`, `recovery.failed_final`, `recovery.completed`
- `outbox.published`, `outbox.failed`, `outbox.retried`
- `api.accepted`, `api.rejected`

The event name is stable and suitable for dashboards/alerts. Business payloads remain outside the generic telemetry contract.

## 3. Sensitive-data policy

The telemetry boundary must reject or omit:

- prompt text and model completion text;
- tool input/output payloads;
- authorization headers, cookies, session tokens, API keys, OAuth tokens, passwords, private keys, and credentials;
- raw request bodies unless explicitly represented by a non-sensitive allow-listed attribute;
- investment/company documents and other diligence content;
- arbitrary serialized domain objects.

Allowed attributes are scalar operational dimensions only: IDs, states, result classifications, durations, counts, retry attempt number, queue lag, and bounded error codes.

A sanitizer must be deterministic and covered by tests for obvious secret keys and nested values. Unknown object values are never automatically serialized into telemetry.

## 4. Metrics contract

Define adapter-neutral metrics:

```ts
export interface ObservabilityMetrics {
  increment(name: string, value?: number, attributes?: Record<string, string>): void;
  observe(name: string, value: number, attributes?: Record<string, string>): void;
  gauge(name: string, value: number, attributes?: Record<string, string>): void;
}
```

Canonical metric names:

- `agent_run_started_total`
- `agent_run_completed_total`
- `agent_run_failed_total`
- `agent_tool_execution_total`
- `agent_tool_execution_failed_total`
- `agent_recovery_attempt_total`
- `agent_recovery_retry_total`
- `agent_recovery_terminal_failure_total`
- `agent_outbox_publish_total`
- `agent_outbox_publish_failed_total`
- `agent_outbox_lag_ms`
- `agent_run_waiting_ms`

Metric labels must be bounded-cardinality operational labels such as `tenant`, `agent`, `state`, `tool`, `outcome`, and `error_code`. Never use `runId`, `requestId`, `traceId`, prompt text, or arbitrary user input as metric labels.

## 5. Error/event classification

Use stable operational error codes rather than arbitrary error-message strings. At minimum:

- `AUTHORIZATION_DENIED`
- `IDEMPOTENCY_CONFLICT`
- `STALE_FENCING_TOKEN`
- `RUN_NOT_FOUND`
- `INVALID_STATE_TRANSITION`
- `RECOVERY_LEASE_LOST`
- `RECOVERY_RETRYABLE`
- `RECOVERY_FINAL`
- `OUTBOX_PUBLISH_FAILED`
- `INTERNAL_ERROR`

The classifier may preserve the original Error object for local diagnostics, but telemetry receives only the stable code plus safe scalar metadata.

## 6. Propagation requirements

The following chain is mandatory:

`API request -> DeploymentApplication -> RuntimeFacade -> Worker -> Recovery -> ToolExecutionService -> Outbox Publisher`.

Every boundary that starts or resumes work must accept/produce `CorrelationContext` and preserve tenant/run identity. Durable recovery and outbox records must carry the minimum correlation fields needed for continuation without relying on process memory.

## 7. Failure semantics

Telemetry emission is best-effort:

- logger/metric exceptions are swallowed after local diagnostic handling;
- a telemetry outage must not roll back a successful business transaction;
- telemetry must never be awaited inside the critical PostgreSQL transaction unless the implementation is guaranteed non-blocking and failure-isolated;
- business errors remain authoritative even if telemetry cannot be emitted.

## 8. RED Gate

Before implementation, tests must fail for these behaviors:

1. correlation context is accepted and preserved across a runtime execution;
2. structured lifecycle events contain required context and stable event names;
3. sensitive fields are not emitted;
4. metric names and bounded labels are enforced;
5. telemetry failures do not fail business execution;
6. worker/recovery continuation preserves trace identity;
7. tool/outbox events are correlated without serializing tool payloads;
8. duplicate lifecycle emissions do not mutate durable business state.

The RED Gate is a contract gate, not a production implementation. The first implementation task may add only the minimal interfaces, sanitizer, test doubles, and wiring needed to turn these tests GREEN.

## 9. Acceptance criteria

Task 12.1 is complete only when:

- all observability contract tests pass;
- existing 64/64 benchmark hard gate remains unchanged and GREEN;
- existing full test suite remains GREEN;
- Typecheck and API Build remain GREEN;
- no existing durable state machine or idempotency semantics change;
- telemetry outage tests demonstrate business-success preservation;
- at least one end-to-end test proves correlation from application request to tool/outbox lifecycle events;
- a mainline CI run on the final merge commit is GREEN and recorded in the implementation plan.
