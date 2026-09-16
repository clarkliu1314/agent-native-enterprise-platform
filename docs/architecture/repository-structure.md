# Repository Structure and Dependency Boundaries

The repository is organized around durable platform capabilities and explicit business-domain boundaries. Directory names are architectural contracts, not cosmetic grouping.

## Investment boundary

```text
packages/investment-domain/src/
  domain/       business entities, invariants, domain events
  application/  use cases, commands, repository/event ports, unit-of-work contract
  persistence/  PostgreSQL implementations and durable workflow persistence
  workflow/     investment workflow admission/resume semantics and runtime port
  tool/         reserved for thin investment-specific tool definitions
```

### Dependency direction

```text
Domain
  ↑
Application ports/use cases
  ↑                 ↑
Persistence      Workflow
  ↑                 ↑
composition roots / runtime
```

Domain code must not import infrastructure implementations, database clients, Redis, application entrypoints, Vercel/deployment code, or framework adapters.

Application code depends on domain types and ports. PostgreSQL implementations live only under persistence. Workflow code depends on the durable runtime contract rather than runtime implementation details.

## Benchmark boundary

Benchmark code is divided into a shared execution/measurement framework and domain-owned cases:

```text
packages/benchmark/src/
  framework/              adapter matrix, case/result types, runner, artifacts
  cases/platform/         platform invariants B01-B16
  cases/investment/       investment durability B17-B20
  suites/                 platform, investment, and full suite composition
```

The framework owns how a case is executed and measured. Cases own business fixtures and assertions. Adding a new business domain must not require changing the framework.

## E2E boundary

```text
tests/e2e/platform/       runtime, recovery, auditability, SLO, security
 tests/e2e/investment/     investment lifecycle and workflow scenarios
```

Platform E2E verifies platform invariants. Investment E2E verifies business behavior built on those invariants.

## Composition roots

`apps/api`, `apps/worker`, `apps/recovery`, and `apps/outbox-publisher` are composition roots. They may construct concrete infrastructure implementations. Business packages should expose ports and use cases instead of constructing PostgreSQL or runtime implementations.

## Refactor rule

This structure is intended to preserve behavior. Moving a file is not permission to change runtime semantics. Any behavior change requires its own test-first change and explicit durability assertions.
