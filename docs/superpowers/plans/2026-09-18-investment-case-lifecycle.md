# Investment Case Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 InvestmentCase 作为“一个可持续推进的投资项目生命周期”的业务聚合，并完成从 Opportunity 晋级、Research/Analysis、Runtime WAITING/Resume、Decision 关联到 Crash Recovery 的可验证业务纵向切片。

**Architecture:** 在现有 `packages/investment-domain/src/` 边界内新增 Case 的 domain/application/persistence/workflow 四层实现。Domain 只包含生命周期规则；Application 负责 command、permission/idempotency、UoW 与 workflow port；Persistence 将 Case/Task/Event 与现有 Audit/Outbox/Idempotency 接入同一 PostgreSQL transaction；Workflow 只调用 Runtime contract。API 通过 composition root 调用 Application/Workflow，绝不让 Case 直接依赖 PostgreSQL、Redis 或具体 Agent Framework。

**Tech Stack:** TypeScript, pnpm, Vitest, PostgreSQL, existing `@agent-native/runtime` and `@agent-native/runtime-contract` contracts.

**Spec:** `docs/superpowers/specs/2026-09-18-investment-case-lifecycle-design.md`

## Global Constraints

- InvestmentCase statuses are exactly `DRAFT`, `RESEARCHING`, `ANALYZING`, `DECISION_PENDING`, `APPROVED`, `REJECTED`, `ON_HOLD`.
- Runtime statuses remain exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`; Case.status must never use `WAITING`.
- Domain -> platform contracts only; Application -> Domain + ports; Persistence -> Application ports + Domain; Workflow -> Application workflow port + runtime contract; API -> Application / Workflow through composition root.
- InvestmentCase must not directly depend on PostgreSQL, Redis, or a specific Agent Framework.
- A successful Case mutation commits Case state + Domain Event + Audit + Outbox in one PostgreSQL transaction; any failure rolls the transaction back.
- Redis is delivery/scheduling only and is never the source of truth for Case, Task, Event, Audit, or Outbox.
- All mutations are fail-closed on permission before durable idempotency before domain mutation.
- Optimistic concurrency uses expected Case version; mismatch returns `Conflict`.
- Technical Run `FAILED` does not automatically produce investment `REJECTED`.
- Same tenant + opportunity has at most one InvestmentCase.
- Existing Runtime FSM and the existing platform 64-case benchmark hard gate remain unchanged.

---

### Task 1: Establish Case Domain Model and RED Tests

**Files:**
- Create: `packages/investment-domain/src/domain/investment-case.ts`
- Create: `packages/investment-domain/src/domain/investment-case-events.ts`
- Test: `packages/investment-domain/src/domain/investment-case.test.ts`

**Interfaces:**
- Produces `InvestmentCase`, `InvestmentCaseStatus`, `InvestmentCaseTaskStatus`, factory and transition methods consumed by Tasks 2-5.
- Domain transition methods must expose explicit invalid-transition errors and preserve `previousStatus` for ON_HOLD.

- [ ] **Step 1: Write failing lifecycle tests** for creation, DRAFT→RESEARCHING, RESEARCHING→ANALYZING, ANALYZING→DECISION_PENDING, DECISION_PENDING→APPROVED/REJECTED, terminal-state rejection, ON_HOLD round-trip, tenant/opportunity validation, version increment, and technical failure not changing business state.
- [ ] **Step 2: Run the focused test** with `pnpm vitest run packages/investment-domain/src/domain/investment-case.test.ts`; expected initial failure because the Case module does not exist.
- [ ] **Step 3: Implement the minimum domain model** with exact statuses and transition invariants; use pure functions and no persistence/runtime imports.
- [ ] **Step 4: Add durable event payload types** for `InvestmentCaseCreated`, `InvestmentCaseStatusChanged`, `InvestmentCaseDecisionAttached`, and task lifecycle events without introducing persistence concerns.
- [ ] **Step 5: Run focused tests** and typecheck; expected PASS.
- [ ] **Step 6: Commit** `feat: add investment case domain lifecycle`.

### Task 2: Add Application Ports, Commands, and UoW Contracts

**Files:**
- Create: `packages/investment-domain/src/application/case-commands.ts`
- Create: `packages/investment-domain/src/application/case-queries.ts`
- Create: `packages/investment-domain/src/application/case-repositories.ts`
- Create: `packages/investment-domain/src/application/case-event-store.ts`
- Create: `packages/investment-domain/src/application/case-unit-of-work.ts`
- Create: `packages/investment-domain/src/application/case-workflow-port.ts`
- Modify: `packages/investment-domain/src/application/unit-of-work.ts`

**Interfaces:**
- Produces the exact commands `CreateInvestmentCase`, `StartResearch`, `CompleteResearch`, `StartAnalysis`, `CompleteAnalysis`, `PutCaseOnHold`, `ResumeCase`, `AttachInvestmentDecision`.
- Repository exposes `getById(tenantId, caseId)`, `getByOpportunityId(tenantId, opportunityId)`, `create(case)`, `save(case, expectedVersion)`.
- Workflow port exposes `startResearch(tenantId, caseId, taskId, idempotencyKey): Promise<{runId:string}>`, `startAnalysis(...): Promise<{runId:string}>`, and `resume(tenantId, caseId, taskId, runId, input, idempotencyKey): Promise<{runId:string}>`.
- UoW context exposes Case repository, Case task repository, Case event store, existing opportunities/decisions, transactional audit, and SQL transaction context.

- [ ] **Step 1: Write contract tests** asserting command shape, repository signatures, UoW composition, and workflow-port signatures.
- [ ] **Step 2: Run focused type tests**; expected failure for missing Case contracts.
- [ ] **Step 3: Implement the minimal interfaces and command types** with `expectedVersion` on mutable Case commands and `idempotencyKey` on every mutation.
- [ ] **Step 4: Run package typecheck** with `pnpm typecheck`; expected PASS.
- [ ] **Step 5: Commit** `feat: add investment case application contracts`.

### Task 3: Implement PostgreSQL Case, Task, Event Persistence

**Files:**
- Create: `packages/investment-domain/src/persistence/postgres-case-repositories.ts`
- Create: `packages/investment-domain/src/persistence/postgres-case-event-store.ts`
- Create: `packages/investment-domain/src/persistence/postgres-case-unit-of-work.ts`
- Modify: `packages/investment-domain/src/persistence/schema.sql`
- Test: `packages/investment-domain/src/persistence/postgres-case-repositories.test.ts`
- Test: `packages/investment-domain/src/persistence/postgres-case-event-store.test.ts`
- Test: `packages/investment-domain/src/persistence/postgres-case-unit-of-work.test.ts`

**Interfaces:**
- Produces concrete repositories for `investment_cases`, `investment_case_events`, and `investment_case_tasks`.
- `save(case, expectedVersion)` must update only when tenant/case/version match and must throw the existing application-level `Conflict` error on zero rows.
- Case event append must enforce one event per aggregate version and write the corresponding workflow Outbox record in the same transaction.
- Postgres UoW must construct Case repositories and retain existing opportunity/decision repositories and transactional audit.

- [ ] **Step 1: Write failing SQL/repository tests** for Case CRUD, tenant isolation, unique tenant+opportunity, version conflict, task persistence, event aggregate-version uniqueness, and UoW rollback behavior.
- [ ] **Step 2: Run the focused persistence tests**; expected failure because tables and repositories are absent.
- [ ] **Step 3: Add `investment_cases`, `investment_case_events`, and `investment_case_tasks` DDL** with the exact status checks, `version >= 1`, tenant+opportunity uniqueness, aggregate-version uniqueness, and foreign key to the existing Opportunity.
- [ ] **Step 4: Implement row mapping and repository methods** using parameterized SQL only.
- [ ] **Step 5: Implement Case event store** so event + outbox insertion is atomic through the passed transaction.
- [ ] **Step 6: Implement the Case UoW** by extending the existing transaction composition pattern without moving business logic into persistence.
- [ ] **Step 7: Run focused persistence tests and `pnpm typecheck`; expected PASS.
- [ ] **Step 8: Commit** `feat: persist investment cases and tasks`.

### Task 4: Implement Application Service with Permission, Idempotency, and Concurrency Semantics

**Files:**
- Create: `packages/investment-domain/src/application/case-application-service.ts`
- Create: `packages/investment-domain/src/application/case-errors.ts`
- Create: `packages/investment-domain/src/application/case-idempotency.ts`
- Test: `packages/investment-domain/src/application/case-application-service.test.ts`

**Interfaces:**
- Produces a Case application service whose public mutations are the eight commands in Task 2.
- Error classes are `NotFound`, `Conflict`, `InvalidTransition`, `DuplicateIdempotencyKey`, `PermissionDenied`, and `ValidationError`.
- Every mutation executes in order: fail-closed permission check -> durable idempotency lookup -> domain mutation -> transactionally persisted Case/Event/Audit/Outbox.
- Idempotent replay returns the original logical result; conflicting reuse of the same key is rejected.

- [ ] **Step 1: Write RED tests** for create, duplicate tenant+opportunity, cross-tenant permission denial, every lifecycle transition, ON_HOLD/resume, decision association, same-key replay, same-key conflicting command, expected-version conflict, and transaction rollback when event/outbox persistence fails.
- [ ] **Step 2: Run the focused test** with `pnpm vitest run packages/investment-domain/src/application/case-application-service.test.ts`; expected failure because the service is absent.
- [ ] **Step 3: Implement fail-closed authorization at the application boundary** using the repository's existing permission contract; permission failure must return before Case mutation or workflow-triggering Outbox.
- [ ] **Step 4: Implement durable idempotency handling** so HTTP, Worker, Outbox, and Recovery retries converge on one logical result.
- [ ] **Step 5: Implement create/start/complete/hold/resume/decision commands** with expected-version checks and one UoW transaction per successful mutation.
- [ ] **Step 6: Ensure technical Run `FAILED` only changes Task failure state and does not transition Case to `REJECTED`.
- [ ] **Step 7: Run focused tests and package typecheck; expected PASS.
- [ ] **Step 8: Commit** `feat: add investment case application service`.

### Task 5: Implement Case Workflow and Runtime WAITING/Resume Contract

**Files:**
- Create: `packages/investment-domain/src/workflow/case-workflow.ts`
- Modify: `packages/investment-domain/src/persistence/postgres-workflow-runtime.ts`
- Test: `packages/investment-domain/src/workflow/case-workflow.test.ts`
- Test: `packages/investment-domain/src/persistence/postgres-workflow-runtime.test.ts`

**Interfaces:**
- Produces `CaseWorkflow` implementing the application `CaseWorkflowPort`.
- Research/analysis start creates or resumes the technical Run through `InvestmentWorkflowRuntime`; Case business state remains owned by Application.
- Resume accepts durable Case/Task/Run identifiers and delegates to the same logical Runtime Run; it never writes Redis directly.

- [ ] **Step 1: Write RED workflow tests** for research start, analysis start, same-run resume, WAITING state preservation, and no duplicate task/event side effect on idempotent resume.
- [ ] **Step 2: Run focused workflow tests**; expected failure because CaseWorkflow is absent.
- [ ] **Step 3: Implement the CaseWorkflow adapter** against the application workflow port and existing RuntimeFacade contract.
- [ ] **Step 4: Update the existing Postgres investment runtime metadata from opportunity-only context to Case + task context without changing Runtime FSM semantics.
- [ ] **Step 5: Add tests proving Runtime `WAITING` leaves Case `RESEARCHING` and that resume is durable and same-run.
- [ ] **Step 6: Run focused workflow/runtime tests and typecheck; expected PASS.
- [ ] **Step 7: Commit** `feat: add investment case workflow integration`.

### Task 6: Add Case E2E Harness and Ten Acceptance Scenarios

**Files:**
- Create: `tests/e2e/investment/investment-case-lifecycle.test.ts`
- Create: `packages/benchmark/src/cases/investment/investment-case-lifecycle.ts`
- Modify: `packages/benchmark/src/cases/investment/index.ts`
- Modify: `packages/benchmark/src/suites/investment-suite.ts`

**Interfaces:**
- Produces ten executable acceptance scenarios corresponding exactly to E2E-01 through E2E-10.
- E2E harness uses the existing PostgreSQL/runtime test fixtures and asserts durable state directly.
- Investment benchmark cases remain separate from the existing platform 64-case hard gate; no B01-B64 semantic is changed.

- [ ] **Step 1: Write RED E2E tests** for all ten acceptance criteria, including tenant isolation, idempotency, optimistic concurrency, WAITING/resume, and worker crash/delivery-state loss.
- [ ] **Step 2: Run the focused E2E file**; expected failures identify missing wiring only, not changes to existing platform benchmarks.
- [ ] **Step 3: Implement test fixtures and deterministic mock Runtime/Workflow adapter** for Research WAITING and SUCCEEDED paths.
- [ ] **Step 4: Implement the ten assertions against PostgreSQL Case/Task/Event/Audit/Outbox and Runtime Run state.
- [ ] **Step 5: Run the Investment Case E2E suite and existing investment suite; expected PASS.
- [ ] **Step 6: Commit** `test: add investment case lifecycle e2e coverage`.

### Task 7: Add Architecture Guards and Public Exports

**Files:**
- Modify: `packages/investment-domain/src/index.ts` or the repository's current package export entrypoint if absent on main.
- Modify: existing repository-boundary architecture guard test(s).
- Test: new/updated architecture guard tests.

**Interfaces:**
- Exposes only the intended Application/Domain contracts needed by composition roots.
- Guards reject Domain imports of persistence/runtime implementations, Benchmark framework/platform imports of Investment implementation modules, and legacy root implementation paths.
- No compatibility shims for old Investment Case paths are introduced.

- [ ] **Step 1: Write RED architecture/export tests** for the exact dependency direction and public Case exports.
- [ ] **Step 2: Run the focused guard tests; expected failure for missing exports/guards.
- [ ] **Step 3: Add minimal exports and guards.
- [ ] **Step 4: Run architecture guard tests; expected PASS.
- [ ] **Step 5: Commit** `test: enforce investment case boundaries`.

### Task 8: Full Verification, Documentation, and Mainline Closeout

**Files:**
- Modify: `README.md` only if current lifecycle/status text is stale.
- Modify: `docs/architecture/repository-structure.md` only if Case ownership is not already represented.
- Modify: `docs/superpowers/specs/2026-09-18-investment-case-lifecycle-design.md` only for implementation-status closeout.
- Modify: `docs/superpowers/plans/2026-09-18-investment-case-lifecycle.md` to check completed tasks.

- [ ] **Step 1: Run the complete test suite** with `pnpm test`; expected PASS.
- [ ] **Step 2: Run `pnpm typecheck`; expected PASS.
- [ ] **Step 3: Run the existing platform 64-case benchmark hard gate unchanged.
- [ ] **Step 4: Run the new Investment Case E2E/benchmark suite.
- [ ] **Step 5: Run repository architecture guards and verify no legacy compatibility paths were introduced.
- [ ] **Step 6: Review the final diff for unchanged Runtime FSM semantics and transaction coupling.
- [ ] **Step 7: Update documentation/status only after code verification is green.
- [ ] **Step 8: Commit documentation closeout.
- [ ] **Step 9: Open PR from the implementation branch, wait for CI, and use the CI run as authoritative verification before merge.
- [ ] **Step 10: After merge, poll mainline CI and record the final merge SHA/run in the closeout docs.
