# Runtime Contract

`@agent-native/runtime-contract` is the application-facing abstraction. Its lifecycle is `startRun`, `executeTurn`, `checkpoint`, `recover`, `cancel`, and `getRunState`.

The contract deliberately does not expose AgentScope, LangGraph, Eino, or Mastra types. Adapters translate framework behavior into these stable operations.

The in-memory runtime is a deterministic reference implementation used by contract tests; it is not the durable production runtime.
