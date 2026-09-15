# Stage 12.5 — Security Hardening Design

> **Status:** CLOSED / COMPLETE
> **Baseline:** Stage 12.4 verified mainline; implementation completed on Stage 12.5 and verified on exact merge SHA `3442f2bfb63071f534939e58651ebd238b11bab2` by Run #841.

## Purpose

Stage 12.5 hardens the existing Agent-native runtime against cross-tenant access, authorization bypass, secret leakage, unsafe retention/purge, replay abuse, and security-boundary regressions without introducing a second durable runtime or authoritative store.

## Locked architecture constraints

- PostgreSQL is the only durable source of truth.
- Redis is delivery/scheduling infrastructure only and is never authoritative for security state.
- RuntimeFacade remains the framework-neutral application boundary.
- API, Worker, Recovery, and Outbox Publisher remain separate composition roots.
- The Run FSM remains exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Existing transaction, idempotency, checkpoint, lease, and fencing semantics remain authoritative.
- Existing Tool Permission is extended/verified rather than replaced.
- Security controls fail closed when identity, tenant, permission, or sensitivity classification is missing or ambiguous.

## Security domains completed

### Secret handling

Known sensitive fields are removed before security-sensitive serialization, errors use a stable non-sensitive external boundary, and telemetry/audit contracts reject sensitive content rather than persisting it.

### Tenant isolation

Security context is explicit and immutable. Durable run ownership is authoritative for worker/recovery/outbox paths, and tenant mismatches fail closed.

### Least privilege

API, Worker, Recovery, Outbox, and Tool capabilities are separated through explicit permission requirements. Tool Permission remains the authorization boundary for tool execution.

### Retention and purge

Retention is tenant-scoped, permission-gated, idempotent, evidence-producing, and protects correctness-critical data from generic purge. Replay returns the original purge evidence deterministically.

## Security regression gate

The deterministic security regression benchmark contains exactly S01–S16 and writes only scalar-safe, non-sensitive result data. CI requires schema version 1, exactly 16 cases, exact S01–S16 ordering, 16 passes, and zero failures.

## Acceptance gates

Stage 12.5 is complete only with green Typecheck, API Build, Full Test, unchanged 64-case adapter benchmark, Security Regression S01–S16, Crash/Recovery/Fencing, Compose Smoke, and sensitive-data regression, followed by exact feature-head and exact merge-SHA mainline verification.

## Non-goals

This stage does not replace PostgreSQL, introduce a second scheduler/runtime, redesign the Run FSM, replace Tool Permission with another policy engine, redesign identity/SSO, or change the semantics of the existing 64-case adapter benchmark.
