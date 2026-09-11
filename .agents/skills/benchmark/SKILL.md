---
name: benchmark
description: Add or review deterministic adapter benchmark cases with fixtures, durable state, mock LLM/tool behavior, SQL assertions, expected results, and failure criteria.
---

# Benchmark

Every benchmark case defines fixture data, initial durable state, Mock LLM/Tool behavior, exact operations, SQL assertions, expected result, and failure criteria.

Run the identical matrix through every adapter. Compare stable runtime behavior, not framework-specific implementation details. Emit deterministic machine-readable results where the benchmark runner supports it.
