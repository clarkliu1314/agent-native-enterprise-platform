# Benchmark

The benchmark is framework-neutral. Each case defines fixture data, initial durable state, Mock LLM/Tool behavior, exact operations, SQL assertions, expected result, and failure criteria.

The same cases execute through every adapter. Results compare the stable runtime behavior rather than framework-specific implementation details.

The planned suite contains 16 cases spanning lifecycle, safety, idempotency, outbox, crash recovery, concurrency, and adapter behavior.
