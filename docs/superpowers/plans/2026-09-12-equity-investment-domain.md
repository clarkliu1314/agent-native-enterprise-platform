# Equity Investment Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal but complete equity-investment vertical slice on top of the existing durable runtime, proving durable business state, agent workflow, human approval, idempotency, recovery, auditability, and transactional outbox behavior.

**Architecture:** The investment domain owns business aggregates and commands; the durable runtime owns agent execution and recovery. Business writes flow through an application service into PostgreSQL transactions that atomically persist business state, business events, and outbox records. Agent frameworks remain adapters behind the runtime contract.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, PostgreSQL, existing `@agent-native/runtime-contract`, existing durable runtime/tool-permission/idempotency/outbox packages.

**Spec:** `docs/superpowers/specs/2026-09-12-equity-investment-domain-design.md`

## Global Constraints

- PostgreSQL is the durable system of record.
- Application code depends on `@agent-native/runtime-contract`, never framework-specific runtime semantics.
- Every externally effectful tool call is authorized by policy and protected by idempotency.
- State transitions and outbox insertion have explicit transaction boundaries.
- Recovery re-enters Permission -> Idempotency -> Tool Execution -> Outbox.
- Outbox transport is at-least-once; consumers are idempotent.
- Use TDD: failing test, RED, minimal implementation, GREEN, then refactor.
- Never weaken an existing safety invariant to make a test pass.
- Do not introduce an in-memory candidate registry as a substitute for PostgreSQL state.
- Do not claim completion without verification output.

---

### Task 1: Domain model and lifecycle invariants

**Files:**
- Create: `packages/investment-domain/src/opportunity.ts`
- Create: `packages/investment-domain/src/investment-decision.ts`
- Create: `packages/investment-domain/src/commands.ts`
- Create: `packages/investment-domain/src/events.ts`
- Test: `packages/investment-domain/src/opportunity.test.ts`
- Test: `packages/investment-domain/src/investment-decision.test.ts`

**Interfaces:**
- Produces immutable domain types and pure transition/validation functions.
- `advanceOpportunityStage(opportunity, nextStage): InvestmentOpportunity`
- `createInvestmentDecision(input): InvestmentDecision`
- `decisionIdempotencyKey(opportunityId, decisionCycle): string`

- [ ] **Step 1: Write failing lifecycle tests**

Test `DRAFT -> SCREENING -> DUE_DILIGENCE -> IC_REVIEW`, reject illegal skips, and reject changes after `APPROVED` or `REJECTED`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run packages/investment-domain/src/opportunity.test.ts packages/investment-domain/src/investment-decision.test.ts`
Expected: FAIL because the package and domain functions do not exist.

- [ ] **Step 3: Implement the minimal pure domain model**

Use discriminated unions for lifecycle stages/status and immutable objects. Keep persistence and runtime imports out of these files.

- [ ] **Step 4: Add decision uniqueness/idempotency semantics**

Make the decision input include `opportunityId`, `decisionCycle`, `outcome`, `rationale`, and actor context. Derive one stable business idempotency key per opportunity/decision cycle.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: all domain tests PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: establish investment domain invariants"`

### Task 2: PostgreSQL business persistence

**Files:**
- Create: `packages/investment-domain/src/schema.sql`
- Create: `packages/investment-domain/src/repositories.ts`
- Create: `packages/investment-domain/src/postgres-repositories.ts`
- Test: `packages/investment-domain/src/postgres-repositories.test.ts`
- Modify: repository package/workspace metadata only if required to expose the new package

**Interfaces:**
- `InvestmentOpportunityRepository.get(opportunityId): Promise<InvestmentOpportunity | null>`
- `InvestmentOpportunityRepository.save(opportunity, expectedVersion): Promise<void>`
- `InvestmentDecisionRepository.getByIdempotencyKey(key): Promise<InvestmentDecision | null>`
- `InvestmentDecisionRepository.create(decision, idempotencyKey): Promise<InvestmentDecision>`

- [ ] **Step 1: Write SQL contract tests first**

Assert required tables, primary keys, opportunity versioning, decision uniqueness, tenant scoping, and indexes for business idempotency.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/investment-domain/src/postgres-repositories.test.ts`
Expected: FAIL because the schema/repositories do not exist.

- [ ] **Step 3: Implement the minimal PostgreSQL schema**

Create `investment_opportunities` and `investment_decisions`. Enforce decision uniqueness with a database constraint on `(tenant_id, opportunity_id, decision_cycle)` and persist a unique business idempotency key.

- [ ] **Step 4: Implement repositories using explicit transactions**

Opportunity writes must use optimistic version checks. Decision creation must replay an existing idempotent result and reject a conflicting payload hash.

- [ ] **Step 5: Add PostgreSQL assertions for duplicate decision creation**

Attempt the same decision twice and verify one row. Attempt the same idempotency key with a different command hash and verify rejection.

- [ ] **Step 6: Run focused integration tests and verify GREEN**

Run the package persistence tests against the repository's PostgreSQL test environment. Expected: schema and repository assertions PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat: add durable investment persistence"`

### Task 3: Business event and transactional outbox boundary

**Files:**
- Create: `packages/investment-domain/src/application-service.ts`
- Create: `packages/investment-domain/src/event-store.ts`
- Test: `packages/investment-domain/src/application-service.test.ts`
- Test: `packages/investment-domain/src/transactional-boundary.integration.test.ts`

**Interfaces:**
- `InvestmentApplicationService.createOpportunity(command): Promise<InvestmentOpportunity>`
- `InvestmentApplicationService.advanceStage(command): Promise<InvestmentOpportunity>`
- `InvestmentApplicationService.approve(command): Promise<InvestmentDecision>`
- `InvestmentApplicationService.reject(command): Promise<InvestmentDecision>`

- [ ] **Step 1: Write failing command tests**

Verify valid commands produce state changes and domain events; invalid transitions produce neither.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/investment-domain/src/application-service.test.ts`
Expected: FAIL because the application service does not exist.

- [ ] **Step 3: Implement command orchestration**

Load aggregate, validate pure domain transition, persist the new version, append business event, and create the outbox record in the same database transaction.

- [ ] **Step 4: Add transaction rollback test**

Force outbox insertion to fail and verify that the opportunity/decision mutation is also rolled back.

- [ ] **Step 5: Verify business idempotency**

Repeat approval with the same key and verify the original decision is returned without a second business event or decision row.

- [ ] **Step 6: Run focused integration tests and verify GREEN**

Run the application-service unit tests plus transactional PostgreSQL tests. Expected: PASS with SQL row-count assertions.

- [ ] **Step 7: Commit**

`git commit -m "feat: add transactional investment commands"`

### Task 4: Investment tools and policy boundary

**Files:**
- Create: `packages/investment-domain/src/tools.ts`
- Create: `packages/investment-domain/src/policies.ts`
- Test: `packages/investment-domain/src/tools.test.ts`

**Interfaces:**
- `company.lookup(input): Promise<CompanySnapshot>`
- `company.financials(input): Promise<FinancialSnapshot>`
- `due_diligence.run(input): Promise<DueDiligenceReport>`
- `investment_analysis.generate(input): Promise<InvestmentAnalysis>`
- `ic.recommend(input): Promise<IcRecommendation>`
- side-effecting commands delegate to `InvestmentApplicationService`, never directly to SQL.

- [ ] **Step 1: Write failing permission/idempotency tests**

Verify read-only analysis tools do not mutate business state, while stage/decision tools require explicit authorization and preserve stable idempotency keys.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run packages/investment-domain/src/tools.test.ts`
Expected: FAIL because tool contracts do not exist.

- [ ] **Step 3: Implement deterministic mock tools**

Keep external data behind interfaces. The initial slice uses deterministic fixtures so recovery tests are reproducible.

- [ ] **Step 4: Implement policy mapping**

Map tool names to permission requirements and classify `opportunity.advance_stage` and `investment_decision.create` as side-effecting.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: all tool/policy tests PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: add investment tool policy boundary"`

### Task 5: Durable Agent workflow integration

**Files:**
- Create: `packages/investment-domain/src/workflow.ts`
- Create: `packages/investment-domain/src/runtime-port.ts`
- Test: `packages/investment-domain/src/workflow.test.ts`

**Interfaces:**
- `InvestmentWorkflow.start(input): Promise<{ runId: string; opportunityId: string }>`
- `InvestmentWorkflow.resume(runId): Promise<void>`
- Runtime dependency is expressed through the existing framework-neutral runtime contract/port.

- [ ] **Step 1: Write failing workflow contract tests**

Assert the workflow starts one durable run, executes research -> diligence -> analysis -> recommendation, then creates a durable approval wait instead of keeping approval state in memory.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/investment-domain/src/workflow.test.ts`
Expected: FAIL because workflow/runtime port does not exist.

- [ ] **Step 3: Implement the workflow using the runtime boundary**

The workflow may read and analyze, but all business writes call the application service. Do not import AgentScope/LangGraph/Eino/Mastra APIs.

- [ ] **Step 4: Verify WAITING and resume semantics**

A restarted process must discover the durable wait and resume the same run/opportunity.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: workflow contract tests PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: integrate investment workflow with durable runtime"`

### Task 6: End-to-end recovery and duplicate-side-effect hard gate

**Files:**
- Create: `tests/investment-domain.e2e.test.ts`
- Create: `tests/investment-domain.recovery.e2e.test.ts`

**Interfaces:**
- Exercise the public application/workflow boundary; do not reach into implementation-private functions for assertions.

- [ ] **Step 1: Write failing E2E scenarios**

Cover crashes before research, during due diligence, after recommendation, around WAITING, after approval, before outbox publish, duplicate outbox delivery, and expired worker lease.

- [ ] **Step 2: Run the new E2E suite and verify RED**

Run: `pnpm vitest run tests/investment-domain.e2e.test.ts tests/investment-domain.recovery.e2e.test.ts`
Expected: failures identify missing business workflow/recovery behavior.

- [ ] **Step 3: Implement only the missing integration behavior**

Use existing recovery, fencing, idempotency, and outbox primitives. Do not add a second recovery mechanism inside the domain package.

- [ ] **Step 4: Add SQL invariants**

Assert exactly one opportunity decision, exactly one corresponding business event for the decision command, one outbox event per business idempotency key, and correct final opportunity status.

- [ ] **Step 5: Run E2E suite and verify GREEN**

Expected: every recovery scenario passes without duplicate business side effects.

- [ ] **Step 6: Commit**

`git commit -m "test: harden investment recovery workflow"`

### Task 7: Benchmark coverage and repository integration

**Files:**
- Create/Modify: `packages/benchmark/*` only for new Stage 10 benchmark cases
- Test: corresponding benchmark tests
- Modify: package exports/workspace metadata as required

**Interfaces:**
- Reuse the existing benchmark adapter/test conventions; do not create a parallel benchmark API.

- [ ] **Step 1: Add benchmark cases for decision idempotency, approval replay, crash recovery, and outbox duplication**

Each case must specify initial DB state, deterministic tools/LLM, operations, SQL assertions, expected result, and failure criteria.

- [ ] **Step 2: Run benchmark tests and verify RED where applicable**

Run the focused Stage 10 benchmark suite and verify new cases fail before their implementation is complete.

- [ ] **Step 3: Wire the cases to the existing benchmark harness**

Ensure all supported adapters exercise the same business contract where applicable.

- [ ] **Step 4: Run the focused benchmark suite and verify GREEN**

Expected: all Stage 10 cases pass without weakening the existing 64-case hard gate.

- [ ] **Step 5: Commit**

`git commit -m "test: benchmark investment durability invariants"`

### Task 8: Documentation, CI, and merge gate

**Files:**
- Modify: `docs/superpowers/plans/2026-09-12-equity-investment-domain.md`
- Modify: `docs/superpowers/plans/2026-09-12-durable-runtime-composition.md`
- Modify: stale overall plan only where needed to point at Stage 10 as active
- Modify: README/wiki only if the repository's existing documentation conventions require it

- [ ] **Step 1: Mark completed tasks with exact commit/CI evidence**

Do not mark a task complete from local intent; record the actual verification output.

- [ ] **Step 2: Run repository verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

Run persistence/recovery integration tests and the full benchmark matrix as required by the changed boundaries. Expected: PASS.

- [ ] **Step 3: Inspect GitHub Actions**

Require the authoritative branch-head CI to pass. Record the exact run number, commit SHA, and green jobs.

- [ ] **Step 4: Update documentation only after CI evidence exists**

The Stage 10 plan becomes the source of truth for the current business-domain implementation status.

- [ ] **Step 5: Commit documentation checkpoint**

`git commit -m "docs: record equity investment implementation gate"`
