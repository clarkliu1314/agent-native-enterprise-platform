# Vercel Deployment Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Vercel-facing application boundary that remains stateless and framework-neutral while durable execution, recovery, and outbox ownership remain in the platform worker.

**Architecture:** Add a small platform-owned deployment boundary package containing environment validation, a provider-agnostic LLM gateway interface, and a request-facing application service. The boundary exposes only request-safe operations and delegates durable work to existing platform services; it never imports the recovery worker loop or owns leases/outbox publication. No concrete LLM provider or fake production API is introduced.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, existing runtime/tool/durability packages, Vercel-compatible Node request boundary, PostgreSQL/Redis configuration via environment variables.

**Spec:** `docs/superpowers/specs/2026-09-11-vercel-deployment-boundary-design.md`

## Current status

**Complete for the current architecture.** Run #184 passed the original boundary implementation; Run #189 passed the revised CI with explicit API typecheck/build, deployment-boundary tests, full tests, and Compose smoke/configuration. The remaining unchecked item is deliberately a future composition-root integration: the repository must not fabricate a durable runtime constructor merely to make Vercel deployable.

## Global Constraints

- Vercel is a stateless application/request boundary only.
- Durable execution, recovery/retry, and outbox publication remain independently deployable worker responsibilities.
- PostgreSQL remains the durable source of truth; Redis is optional coordination/queue infrastructure.
- The application-facing contract remains framework-neutral.
- LLM access is provider-agnostic; provider credentials are deployment configuration and never run-state data.
- Missing required deployment configuration fails closed.
- No production provider, fake API, or worker implementation is introduced solely for deployment validation.
- No existing permission, idempotency, outbox, or recovery semantics are duplicated.
- Every production implementation change begins with a failing test.

## File Map

- Create `packages/deployment-boundary/package.json`: workspace package metadata and dependencies for the Vercel-facing boundary.
- Create `packages/deployment-boundary/src/config.ts`: required/optional environment parsing and fail-closed validation.
- Create `packages/deployment-boundary/src/llm-gateway.ts`: provider-agnostic model invocation interface and request/result types.
- Create `packages/deployment-boundary/src/application.ts`: request-safe application service that delegates to `AgentRuntime` and optional LLM gateway without importing worker-only code.
- Create `packages/deployment-boundary/src/index.ts`: public boundary exports.
- Create `packages/deployment-boundary/src/config.test.ts`: environment contract tests.
- Create `packages/deployment-boundary/src/application.test.ts`: delegation and worker-boundary tests.
- Create `packages/deployment-boundary/src/llm-gateway.test.ts`: provider-neutral gateway contract tests.
- Create `apps/api/package.json`: Vercel-compatible request application package.
- Create `apps/api/src/handler.ts`: thin request handler using deployment-boundary application service.
- Create `apps/api/src/handler.test.ts`: request/response contract tests.
- Create `apps/api/src/deployment-boundary.test.ts`: static worker-boundary safety test.
- Create `apps/api/src/build-contract.test.ts`: API typecheck/build script contract.
- Create `apps/api/vercel.json`: explicit Vercel runtime/build boundary without worker deployment.
- Modify `.github/workflows/ci.yml`: add API typecheck/build and deployment-boundary contract verification.
- Modify `README.md`: document local Compose versus Vercel topology, configuration, and failure semantics.
- Create `docs/architecture/vercel-deployment-boundary.md`: deployment boundary topology and ownership documentation.
- Modify `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`: mark Task 9 progress and verification status.

### Task 1: Deployment-boundary package contract

- [x] Write failing configuration tests.
- [x] Run the focused tests and confirm RED before implementation.
- [x] Write provider-neutral gateway tests.
- [x] Write application boundary tests.
- [x] Implement the package contract and verify the focused suite passes.

### Task 2: Implement deployment-boundary contracts

- [x] Implement fail-closed deployment configuration parsing.
- [x] Implement the provider-neutral LLM gateway interface.
- [x] Implement request-safe application delegation to `AgentRuntime`.
- [x] Verify package tests and repository typecheck pass in Run #184.

### Task 3: Vercel-compatible API entrypoint

- [x] Write request/response contract tests and verify the missing-handler RED state.
- [x] Implement the thin stateless API handler with dependency injection rather than inventing an unsafe runtime constructor.
- [x] Add explicit Node 22 Vercel configuration without worker deployment.
- [x] Verify API handler behavior in Run #184.
- [ ] Add/verify an actual production runtime composition only when the durable runtime/repository composition is available; do not fabricate one in this boundary task.

### Task 4: Deployment-boundary static safety contract

- [x] Add source-level prohibition of recovery worker/store/outbox publisher dependencies.
- [x] Verify public deployment-boundary operations remain request-safe.
- [x] Run package/API boundary tests successfully in Run #184 and again in Run #189.

### Task 5: Local topology and documentation

- [x] Document local worker ownership and Vercel request-boundary ownership.
- [x] Document configuration, secrets, timeout/crash, durable async handoff, recovery, and duplicate-delivery semantics.
- [x] Validate existing Compose topology in Run #184 and Run #189.
- [ ] Add a runnable API service to Compose only after a real durable runtime composition exists; current architecture intentionally avoids a fake API runtime.

### Task 6: CI verification and plan status

- [x] Add deployment-boundary tests to CI.
- [x] Add an explicit API build contract test.
- [x] Add independent API typecheck/build commands to the CI workflow.
- [x] Verify the revised CI workflow with API typecheck/build passes (Run #189).
- [x] Verify focused tests, full tests, repository typecheck, API typecheck/build, and Compose validation/smoke in Run #189.
- [x] Close this implementation plan with exact verification evidence.

## Verification evidence

- Run #184 — CI success for the initial Vercel boundary revision.
- Run #189 — CI success for commit `b11930d5926263445787cdd81eb2bcb776913763`; test job passed repository typecheck, API typecheck, API build, deployment-boundary tests, and full test suite; Compose job passed configuration, startup, benchmark/worker/migration exit assertions, and teardown.
- Subsequent documentation-only status commits are not treated as additional runtime verification claims.
