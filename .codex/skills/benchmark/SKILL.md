# Benchmark

Use this skill when adding or changing adapter benchmarks.

Every benchmark case must define: fixture, initial durable state, Mock LLM/Tool behavior, exact operation sequence, SQL assertions, expected result, and failure criteria.

Run the identical case matrix through every adapter. Keep framework-specific behavior inside the adapter and compare only the stable runtime contract. Emit deterministic machine-readable results where the benchmark runner supports it.
