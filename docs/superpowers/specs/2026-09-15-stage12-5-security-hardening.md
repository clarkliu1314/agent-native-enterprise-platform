# Stage 12.5 — Security Hardening Design

> **Status:** Design approved in chat; implementation not started.
>
> **Baseline:** mainline Stage 12.4 closeout, merge SHA `24b2bc26a75d4e46cce1038704c27c9b5e3e0f00`, verified by Run #820.

## 1. Purpose

Stage 12.5 hardens the verified Agent-native runtime against security failures that could cross tenant boundaries, disclose secrets or sensitive model/tool data, bypass authorization, abuse durable replay/idempotency, or weaken the existing fencing/audit guarantees.

The stage is security-hardening work on the existing architecture. It must not introduce a second durable runtime, a second authoritative state store, or a parallel authorization/audit model.

## 2. Locked architecture constraints

The following constraints remain unchanged:

- PostgreSQL is the only durable source of truth.
- Redis is delivery/scheduling infrastructure only and is never authoritative for security state.
- RuntimeFacade remains the framework-neutral application boundary.
- API, Worker, Recovery, and Outbox Publisher remain separate composition roots.
- The Run FSM remains exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Existing transaction, idempotency, checkpoint, lease, and fencing semantics remain authoritative.
- Existing Tool Permission is extended/verified rather than replaced.
- Security controls fail closed when identity, tenant, permission, or sensitivity classification is missing or ambiguous.

## 3. Security domains

### 3.1 Secret handling

Secrets include credentials, API keys, tokens, connection strings, signing material, and provider-specific authentication data.

Requirements:

1. Secrets must not be written to application logs, audit records, telemetry attributes, benchmark artifacts, error messages, or persisted workflow/event/checkpoint payloads.
2. Runtime configuration must inject secrets at composition roots; business/domain objects must receive only the minimum derived capability required for the operation.
3. Error serialization must redact secret-shaped values before crossing API, worker, recovery, or outbox boundaries.
4. Test fixtures must use deterministic placeholders and include explicit secret-leakage regression assertions.
5. Observability helpers must provide an allow-list of safe attributes rather than relying on ad-hoc redaction at individual call sites.

### 3.2 Tenant isolation

Every tenant-owned read, mutation, event append, checkpoint operation, audit query, operational-control operation, and security-sensitive tool invocation must be evaluated against the authenticated tenant context.

Requirements:

1. Tenant context is explicit and immutable for a request/execution scope.
2. Repository queries and mutations include tenant ownership predicates where data is tenant-scoped.
3. Object identifiers alone are never sufficient authorization; IDOR/cross-tenant replay must fail closed.
4. Worker, Recovery, and Outbox paths must preserve tenant ownership from durable records rather than accepting caller-supplied tenant reassignment.
5. Audit and operational-control APIs cannot retrieve or mutate another tenant's records through identifier substitution.
6. Cross-tenant attempts must produce no successful state mutation or side effect.

### 3.3 Least privilege

Security-sensitive capabilities are separated by composition root and operation.

Requirements:

- API credentials can admit/inspect only the operations exposed by the application boundary.
- Worker credentials can execute only the durable work required by a claimed run.
- Recovery can reclaim/retry only records allowed by its recovery role and fencing rules.
- Outbox Publisher can publish and mark delivery state but cannot mutate unrelated business state.
- Tool execution remains governed by Tool Permission and durable authorization context.
- Database roles should be scoped to the minimum tables/operations needed by each runtime component; no component receives broad administrative access merely for convenience.

### 3.4 Retention and sensitive data

The platform must classify durable and observable data before applying retention.

Classification boundaries:

- **Operational metadata:** run state, attempts, leases, timestamps, bounded identifiers.
- **Audit evidence:** actor, tenant, action, outcome, authorization decision, correlation metadata.
- **Execution data:** events, checkpoints, tool inputs/outputs and workflow payloads.
- **Sensitive model/application data:** prompts, completions, credentials, provider responses, confidential business fields.
- **Telemetry:** metrics/traces/logs with bounded, explicitly approved attributes.

Requirements:

1. Retention/purge applies only where the data class permits deletion; correctness-critical state cannot be purged before its durable lifecycle guarantees are satisfied.
2. Sensitive prompts/completions and tool payloads default to non-retention in telemetry.
3. Audit records remain tamper-evident and retain the minimum evidence required for governance.
4. Purge operations are tenant-scoped, authorized, idempotent, observable without exposing purged content, and themselves auditable.
5. Security-sensitive data must not be copied into benchmark artifacts or CI logs.

## 4. Security regression suite

The stage adds a deterministic security regression gate covering at least:

| ID | Scenario | Required invariant |
|---|---|---|
| S01 | Cross-tenant read by object ID | request rejected; no data disclosed |
| S02 | Cross-tenant mutation by object ID | rejected; no state mutation |
| S03 | Worker tenant substitution | durable tenant ownership wins; substitution rejected |
| S04 | Recovery cross-tenant claim | claim/recovery rejected |
| S05 | Outbox cross-tenant publication | publisher cannot publish another tenant's unauthorized record |
| S06 | Authorization bypass | missing/invalid permission fails closed |
| S07 | Secret in error/log/telemetry | secret absent from all emitted representations |
| S08 | Secret in audit/event/checkpoint | secret is rejected or redacted before persistence |
| S09 | Idempotency replay abuse | replay cannot create duplicate side effect or cross tenant effect |
| S10 | Stale fencing abuse | stale worker cannot mutate current owner state |
| S11 | Audit tampering attempt | unauthorized alteration rejected; evidence remains intact |
| S12 | Sensitive telemetry | prompt/completion/tool secret content is absent |
| S13 | Retention boundary violation | protected correctness/audit data is not prematurely purged |
| S14 | Purge authorization bypass | cross-tenant/unauthorized purge rejected |
| S15 | Deployment-boundary regression | stateless API boundary cannot become a durable execution authority |
| S16 | Missing security context | operation fails closed without tenant/actor/permission context |

The suite should exercise the real runtime/application boundaries where practical, with unit-level tests for redaction/classification helpers and integration-level tests for tenant/authorization/database behavior.

## 5. Implementation boundaries

Expected implementation areas are limited to the existing packages and composition roots. The exact file set is determined during implementation planning after repository inspection.

Likely concerns include:

- security context and authorization helpers;
- tenant-scoped repository predicates;
- secret-safe serialization/logging/telemetry utilities;
- audit and operational-control authorization checks;
- retention/purge service boundaries;
- security regression tests and CI gate.

No new standalone security service is required for this stage.

## 6. CI and acceptance gates

Stage 12.5 is complete only when all required gates pass:

1. Typecheck.
2. API build.
3. Full test suite.
4. Existing 64-case benchmark remains green and unchanged in semantics.
5. Security regression benchmark/suite passes all required cases.
6. Crash/recovery/fencing regression remains green.
7. Docker Compose smoke remains green.
8. Sensitive-data regression confirms no secret/prompt/completion leakage into logs, audit, telemetry, or benchmark artifacts.
9. Branch-head CI is green on the exact implementation HEAD.
10. After merge, mainline CI is green on the exact merge SHA.
11. Documentation closeout records the authoritative branch, PR, merge SHA, and mainline verification run.

## 7. Non-goals

Stage 12.5 does not:

- replace PostgreSQL or introduce another authoritative store;
- redesign the Run FSM;
- introduce a new runtime scheduler;
- replace Tool Permission with an external policy engine;
- redesign the complete identity/SSO platform;
- perform broad product-domain security certification outside the runtime/application boundary;
- change the semantics of the existing 64-case adapter benchmark.

## 8. Transition rule

After this design is accepted, the implementation plan must define concrete files, tests, branch/PR sequencing, and CI gates. Implementation starts only from the verified Stage 12.4 mainline baseline and must use a dedicated feature branch. The stage cannot be declared complete until exact merge-SHA verification and documentation closeout are complete.
