# Stage 12.3 — Auditability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an immutable, tenant-scoped, actor-attributed audit trail for operational controls and material durable runtime/business actions, with atomic PostgreSQL persistence, safe-data enforcement, authorized bounded queries, and production-composition verification.

**Architecture:** PostgreSQL remains the durable source of truth. Existing `agent_events` remain the canonical runtime/business event stream and the existing transactional Outbox remains the publication boundary; audit records are an additional immutable durable fact written in the same transaction as the originating durable mutation. Framework-neutral runtime/application contracts expose audit writing and querying without introducing a second runtime or event-processing model.

**Tech Stack:** TypeScript monorepo, PostgreSQL, existing `SqlClient`/`TransactionRunner` ports, existing RuntimeFacade/application boundaries, Vitest-based tests, GitHub Actions, Docker Compose, Vercel bounded-request API composition.

**Spec:** `docs/superpowers/specs/2026-09-14-stage12-3-auditability.md`

## Global Constraints

- PostgreSQL remains durable source of truth.
- Existing `agent_events` remain canonical durable runtime/business event stream; auditability must not fork command execution into a second runtime.
- Existing transactional Outbox remains publication boundary; auditable action and audit record must not commit independently.
- Audit records are append-only and immutable after commit.
- Every audit record is tenant-scoped and actor-attributed; system actors are explicit.
- API/query handlers do not write audit rows directly and do not execute long-running work.
- Redis/process memory cannot be authoritative audit state.
- Audit payloads are safe scalar only; prompts, completions, tool input/output, credentials, raw request bodies, investment documents, arbitrary serialized domain objects are prohibited.
- Correlation IDs may be retained but are not metric labels.
- Write-path tenant/actor attribution comes from authenticated application/command context, not an unvalidated request body.
- Audit persistence failure rolls back the associated durable business mutation, event, and outbox record.
- Outbox publication failure after commit does not delete or mutate the audit record.
- Telemetry failure is non-authoritative and must not change durable outcome.
- TDD is mandatory: each implementation task starts with a RED test and commits independently.
- Existing 64/64 benchmark and full regression must remain GREEN.

## File Map

Create/modify only the focused files below unless implementation evidence requires a directly coupled test/fixture update:

- Create `packages/runtime/src/auditability.ts` — framework-neutral audit actor/outcome/record, write/query ports, validation/sanitization errors, and in-memory test implementation.
- Create `packages/runtime/src/postgres-audit-repository.ts` — PostgreSQL append-only audit persistence and bounded tenant-scoped query implementation.
- Modify `packages/runtime/src/operational-control.ts` — inject an audit writer into accepted/rejected/replayed control execution without changing Run FSM semantics or recovery delegation.
- Modify `packages/runtime/src/postgres-operational-control-repository.ts` — persist the control audit fact inside the same transaction as run mutation, `agent_events`, outbox, and idempotency response.
- Modify the runtime/business event integration files identified by the RED tests — map material run/recovery/investment decision transitions to safe audit records at their existing durable transaction boundaries; do not add a parallel dispatcher.
- Create/modify `tests/auditability.contract.test.ts` — framework-neutral contract and sanitization tests.
- Create/modify `tests/postgres-auditability.test.ts` — PostgreSQL atomicity, immutability, tenant isolation, query, and failure tests.
- Create/modify `tests/operational-control.audit.test.ts` — control audit semantics, replay, rejection, concurrency, retry/recover, and sensitive-data tests.
- Create/modify `tests/runtime.audit.test.ts` — material durable runtime/business transition audit mapping and crash/recovery completeness.
- Create/modify `tests/auditability.production.e2e.test.ts` — production-composition API/worker/recovery/audit path.
- Modify the appropriate PostgreSQL migration/DDL directory — create the audit table, indexes, append-only constraints/triggers/permissions, and any required migration metadata following existing repository migration conventions.
- Modify `docs/superpowers/specs/2026-09-14-stage12-3-auditability.md` — implementation status and verification evidence only after code is complete.
- Modify `docs/superpowers/plans/2026-09-14-stage12-3-auditability.md` — task checkboxes, commit/run evidence, and final closeout.
- Modify `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` — Stage 12.3 status and authoritative verification evidence at closeout.

---

### Task 1: Establish the RED gate for auditability

**Files:**
- Create: `tests/auditability.contract.test.ts`
- Create: `tests/operational-control.audit.test.ts`
- Create: `tests/postgres-auditability.test.ts`
- Create: `tests/runtime.audit.test.ts`
- Create: `tests/auditability.production.e2e.test.ts`

**Interfaces:**
- Consumes the existing `OperationalControlService`, PostgreSQL ports, RuntimeFacade/application composition, and Stage 12.1 observability sanitization policy.
- Produces failing executable acceptance tests that define the exact audit contract before implementation.

- [ ] **Step 1: Write the failing contract tests**

Add tests covering these exact cases: accepted PAUSE/RESUME/CANCEL create exactly one immutable audit fact; RETRY/RECOVER are audited without changing a non-FAILED run to `RUNNING`; authorization and cross-tenant rejection are audited without target-state leakage; idempotent replay returns the original result without a duplicate accepted audit; stale expected version performs no mutation and records only the defined rejection audit; transaction failure rolls back run mutation/event/audit/outbox; outbox publication failure leaves committed audit intact; app-level update/delete is impossible; forbidden sensitive fields never persist; concurrent same-key control creates exactly one accepted fact; tenant-scoped bounded query enforces authorization and deterministic pagination; recovery/crash leaves an audit-complete durable trail.

Use assertions against safe scalar fields only, including `tenantId`, `actorId`, `action`, `resourceType`, `resourceId`, `outcome`, `reasonClass`, correlation IDs, version, and bounded metadata. Explicitly assert that values containing `prompt`, `completion`, `tool input/output`, `password`, `token`, `secret`, `apiKey`, `authorization`, `cookie`, `privateKey`, raw body, and diligence/document content are rejected or absent according to the sanitizer contract.

- [ ] **Step 2: Run the new tests and verify RED**

Run the focused audit test files with the repository's existing test command. Expected: failures because the audit contract/repository/integration does not yet exist. Do not weaken assertions to obtain a false RED/green transition.

- [ ] **Step 3: Commit the RED gate**

```bash
git add tests/auditability.contract.test.ts tests/operational-control.audit.test.ts tests/postgres-auditability.test.ts tests/runtime.audit.test.ts tests/auditability.production.e2e.test.ts
git commit -m "test(stage12.3): establish auditability red gate"
```

---

### Task 2: Implement the framework-neutral audit contract

**Files:**
- Create: `packages/runtime/src/auditability.ts`
- Modify: `tests/auditability.contract.test.ts`

**Interfaces:**
- Produces `AuditActorType = 'USER' | 'SERVICE' | 'SYSTEM'`.
- Produces `AuditOutcome = 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'REPLAYED'`.
- Produces `AuditRecord` exactly as defined in the Stage 12.3 spec.
- Produces `AuditQuery` with explicit tenant scope, optional resource/actor/action/outcome filters, bounded `from`/`to`, `limit`, and deterministic cursor/order fields.
- Produces `AuditRepository.append(record)` and `AuditRepository.query(query)`; append has no update/delete operation.
- Produces validation/sanitization that reuses the Stage 12.1 forbidden-field policy and fails closed.

- [ ] **Step 1: Implement the minimal types and write/query ports**

Define the exact audit record fields from the spec. Keep `metadata` typed as `Record<string, string | number | boolean | null>`. Do not add arbitrary payload objects or raw command bodies. Keep correlation scalar and optional only for `runId`, `workflowId`, and `agentId`.

- [ ] **Step 2: Implement fail-closed record validation**

Reject empty tenant/actor/action/resource identifiers, invalid outcomes, unbounded time windows, non-positive/oversized limits, and forbidden sensitive keys/content. Classify reasons using `NONE | PROVIDED | SYSTEM`; never persist the raw free-form reason.

- [ ] **Step 3: Implement an in-memory append/query repository for unit tests**

The implementation must append only, return stable order by `occurredAt` then `auditId`, enforce tenant scope, and expose no mutation method. It is a test double only and must never be used as authoritative production state.

- [ ] **Step 4: Run the focused contract tests**

Expected: Task 2 contract/sanitization tests PASS; integration tests remain RED.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/auditability.ts tests/auditability.contract.test.ts
git commit -m "feat(stage12.3): add framework-neutral audit contract"
```

---

### Task 3: Add the PostgreSQL audit store and immutability boundary

**Files:**
- Create: `packages/runtime/src/postgres-audit-repository.ts`
- Modify: existing PostgreSQL migration/DDL file(s) under the repository's established migration directory
- Modify: `tests/postgres-auditability.test.ts`

**Interfaces:**
- Consumes `AuditRepository`, `SqlClient`, `TransactionRunner`.
- Produces `PostgresAuditRepository` with append and bounded tenant-scoped query methods.

- [ ] **Step 1: Add the failing PostgreSQL schema/immutability tests**

Assert the audit table contains tenant, actor, action, resource, outcome, timestamp, reason class, correlation, version, and safe metadata columns; has indexes supporting tenant/time and tenant/resource queries; ordinary application paths cannot update/delete rows; and tenant filtering is mandatory.

- [ ] **Step 2: Add the audit table migration**

Follow the existing migration naming/runner convention. Store safe scalar correlation/metadata as structured JSONB only where existing conventions support it, with application validation plus database constraints. Add an append-only trigger or equivalent database permission boundary that rejects `UPDATE` and `DELETE` for ordinary application roles. Add deterministic indexes for tenant/time/resource and any query fields actually exposed.

- [ ] **Step 3: Implement append/query**

`append` must execute only `INSERT`. `query` must require tenant ID, enforce bounded time range and page size, apply all filters with parameterized SQL, and order deterministically by `occurred_at ASC, audit_id ASC` (or the repository's established equivalent if timestamp precision requires a tie-breaker). Never expose arbitrary SQL or cross-tenant search.

- [ ] **Step 4: Run PostgreSQL tests**

Expected: schema, tenant isolation, pagination/order, append-only, and sanitizer tests PASS; transaction-integration tests remain RED until Tasks 4–5.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/postgres-audit-repository.ts <migration-files> tests/postgres-auditability.test.ts
git commit -m "feat(stage12.3): add immutable postgres audit repository"
```

---

### Task 4: Integrate operational-control auditing atomically

**Files:**
- Modify: `packages/runtime/src/operational-control.ts`
- Modify: `packages/runtime/src/postgres-operational-control-repository.ts`
- Modify: `tests/operational-control.audit.test.ts`
- Modify: `tests/postgres-auditability.test.ts`

**Interfaces:**
- Consumes `AuditRepository`/audit write port from Task 2.
- Produces exactly one accepted audit fact for a committed control action, with replay/rejection semantics explicitly represented and no duplicate accepted fact.

- [ ] **Step 1: Add RED tests for atomic control audit**

Test PAUSE, RESUME, CANCEL, RETRY, and RECOVER accepted actions. Assert action/actor/tenant/resource/outcome/version/correlation. Assert retries/recovery preserve the existing recovery semantics and never manufacture `RUNNING`. Assert command replay returns the durable original result without another accepted audit fact. Assert a transaction failure rolls back state, `agent_events`, outbox, idempotency, and audit together.

- [ ] **Step 2: Thread an audit writer through the service without changing the command boundary**

Extend `OperationalControlServiceOptions` with an audit dependency. Keep the existing authorization-before-mutation ordering. Build audit facts from authenticated command/application context and safe resulting-state/version fields only.

- [ ] **Step 3: Persist audit inside the existing PostgreSQL transaction**

In `PostgresOperationalControlRepository.apply`, insert the audit row in the same transaction after the locked state mutation/event/outbox preparation and before commit. If audit insertion fails, throw so the whole transaction rolls back. Do not call an independent transaction from inside the repository.

- [ ] **Step 4: Define rejection/replay behavior without cross-tenant leakage**

For a known tenant-scoped command rejection, record a safe `REJECTED` fact where the existing transaction boundary can authoritatively persist it. For a cross-tenant target that must not reveal existence, use a generic safe resource classification and do not include target state. For idempotent replay, return the stored result and do not create another accepted business/audit fact.

- [ ] **Step 5: Verify outbox failure semantics**

Inject an outbox publisher failure after database commit in the existing publication path and assert the audit row remains unchanged and queryable. Do not add rollback behavior to compensate for an already committed durable fact.

- [ ] **Step 6: Run focused tests and commit**

Expected: operational-control audit tests and PostgreSQL atomicity tests PASS.

```bash
git add packages/runtime/src/operational-control.ts packages/runtime/src/postgres-operational-control-repository.ts tests/operational-control.audit.test.ts tests/postgres-auditability.test.ts
git commit -m "feat(stage12.3): audit operational controls atomically"
```

---

### Task 5: Audit material runtime/business transitions and recovery

**Files:**
- Modify: the existing runtime/recovery/investment-domain durable mutation files located by the RED tests
- Modify: `tests/runtime.audit.test.ts`
- Modify: `tests/auditability.production.e2e.test.ts`

**Interfaces:**
- Consumes the Task 2 audit write port and existing durable transaction/event boundaries.
- Produces audit facts for material run lifecycle, recovery outcome, and investment decision transitions without introducing a parallel event dispatcher or second runtime.

- [ ] **Step 1: Locate the existing durable mutation boundaries**

Use the failing tests and current repository code to identify the functions that already commit run lifecycle, recovery, and material investment decision transitions. Reuse those boundaries; do not create a new background audit worker or duplicate event-processing model.

- [ ] **Step 2: Add RED assertions for material transitions**

Assert run lifecycle transitions, retryable/final recovery outcomes, cancellation/fencing attribution, and material investment decision transitions each create exactly one safe audit fact at their existing durable commit boundary. Assert crash/recovery produces a complete sequence without duplicate facts.

- [ ] **Step 3: Implement the minimum mapping**

Map each existing durable event/action to an audit `action` and `resourceType` string with bounded scalar metadata. Preserve actor identity from the command/application context; use `SYSTEM` explicitly for autonomous recovery/system actions. Do not store domain payloads, tool results, prompts, completions, or investment documents.

- [ ] **Step 4: Verify idempotency/concurrency**

Run the existing duplicate-side-effect and recovery tests together with audit assertions. Confirm the same durable action cannot produce multiple accepted audit facts under retry or concurrent execution.

- [ ] **Step 5: Commit**

```bash
git add <runtime-and-domain-files> tests/runtime.audit.test.ts tests/auditability.production.e2e.test.ts
git commit -m "feat(stage12.3): audit material runtime and business transitions"
```

---

### Task 6: Add the authorized bounded audit query application/API boundary

**Files:**
- Create/modify the framework-neutral application audit query service at the existing application boundary
- Modify the API route/controller files under `apps/api/src`
- Modify: query-focused audit tests
- Modify: `tests/auditability.production.e2e.test.ts`

**Interfaces:**
- Produces a tenant-scoped read-only audit query contract.
- API accepts filters for resource type/id, actor, action, outcome, bounded time range, and deterministic pagination.
- API never accepts arbitrary SQL, arbitrary JSON search, cross-tenant tenant IDs, or unbounded limits.

- [ ] **Step 1: Add RED query tests**

Test authorized same-tenant query, unauthorized actor rejection, cross-tenant rejection without existence leakage, bounded time range, maximum page size, stable ordering/cursor, resource/action/outcome filters, and empty results.

- [ ] **Step 2: Implement application query service**

Validate authenticated tenant/actor context before repository access. Pass only normalized filters to `AuditRepository.query`. Keep query read-only and bounded.

- [ ] **Step 3: Add stateless API route**

Expose the repository's established API routing convention for audit queries. The handler performs mapping/validation/authentication and invokes the application query service; it does not write audit rows or perform long-running work.

- [ ] **Step 4: Run API and production-composition tests**

Expected: query tests PASS, API build/typecheck remains GREEN, production composition continues to use the existing durable RuntimeFacade boundary.

- [ ] **Step 5: Commit**

```bash
git add <audit-query-files> apps/api/src tests/auditability.production.e2e.test.ts
git commit -m "feat(stage12.3): expose bounded tenant audit queries"
```

---

### Task 7: Harden immutability, sensitive-data, and audit failure semantics

**Files:**
- Modify: `packages/runtime/src/auditability.ts`
- Modify: `packages/runtime/src/postgres-audit-repository.ts`
- Modify: relevant audit tests
- Modify: Stage 12.1 sanitizer integration only if a shared import is required

**Interfaces:**
- Consumes the existing Stage 12.1 sensitive-data policy.
- Produces fail-closed audit validation and database-enforced append-only semantics.

- [ ] **Step 1: Add RED property-style sensitive-data cases**

Test nested/variant casing of forbidden keys, credential-like values, raw body-shaped values, arbitrary serialized objects, and diligence/document content. Assert no forbidden material is persisted.

- [ ] **Step 2: Implement strict scalar allowlist**

Permit only the defined scalar metadata type. Reject arrays, objects, functions, serialized domain objects, and unknown sensitive keys. Preserve only safe reason classification, never raw reason text.

- [ ] **Step 3: Verify application/database immutability**

Attempt repository update/delete through the application surface and direct SQL using the normal application role. Both must fail. Confirm ordinary migrations do not silently weaken the append-only boundary.

- [ ] **Step 4: Verify audit transaction failure**

Inject audit insert failure and assert no associated business mutation/event/outbox/idempotency record commits. Inject outbox publish failure after commit and assert the audit row remains.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/auditability.ts packages/runtime/src/postgres-audit-repository.ts <audit-tests> <sanitizer-integration-files>
git commit -m "fix(stage12.3): harden audit immutability and data safety"
```

---

### Task 8: Production-composition E2E and benchmark integration

**Files:**
- Modify: `tests/auditability.production.e2e.test.ts`
- Modify: existing benchmark specification/adapter files for the Stage 12 production-readiness benchmark
- Modify: Docker Compose/test fixtures only where required to exercise PostgreSQL audit persistence

**Interfaces:**
- Consumes the production `RuntimeFacade`, PostgreSQL repositories, worker, recovery, API composition, and outbox publisher.
- Produces an end-to-end proof that the same production wiring used by real API/worker/recovery paths creates and queries durable audit records.

- [ ] **Step 1: Add the production-composition RED scenarios**

Exercise API control → durable PostgreSQL mutation → agent event → audit row → outbox; worker pause/resume/cancel continuation; retry/recover; crash/recovery; concurrent idempotent control; and audit query. Assert the production worker uses `PostgresOperationalControlRepository`, not an in-memory default.

- [ ] **Step 2: Implement only fixture/composition changes required by the tests**

Do not introduce a second production composition root or long-running HTTP behavior. Keep audit persistence inside the existing database transaction and use the existing outbox publisher.

- [ ] **Step 3: Add benchmark cases**

Add bounded auditability cases for atomicity, tenant isolation, immutability, sensitive-data exclusion, replay, concurrency, crash/recovery completeness, and outbox failure. Preserve the existing benchmark adapter interface and 64/64 baseline semantics.

- [ ] **Step 4: Run the production E2E and benchmark suite**

Expected: Stage 12.3 production E2E and the expanded production-readiness benchmark PASS; the original 64/64 benchmark remains GREEN.

- [ ] **Step 5: Commit**

```bash
git add tests/auditability.production.e2e.test.ts <benchmark-files> <compose-fixtures>
git commit -m "test(stage12.3): verify auditability in production composition"
```

---

### Task 9: Full verification, documentation, PR closeout, and mainline proof

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-stage12-3-auditability.md`
- Modify: `docs/superpowers/plans/2026-09-14-stage12-3-auditability.md`
- Modify: `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`

**Interfaces:**
- Consumes all implementation/test artifacts from Tasks 1–8.
- Produces authoritative documentation and a merged mainline SHA backed by CI evidence.

- [ ] **Step 1: Run focused Stage 12.3 tests**

Run contract, PostgreSQL, operational-control, runtime, API, and production-composition audit tests. Expected: all PASS.

- [ ] **Step 2: Run repository-wide verification**

Run the exact project gates used by prior stages: Typecheck, API Build, Deployment Boundary, Compose Smoke, full test suite, and the existing 64/64 benchmark. Expected: all GREEN. If any gate fails, stop completion claims and use systematic debugging before modifying code.

- [ ] **Step 3: Update the spec and plan with evidence**

Record implementation status, final audit schema/contract, focused test results, benchmark result, and exact authoritative CI run/commit SHA. Mark each task checkbox only after executable evidence exists.

- [ ] **Step 4: Commit documentation on the feature branch**

```bash
git add docs/superpowers/specs/2026-09-14-stage12-3-auditability.md docs/superpowers/plans/2026-09-14-stage12-3-auditability.md docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md
git commit -m "docs(stage12.3): record auditability verification status"
```

- [ ] **Step 5: Open/update the Stage 12.3 PR**

Use branch `feat/stage12-3-auditability` against `main`. Keep the PR Draft until the final branch-head CI is GREEN. Do not merge a branch with a failed or stale verification run.

- [ ] **Step 6: Merge only after final branch-head verification**

After merge, verify the mainline workflow against the exact merge SHA. The authoritative completion evidence must name the exact mainline commit and successful CI run. Never infer success from an earlier feature-branch run.

- [ ] **Step 7: Close Stage 12.3**

Only after mainline verification is GREEN, mark Stage 12.3 CLOSED/COMPLETE in the implementation plan and record the exact merge SHA and CI run. Then proceed to Stage 12.4 only through a new design/approval gate.

---

## Self-Review Checklist

- [ ] Every Stage 12.3 spec requirement maps to at least one implementation task.
- [ ] No task introduces a second runtime, second event-processing model, or authoritative Redis/process-memory audit store.
- [ ] Audit write and originating durable mutation share one PostgreSQL transaction.
- [ ] Outbox publication remains post-commit and cannot delete committed audit facts.
- [ ] Append-only is enforced both at application interface and database boundary.
- [ ] Tenant/actor attribution cannot be supplied by untrusted request body fields.
- [ ] Query API is tenant-scoped, authorized, bounded, parameterized, and deterministically ordered.
- [ ] Sensitive-data policy is fail-closed and reuses Stage 12.1 rules.
- [ ] Idempotency, retry, recovery, fencing, crash, and concurrency semantics are covered.
- [ ] Production worker/API composition uses the existing PostgreSQL durable boundaries.
- [ ] Existing 64/64 benchmark remains GREEN.
- [ ] No placeholder/TBD implementation step remains in the plan.
