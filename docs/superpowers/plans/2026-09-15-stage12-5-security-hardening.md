# Stage 12.5 — Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing durable Agent-native runtime against cross-tenant access, authorization bypass, secret leakage, unsafe retention/purge, replay abuse, and security-boundary regressions without introducing a second runtime or authoritative store.

**Architecture:** Extend the existing RuntimeFacade, repository, Tool Permission, audit, observability, and composition-root boundaries. PostgreSQL remains the sole durable source of truth; Redis remains delivery/scheduling only. Security context is explicit and fail-closed, and all new controls reuse existing transaction, idempotency, checkpoint, lease, fencing, audit, and stateless-boundary semantics.

**Tech Stack:** TypeScript, Node.js, PostgreSQL, Redis delivery infrastructure, existing runtime/application packages, Vitest/Jest-style repository test conventions, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-stage12-5-security-hardening.md`

## Global Constraints

- PostgreSQL is the only durable source of truth.
- Redis is delivery/scheduling infrastructure only and is never authoritative for security state.
- RuntimeFacade remains the framework-neutral application boundary.
- API, Worker, Recovery, and Outbox Publisher remain separate composition roots.
- The Run FSM remains exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Existing transaction, idempotency, checkpoint, lease, and fencing semantics remain authoritative.
- Existing Tool Permission is extended/verified rather than replaced.
- Security controls fail closed when identity, tenant, permission, or sensitivity classification is missing or ambiguous.
- The existing 64-case adapter benchmark semantics must remain unchanged.
- No secret, prompt, completion, credential, provider response, or confidential business field may enter CI logs or benchmark artifacts.

---

## File map

The implementation should first confirm these existing locations and follow their established patterns before editing:

- `packages/runtime/src/*` — runtime security context, tenant ownership, authorization, fencing/replay boundaries.
- `packages/runtime/src/*integration.test.ts` / `packages/runtime/src/*.test.ts` — runtime security regression coverage.
- `packages/observability/src/*` — safe telemetry/log attribute allow-list and sensitive-data protection.
- `packages/audit/src/*` or existing audit implementation — tenant/actor authorization, tamper resistance, retention boundary.
- `apps/api/src/*` — stateless request security context and API authorization boundary.
- `apps/worker/src/*`, recovery/outbox composition roots — durable tenant ownership and least-privilege boundaries.
- `packages/benchmark/src/*` and `tests/*security*.test.ts` — deterministic security regression gate.
- `.github/workflows/ci.yml` — security regression gate placement after existing hard gates and before final full-test/acceptance completion as appropriate.
- `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` — stage status after implementation/closeout.

If the repository differs from this map, update the plan before implementation rather than inventing parallel packages.

---

## Task 1: Establish explicit security-context contract

**Files:**
- Inspect and modify the existing application/runtime security-context or authorization boundary.
- Test: existing authorization/context test location plus a new focused security-context test if no suitable file exists.

**Interfaces:**
- Consumes: authenticated actor identity, immutable tenant identity, permission/capability context.
- Produces: a single immutable execution/request security context that downstream runtime boundaries can require.

- [ ] **Step 1: Write failing tests** for: missing tenant context rejects a tenant-scoped operation; missing actor/permission context rejects a security-sensitive operation; a valid context cannot be mutated after construction.
- [ ] **Step 2: Run only the new tests and verify RED** with the repository's existing test command.
- [ ] **Step 3: Implement the minimal immutable context contract** using the repository's existing identity/permission types where available.
- [ ] **Step 4: Re-run the focused tests and verify GREEN.**
- [ ] **Step 5: Commit** with `feat(stage12.5): establish fail-closed security context`.

---

## Task 2: Enforce tenant ownership on durable runtime paths

**Files:**
- Modify existing PostgreSQL repository/runtime methods that read or mutate tenant-scoped Run/Event/Checkpoint/Idempotency records.
- Test: runtime integration security tests.

**Interfaces:**
- Consumes: immutable security context from Task 1 and durable tenant ownership.
- Produces: tenant-scoped repository/runtime operations that reject identifier-only cross-tenant access.

- [ ] **Step 1: Write failing integration tests** for S01, S02, S03, S04 and S05: cross-tenant read, mutation, worker tenant substitution, recovery claim, and outbox publication all fail closed without state/side-effect changes.
- [ ] **Step 2: Run the focused integration tests and verify RED.**
- [ ] **Step 3: Add tenant predicates and durable-owner checks** to existing queries/mutations; worker/recovery/outbox derive tenant from durable records instead of caller reassignment.
- [ ] **Step 4: Re-run focused integration tests and verify GREEN.**
- [ ] **Step 5: Run existing crash/recovery/fencing tests** to prove tenant checks do not weaken ownership/fencing semantics.
- [ ] **Step 6: Commit** with `feat(stage12.5): enforce tenant isolation on durable paths`.

---

## Task 3: Verify least-privilege authorization and Tool Permission fail-closed behavior

**Files:**
- Modify existing authorization/Tool Permission helpers and composition-root guards only where required.
- Test: authorization and tool-permission security regression tests.

**Interfaces:**
- Consumes: security context, existing Tool Permission and operation authorization.
- Produces: explicit fail-closed authorization for API, Worker, Recovery, Outbox, and tool execution.

- [ ] **Step 1: Write failing tests** for S06 and S16 plus component-boundary cases: missing/invalid permission rejects; API cannot invoke worker/recovery-only capability; outbox cannot mutate unrelated business state; missing security context rejects.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement minimum authorization guards** at existing composition-root and capability boundaries; do not add a second policy engine.
- [ ] **Step 4: Re-run focused tests and verify GREEN.**
- [ ] **Step 5: Run existing operational-control authorization tests** for regression.
- [ ] **Step 6: Commit** with `feat(stage12.5): harden least-privilege authorization`.

---

## Task 4: Make logging, errors, audit, telemetry, and durable payloads secret-safe

**Files:**
- Modify existing observability/audit serialization helpers and runtime error serialization.
- Test: sensitive-data regression tests.

**Interfaces:**
- Consumes: application/runtime values and security classification.
- Produces: allow-listed telemetry attributes and redacted error/audit/event/checkpoint representations that cannot persist known secret-shaped data.

- [ ] **Step 1: Write failing tests** for S07, S08 and S12: a deterministic secret is absent from error serialization/log attributes/telemetry; secret-bearing audit/event/checkpoint payloads are rejected or redacted; prompts/completions/tool secret content is excluded from telemetry.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement one centralized safe-attribute/redaction boundary** and route existing security-sensitive serialization through it; prefer allow-listing safe fields over scattered redaction.
- [ ] **Step 4: Re-run focused tests and verify GREEN.**
- [ ] **Step 5: Run existing observability and audit tests** including Stage 12.1/12.3 sensitive-data invariants.
- [ ] **Step 6: Commit** with `feat(stage12.5): prevent sensitive data leakage`.

---

## Task 5: Define retention and authorized purge boundary

**Files:**
- Modify existing audit/runtime data-management boundary only if one already exists.
- Test: retention/purge security integration tests.

**Interfaces:**
- Consumes: tenant security context and data classification.
- Produces: tenant-scoped, authorized, idempotent purge operation with audit evidence; correctness-critical state is protected from premature deletion.

- [ ] **Step 1: Write failing tests** for S13 and S14: protected correctness/audit data cannot be prematurely purged; unauthorized or cross-tenant purge is rejected; repeated authorized purge is idempotent; purge action itself is auditable without exposing purged content.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement the smallest retention/purge boundary** consistent with existing lifecycle tables and audit model; do not create a second archival store.
- [ ] **Step 4: Re-run focused tests and verify GREEN.**
- [ ] **Step 5: Run audit/transaction/idempotency regression tests.**
- [ ] **Step 6: Commit** with `feat(stage12.5): enforce retention and purge boundaries`.

---

## Task 6: Add security regression benchmark and CI gate

**Files:**
- Create/modify `packages/benchmark/src/security-regression-benchmark.ts`.
- Test: `packages/benchmark/src/security-regression-benchmark.test.ts` and/or repository-standard security test location.
- Modify `.github/workflows/ci.yml`.

**Interfaces:**
- Consumes: the security controls from Tasks 1–5 and existing four-adapter benchmark contract.
- Produces: deterministic S01–S16 security regression results and a CI hard gate.

- [ ] **Step 1: Write failing benchmark tests** asserting all 16 required scenarios are represented and each scenario records pass/fail without arbitrary sensitive payloads.
- [ ] **Step 2: Run benchmark tests and verify RED.**
- [ ] **Step 3: Implement deterministic S01–S16 benchmark cases** reusing real runtime/application boundaries where practical and unit-level helpers only where appropriate.
- [ ] **Step 4: Re-run benchmark tests and verify GREEN.**
- [ ] **Step 5: Add the Security Regression gate to CI** without weakening the existing 64-case benchmark gate.
- [ ] **Step 6: Run the benchmark and CI-equivalent command locally where available; verify GREEN.**
- [ ] **Step 7: Commit** with `test(stage12.5): add security regression gate`.

---

## Task 7: Full Stage 12.5 verification and implementation closeout

**Files:**
- Modify `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` only after implementation acceptance is complete.
- Create `docs/superpowers/plans/2026-09-15-stage12-5-closeout.md` during documentation closeout.

**Interfaces:**
- Consumes: all implementation tasks and CI evidence.
- Produces: exact branch/PR/merge/mainline evidence and Stage 12.5 completion record.

- [ ] **Step 1: Run Typecheck and API Build.**
- [ ] **Step 2: Run the complete Full Test suite.**
- [ ] **Step 3: Run the unchanged 64-case adapter benchmark and verify all cases remain green.**
- [ ] **Step 4: Run all security regression cases S01–S16.**
- [ ] **Step 5: Run crash/recovery/fencing regressions and Compose Smoke.**
- [ ] **Step 6: Verify sensitive-data regression output contains no secret/prompt/completion material.**
- [ ] **Step 7: Confirm exact implementation branch HEAD CI is GREEN.**
- [ ] **Step 8: Open the PR from the dedicated Stage 12.5 feature branch and keep it Draft until all required branch-head gates are green.**
- [ ] **Step 9: Merge only after branch-head verification is green.**
- [ ] **Step 10: Verify mainline CI against the exact merge SHA.**
- [ ] **Step 11: Create the Stage 12.5 closeout documentation from the exact merge SHA, recording branch, PR, merge SHA, and authoritative mainline run.**
- [ ] **Step 12: Advance the master plan to Stage 12.6 only after documentation closeout itself passes CI.**
- [ ] **Step 13: Commit documentation closure with `docs(stage12.5): close security hardening stage`.**

## Acceptance Matrix

| Gate | Required result |
|---|---|
| Typecheck | PASS |
| API Build | PASS |
| Full Test | PASS |
| Existing 64-case benchmark | PASS; semantics unchanged |
| Security Regression S01–S16 | PASS |
| Crash/Recovery/Fencing | PASS |
| Compose Smoke | PASS |
| Sensitive-data regression | PASS; no secret/prompt/completion leakage |
| Branch-head CI | GREEN on exact implementation HEAD |
| Mainline CI | GREEN on exact merge SHA |
| Documentation closeout CI | GREEN before Stage 12.6 |

## Spec Coverage Review

- Secret handling → Tasks 4 and 7.
- Tenant isolation → Task 2.
- Least privilege → Task 3.
- Retention/sensitive data → Tasks 4–5.
- S01–S16 regression suite → Tasks 2–6.
- CI/acceptance gates → Tasks 6–7.
- Non-goals/architecture constraints → Global Constraints and every task's interfaces.

## Transition Rule

Implementation starts from verified `main` at `24b2bc26a75d4e46cce1038704c27c9b5e3e0f00` and uses a dedicated Stage 12.5 feature branch. No Stage 12.6 work begins until Stage 12.5 exact merge-SHA verification and documentation closeout are complete.
