# Repository & Domain Boundary Consolidation

## Objective

Reorganize the completed platform and equity-investment vertical slice without changing runtime, durability, permission, idempotency, outbox, recovery, adapter, or benchmark semantics.

The refactor establishes explicit boundaries for:

- Investment Domain
- Investment Application
- Investment Persistence
- Investment Workflow
- Investment Tool integration
- Platform Benchmark framework
- Business-domain Benchmark cases
- Platform E2E
- Investment E2E

## Constraints

1. PostgreSQL remains the durable source of truth.
2. Redis remains delivery/coordination infrastructure only.
3. The Runtime FSM remains `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
4. Permission, idempotency, outbox, recovery, fencing, auditability, SLO, and security semantics are unchanged.
5. AgentScope, LangGraph, Eino, and Mastra continue to use the same runtime contract.
6. B01-B20 expected behavior is unchanged.
7. The refactor must not introduce framework SDK dependencies.

## Target repository shape

```text
packages/investment-domain/src/
  domain/
  application/
  persistence/
  workflow/
  tool/

packages/benchmark/src/
  framework/
  cases/platform/
  cases/investment/
  suites/

tests/e2e/
  platform/
  investment/
```

## Dependency rules

```text
Domain -> platform contracts only
Application -> Domain + ports
Persistence -> Application ports + Domain
Workflow -> runtime contract + workflow port
Tool -> tool-runtime + Application ports
API -> Application/Workflow through composition root
Benchmark framework -> no business-domain implementation imports
Platform benchmark cases -> framework only
Investment benchmark cases -> framework + Investment test fixtures
```

The following imports are prohibited from the Investment Domain:

- PostgreSQL clients or SQL implementation modules
- Redis
- `@agent-native/runtime` implementation modules
- application entrypoints
- Vercel/deployment modules
- Agent framework adapters

## Work sequence

1. Establish architecture documentation and boundary guardrails. **Done**
2. Split Investment Domain source from Application, Persistence, and Workflow implementation. **Done**
3. Re-home Investment tests beside their owning boundary. **Done**
4. Reorganize Benchmark into shared framework + platform cases + investment cases + suites. **Done**
5. Re-home E2E tests into platform/investment ownership. **Done**
6. Reconcile README, AGENTS, and architecture documentation. **Done**
7. Run typecheck, unit/integration/E2E, benchmark, compose smoke, and mainline CI. **Done — PR #50 CI Run #1017 is green; boundary guards were hardened afterward and are being re-verified.**

## Completion criteria

- No Domain -> infrastructure implementation imports.
- No Application -> PostgreSQL implementation imports.
- Benchmark framework is business-domain agnostic.
- Platform and Investment benchmark suites are independently addressable.
- Existing behavior and verification contracts remain green.
- Documentation matches the actual repository layout.
