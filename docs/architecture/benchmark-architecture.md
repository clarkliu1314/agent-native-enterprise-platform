# Benchmark Architecture

The benchmark system has two independent concerns: a shared execution framework and business-domain case suites.

## Shared framework

`packages/benchmark/src/framework/` defines:

- adapter identity and matrix types
- benchmark case/result contracts
- invariant names
- runner contracts
- report/artifact contracts

The framework must not import a business-domain case implementation.

## Case ownership

`packages/benchmark/src/cases/platform/` owns platform durability invariants B01-B16.

`packages/benchmark/src/cases/investment/` owns equity-investment durability cases B17-B20.

A new business domain adds a new case directory and suite; it does not change framework semantics.

## Suites

- `suites/platform-suite.ts` exposes platform cases.
- `suites/investment-suite.ts` exposes investment cases.
- `suites/full-suite.ts` composes both.

The existing `src/index.ts` remains a compatibility entry point and exports the full suite. It is not the place where new cases should be authored.

## Matrix

Every case is evaluated against the same AgentScope, LangGraph, Eino, and Mastra adapter matrix. Domain cases reuse the same permission, idempotency, and outbox invariant vocabulary rather than defining a second safety model.
