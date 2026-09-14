# Stage 12.3 — Auditability Specification

**Status:** CLOSED / COMPLETE.

## Closeout evidence

- Feature branch: `feat/stage12-3-auditability`
- Final feature-branch verification: **Run #762 — GREEN** on commit `f12a1df5b40009797082085658eb058eb4e6d7d1`.
- Pull request: **PR #28 — MERGED**.
- Merge commit: `69f356bc2af3d4e8481ee3b1b47f48d73d2181e8`.
- Final mainline verification: **Run #763 — GREEN** on the merge SHA above.
- Run #763 required a rerun of the Compose Smoke job after a transient Docker Hub `auth.docker.io` connection reset; no application-code change was made for that infrastructure failure.

## Goal

Provide an immutable, tenant-scoped audit trail for operator controls and material durable business/runtime actions. Audit records must be queryable by authorized actors without becoming a second source of truth or a second event-processing model.

## Architectural constraints

1. PostgreSQL remains the durable source of truth.
2. Existing `agent_events` remain the canonical durable runtime/business event stream; auditability must not fork command execution into a second runtime.
3. Existing transactional Outbox semantics remain the publication boundary. An auditable action and its audit record must not be committed independently.
4. Audit records are append-only and immutable after commit.
5. Every audit record is tenant-scoped and actor-attributed where an actor exists; system actors are explicit rather than inferred.
6. API/query handlers do not write audit rows directly and do not execute long-running work.
7. Redis and process memory cannot be authoritative audit state.
8. Audit payloads contain safe scalar metadata only; prompts, completions, tool input/output, credentials, raw request bodies, investment documents, and arbitrary serialized domain objects are prohibited.
9. Correlation identifiers may be retained for traceability, but unbounded identifiers are not used as metric labels.
10. Audit persistence failures must preserve the same transaction semantics as the business action: no durable business mutation may commit without its required audit record.

## Audit record model

Introduce a framework-neutral audit record contract:

```ts
export type AuditActorType = 'USER' | 'SERVICE' | 'SYSTEM';

export type AuditOutcome =
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'REPLAYED';

export interface AuditRecord {
  auditId: string;
  tenantId: string;
  occurredAt: string;
  actorId: string;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: AuditOutcome;
  reasonClass: 'NONE' | 'PROVIDED' | 'SYSTEM';
  correlation: {
    requestId: string;
    traceId: string;
    runId?: string;
    workflowId?: string;
    agentId?: string;
  };
  version?: number;
  metadata: Record<string, string | number | boolean | null>;
}
```

The audit record is a durable fact, not a command or a mutable projection. `metadata` is allow-listed scalar data only.

## What is audited

### Operational controls

Every accepted and rejected control command is auditable, including PAUSE, RESUME, RETRY, CANCEL, and RECOVER. Accepted commands include action, outcome, actor, tenant, target run, resulting version/state classification, and correlation identifiers. Replay is recorded as `REPLAYED` only when intentionally surfaced as an audit observation; it must not create a duplicate business transition or duplicate control outbox event.

### Durable business/runtime actions

Auditability extends to material durable state transitions already represented by the existing event stream, including run lifecycle transitions, recovery outcomes, and material investment decision transitions. The implementation reuses existing durable events rather than introducing parallel command execution.

### Rejected operations

Authorization, tenant-isolation, invalid-state, concurrency, and other policy rejections are auditable without exposing the existence or contents of cross-tenant resources. Rejected cross-tenant requests never reveal target-run state.

## Event and audit relationship

The implementation uses a single durable transaction boundary:

`Command / Domain Action → durable state mutation + agent_event + audit_record + outbox`

The audit record references the originating event or command identifier through safe scalar metadata. It does not replace `agent_events`, and `agent_events` do not become mutable audit records.

For existing events that predate Stage 12.3, no backfill is required unless explicitly added as a bounded migration task. New auditable events satisfy the invariant from the first commit onward.

## Immutability

Audit rows are append-only. The application exposes no update/delete operation for audit records. Database permissions/migration design prevents ordinary application paths from modifying or deleting committed audit facts.

Queries return stable records ordered by `occurredAt` plus `auditId` (or another deterministic tie-breaker). The query contract cannot mutate or reinterpret historical records.

## Tenant isolation and authorization

Audit queries require an explicit tenant scope and an actor authorized to view that tenant's audit trail. Cross-tenant access returns the same non-disclosing authorization behavior used elsewhere.

The audit write path derives tenant/actor identity from authenticated command/application context and does not trust arbitrary tenant or actor values from an unvalidated request body.

## Sensitive-data protection

The audit layer reuses the Stage 12.1 sanitization policy. Forbidden fields include prompt/completion, tool input/output, password/token/secret/apiKey/authorization/cookie, private keys/credentials, raw request bodies, investment/company diligence documents and content, and arbitrary serialized domain objects.

Free-form reason text is never persisted directly unless an explicit sanitized classifier permits it. The baseline implementation stores `reasonClass` only.

## Idempotency, retries, and recovery

Audit persistence participates in the same transaction as the originating durable action. Therefore duplicate idempotent commands cannot create duplicate durable business transitions; failed transactions create neither the business mutation nor its audit record; outbox publication failure does not roll back a committed audit fact; recovery and retry produce auditable state transitions without manufacturing a second execution model; cancellation/fencing outcomes remain attributable to the actor or system actor causing the durable decision.

For concurrent same-key operations, exactly one committed business action and one corresponding accepted-action audit fact are expected.

## Query contract

The initial query surface remains deliberately narrow: tenant-scoped list/search; resource type/resource ID filters; actor ID filters; action/outcome filters; bounded time range; deterministic pagination/order. No arbitrary SQL, unbounded payload search, or cross-tenant query is exposed through the application boundary.

## Failure semantics

1. Audit insert failure rolls back the associated durable business mutation and originating event/outbox transaction.
2. Outbox publication failure after commit does not delete or mutate the audit record.
3. Audit query failure is read-only and cannot alter durable state.
4. Telemetry failure remains non-authoritative as established by Stage 12.1.
5. Sanitization failure is fail-closed for sensitive fields; prohibited payloads are rejected rather than persisted.

## TDD / RED gate

Before implementation, tests were required to fail for:

1. accepted PAUSE/RESUME/CANCEL control produces exactly one immutable audit record;
2. retry/recover produces an auditable recovery decision without manufacturing `RUNNING`;
3. authorization and cross-tenant rejection are auditable without leaking target state;
4. duplicate idempotent command does not create a duplicate accepted-action audit fact;
5. stale expected version creates no durable mutation or audit mutation;
6. business/event/audit/outbox writes are atomic under transaction failure;
7. committed audit facts survive outbox publication failure;
8. audit rows cannot be updated/deleted through the application repository;
9. forbidden sensitive fields never enter persisted audit metadata;
10. concurrent commands serialize without duplicate accepted audit facts;
11. audit queries enforce tenant scope, authorization, bounded time range, and deterministic pagination;
12. crash/recovery paths preserve audit completeness.

## Acceptance criteria

Stage 12.3 is complete when the framework-neutral audit contract and PostgreSQL repository are implemented; accepted and rejected operational controls have deterministic audit semantics; material durable business/runtime transitions are auditable without a second runtime; audit + business event + outbox atomicity is proven; append-only/immutability is enforced by application and database boundaries; tenant isolation and audit-query authorization are proven; sensitive-data deny-list tests remain GREEN; idempotency, retry, recovery, crash, and concurrency audit invariants are proven; a production-composition E2E test proves command → durable mutation → audit record → outbox/publication path; existing 64/64 benchmark and full suite remain GREEN; and Typecheck, API Build, Deployment Boundary, and Compose Smoke remain GREEN.

All acceptance criteria were satisfied by the implementation and final CI evidence recorded above.