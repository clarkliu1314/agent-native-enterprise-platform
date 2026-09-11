# Benchmark

The benchmark is framework-neutral. Each case defines fixture data, initial durable state, Mock LLM/Tool behavior, exact operations, SQL assertions, expected result, and failure criteria.

The suite contains **16 deterministic cases** and executes each case through all four adapters (AgentScope, LangGraph, Eino, Mastra), producing a 16 × 4 = **64 execution matrix**. The benchmark depends on the stable runtime contract rather than framework-specific semantics.

## Current status

- Benchmark case schema: implemented.
- B01–B16: encoded as data-driven cases with fixture, initial durable state, Mock LLM/Tool, exact steps, SQL assertions, expected result, failure criteria, and Permission/Idempotency/Outbox safety invariants.
- Four-adapter execution contract: implemented.
- 64-case adapter matrix contract test: implemented and CI-verified in Run #149.
- Real scenario runner: next implementation step.
- Safety invariants: must be hard failure gates in the real runner, not informational metrics.
- Deterministic machine-readable result artifact: next implementation step.

## Required execution semantics

1. Permission failures must prevent tool execution and externally visible side effects.
2. Idempotent retries must replay the durable result rather than repeat the business effect.
3. Transactional outbox semantics must never acknowledge publication before transport success.
4. Crash recovery must use durable state, idempotency records, leases, and fencing to prevent duplicate business effects.
5. Every adapter runs the same case definition and is judged against the same expected result and failure criteria.
6. Any Permission, Idempotency, or Outbox invariant violation fails the benchmark case.

## Matrix

| Cases | Adapters | Executions |
|---:|---:|---:|
| 16 | 4 | 64 |

The benchmark is deliberately framework-neutral: differences between AgentScope, LangGraph, Eino, and Mastra belong inside adapters; safety and durability semantics belong to the platform core.
