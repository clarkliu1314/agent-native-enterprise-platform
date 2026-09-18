# Agent-native Enterprise Platform — Agent Development Contract

## Mission

This repository builds an enterprise-grade Agent-native runtime for equity-investment management. The platform core owns durable execution; AgentScope, LangGraph, Eino, and Mastra are adapters, not the runtime.

## Non-negotiable architecture

- Agent Framework != Agent Runtime.
- Application code depends on `@agent-native/runtime-contract`, never on framework-specific runtime semantics.
- PostgreSQL is the durable system of record.
- Every externally effectful tool call is authorized by policy and protected by idempotency.
- State transitions and outbox insertion have explicit transaction boundaries.
- Recovery must re-enter the normal Permission → Idempotency → Tool Execution → Outbox path.
- Outbox transport is at-least-once; consumers must be idempotent.
- Adapters must satisfy the same runtime contract and benchmark suite.

## Development rules

1. Use TDD for behavior changes: write the failing test first, prove RED, implement the minimum, prove GREEN, then refactor.
2. Never weaken an existing safety invariant to make a test pass.
3. Prefer small, focused packages and explicit interfaces over implicit coupling.
4. Do not add framework SDK dependencies merely to make an adapter look real; integrate an SDK only when its runtime semantics are actually exercised and tested.
5. Production recovery must be durable. Do not introduce an in-memory candidate registry as a substitute for PostgreSQL state.
6. Never claim a change is complete without verification output from the applicable test/typecheck/CI commands.
7. When CI fails, identify the exact failing job, step, and root cause before editing code.
8. Preserve idempotency keys across retries and ambiguous external outcomes.
9. Do not change database state models without corresponding PostgreSQL assertions.
10. Keep business-domain code independent from infrastructure implementations; composition roots construct concrete adapters.

## Repository map

- `packages/runtime-contract`: stable application-facing runtime types and lifecycle contract.
- `packages/runtime`: deterministic in-memory reference implementation and shared infrastructure ports.
- `packages/durability`: PostgreSQL schema, durable run state, recovery coordination.
- `packages/tool-permission`: authorization policy.
- `packages/idempotency`: idempotency state/result semantics.
- `packages/outbox`: transactional outbox and publisher semantics.
- `packages/tool-runtime`: execution boundary combining safety concerns.
- `packages/adapters/*`: framework adapters.
- `packages/investment-domain/src/domain`: investment entities, invariants, and domain events.
- `packages/investment-domain/src/application`: investment use cases and persistence/runtime ports.
- `packages/investment-domain/src/persistence`: PostgreSQL implementations and durable persistence integration.
- `packages/investment-domain/src/workflow`: investment workflow semantics and runtime port.
- `packages/investment-domain/src/tool`: reserved for thin investment-specific tool definitions.
- `packages/benchmark/src`: shared benchmark framework plus platform and investment cases.
- `apps/worker`: durable asynchronous worker entrypoints.
- `tests/contract`: cross-adapter contract tests.
- `tests/architecture`: dependency-boundary guard tests.
- `tests/e2e/platform`: platform durability/operability E2E tests.
- `tests/e2e/investment`: investment business E2E tests.
- `docs/wiki`: human- and agent-readable project documentation.
- `docs/superpowers/plans`: approved implementation plans.

## Verification contract

At minimum for a normal change:

```bash
pnpm typecheck
pnpm test
```

For persistence/recovery changes, also run the PostgreSQL integration tests and inspect SQL state assertions. For adapter changes, run the shared contract suite. For benchmark changes, run the full benchmark matrix and Compose smoke verification.

## Commit discipline

Use focused conventional commits such as:

- `feat: ...`
- `fix: ...`
- `test: ...`
- `docs: ...`
- `refactor: ...`

Do not combine unrelated fixes. Each commit should leave the repository in a coherent state.

## Agent workflow

Before changing behavior:

1. Read this file.
2. Read the relevant package README/Wiki page and the active implementation plan.
3. Inspect the existing implementation and tests.
4. State the intended boundary and failure mode.
5. Write the failing test.
6. Implement minimally.
7. Run focused tests, then repository verification.
8. Report exact commits and verification status.

For architectural changes, use the repository's Superpowers skills and obtain human approval before implementation. Do not silently bypass an approved design.
