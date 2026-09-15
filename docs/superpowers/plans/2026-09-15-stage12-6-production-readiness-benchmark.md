# Stage 12.6 Production Readiness Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a deterministic production-readiness benchmark that proves the Agent-native runtime is operationally ready without changing authoritative durability, transaction, recovery, security, or deployment semantics.

**Architecture:** Build the benchmark as a verification layer over the existing Runtime Contract, PostgreSQL durability model, worker/recovery/outbox boundaries, security controls, observability, and failure/SLO controls. Keep benchmark data deterministic and sanitized, expose one machine-readable result artifact, and make CI enforce the complete readiness contract.

**Tech Stack:** TypeScript, pnpm, Vitest, PostgreSQL, existing runtime/application packages, GitHub Actions, Docker Compose.

**Spec:** Stage 12.6 Production Readiness Benchmark design approved in the project conversation; existing Stage 12.5 security-hardening spec and closeout remain authoritative for security invariants.

## Baseline and invariants

- Start from the exact Stage 12.5 documentation closeout mainline SHA `5de2809de3cbd661a6e2c8de02f1215c6cc9e90d` only after its mainline CI is green.
- PostgreSQL remains the sole durable source of truth; Redis remains delivery/coordination infrastructure.
- RuntimeFacade remains the application boundary; Vercel remains stateless.
- Do not alter Run FSM, transaction boundaries, idempotency, checkpoint, lease, fencing, recovery, outbox, audit, observability, SLO, tenant-isolation, least-privilege, or sensitive-data semantics merely to satisfy the benchmark.
- Existing 64-case benchmark and S01-S16 security regression benchmark remain independent gates.

## File map

- `packages/benchmark/src/production-readiness-benchmark.test.ts` — deterministic P01-P16 readiness scenarios and JSON artifact generation.
- `packages/benchmark/src/production-readiness-benchmark.test.ts` tests the existing public runtime/application contracts rather than introducing production-only test hooks.
- `artifacts/production-readiness-results.json` — generated CI artifact; never contains secrets, prompts, completions, credentials, provider responses, or confidential business data.
- `.github/workflows/ci.yml` — production-readiness CI gate and artifact validation.
- `docs/superpowers/specs/2026-09-15-stage12-6-production-readiness-benchmark.md` — final executable benchmark contract.
- `docs/superpowers/plans/2026-09-15-stage12-6-production-readiness-benchmark.md` — this plan and task ledger.
- `docs/superpowers/closeouts/2026-09-15-stage12-6-production-readiness-closeout.md` — final evidence and closure record.
- Existing roadmap/master-plan document — updated only during closeout after all verification gates pass.

## Task 1 — Benchmark contract and deterministic harness

- [ ] Write failing tests defining P01-P04 result schema, deterministic case ordering, sanitized artifact shape, and baseline/runtime health expectations.
- [ ] Run the focused test and observe the intended failure.
- [ ] Implement the minimal benchmark harness and deterministic fixture/result model.
- [ ] Run focused tests, typecheck, and benchmark package tests.
- [ ] Self-review for deterministic inputs, no sensitive output, and no production semantic changes.
- [ ] Commit Task 1 and perform an independent spec/code review before proceeding.

## Task 2 — Durable execution and resilience benchmark

- [ ] Add failing tests for P05-P08: transaction boundary, idempotency, checkpoint, crash/recovery, lease/fencing, and outbox/delivery semantics using existing contracts.
- [ ] Run focused tests and confirm failure before implementation changes.
- [ ] Implement only benchmark fixtures/assertions required to exercise existing semantics.
- [ ] Run focused tests plus existing crash/recovery/fencing suites.
- [ ] Review for accidental weakening of durability semantics and deterministic cleanup.
- [ ] Commit Task 2 and independently review before proceeding.

## Task 3 — Production security, tenant, and HITL benchmark

- [ ] Add failing tests for P09-P12: tenant isolation, least privilege/tool permission, HITL authorization, auditability, and sanitized error/data boundaries.
- [ ] Run focused tests and confirm failure.
- [ ] Implement benchmark assertions against the existing Stage 12.5 public contracts.
- [ ] Run focused security regression plus production-readiness tests.
- [ ] Review that no benchmark artifact leaks sensitive values and that fail-closed behavior remains authoritative.
- [ ] Commit Task 3 and independently review before proceeding.

## Task 4 — Operations, SLO, retention, and deployment benchmark

- [ ] Add failing tests for P13-P16: observability, failure/SLO, retention/purge protection, Compose/deployment boundary, and a representative end-to-end investment workflow.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the minimal benchmark assertions and artifact sections.
- [ ] Run benchmark plus existing observability, failure/SLO, retention, deployment, and Compose smoke tests.
- [ ] Review operational determinism, timeout behavior, cleanup, and artifact safety.
- [ ] Commit Task 4 and independently review before proceeding.

## Task 5 — CI readiness gate and full verification

- [ ] Add a CI gate that executes the complete P01-P16 benchmark.
- [ ] Validate schema version, exact case count/order, all-pass status, and artifact presence.
- [ ] Run Typecheck, API Build, Full Test, existing 64/64 Benchmark, S01-S16 Security Regression, Production Readiness P01-P16, Crash/Recovery/Fencing, Compose Smoke, and sensitive-data regression.
- [ ] Fix only evidence-backed failures; preserve existing semantics.
- [ ] Run exact branch-head CI and record evidence.
- [ ] Perform broad whole-branch review covering architecture, security, durability, CI determinism, and docs consistency.
- [ ] Commit final implementation and prepare PR.

## Task 6 — Merge verification and closeout

- [ ] Open implementation PR against `main` and keep it separate from documentation closeout.
- [ ] Mark ready only after branch-head CI and task review are green.
- [ ] Merge using the verified head SHA; record the resulting merge SHA.
- [ ] Verify mainline CI against the exact merge SHA.
- [ ] Write the Stage 12.6 closeout record and update the roadmap only after exact mainline verification passes.
- [ ] Open documentation closeout PR, verify its branch CI, merge, and verify the exact documentation merge SHA on mainline.
- [ ] Declare Stage 12.6 complete only when all implementation, mainline, and documentation verification gates are green.

## Review protocol

Every implementation task is treated as an isolated subagent unit: implement from tests, self-review, then an independent task review for spec compliance and code quality. Findings are fixed before the next task. After Task 5, perform a broad whole-branch review. No human confirmation is requested between tasks; the only deliberate stop conditions are destructive/irreversible operations, security-sensitive actions, shared-branch publication/merge, or an unsatisfiable plan.

## Acceptance matrix

| Gate | Requirement |
|---|---|
| Typecheck | GREEN |
| API Build | GREEN |
| Full Test | GREEN |
| Existing benchmark | 64/64 GREEN |
| Security regression | S01-S16 = 16/16 GREEN |
| Production readiness | P01-P16 = 16/16 GREEN |
| Crash/Recovery/Fencing | GREEN |
| Compose Smoke | GREEN |
| Sensitive-data regression | GREEN |
| Branch-head CI | GREEN |
| Implementation merge-SHA mainline CI | GREEN |
| Documentation closeout branch CI | GREEN |
| Documentation merge-SHA mainline CI | GREEN |
