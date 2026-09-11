# Durability

PostgreSQL is the durable system of record. Persisted state includes runs, turns, tool calls, checkpoints, events, idempotency records, and outbox events.

Durable mutations must use explicit transaction boundaries. Concurrent updates require optimistic or row-level concurrency control appropriate to the operation.

Recovery must be derivable from persisted state rather than process memory. Any worker-local state is disposable cache/coordination state, never the source of truth.
