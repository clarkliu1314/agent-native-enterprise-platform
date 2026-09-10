# Agent-native Enterprise Platform

An enterprise-grade Agent-native runtime and application foundation.

## Design principles

- Agent Framework != Agent Runtime
- Durable execution is owned by the platform core
- Tool calls are policy-authorized and idempotent
- State transitions and outbox publication have explicit transaction boundaries
- AgentScope, LangGraph, Eino, and Mastra integrate through one runtime contract
- The same benchmark suite validates every adapter

## Repository layout

```text
apps/                 # API, web, worker
packages/             # runtime and domain packages
packages/adapters/    # AgentScope, LangGraph, Eino, Mastra adapters
tests/                # contract, integration, benchmark tests
infra/                # local infrastructure
docs/                 # architecture and implementation plans
```

## Implementation plan

See `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`.

## Status

Phase 0: repository and implementation plan established. Kernel implementation follows via TDD.
