# Investment Tool Boundary

Investment-specific agent tools belong here as thin declarations/adapters.

Tools must not implement their own permission, idempotency, outbox, recovery, or durable-state semantics. Those invariants remain owned by the platform Tool Runtime and Application layer.

Expected flow:

```text
Investment Tool
  -> Tool Runtime
  -> Permission
  -> Idempotency
  -> Investment Application
  -> Investment Domain
```

This directory intentionally contains no duplicate platform safety implementation.
