# Agent-native Enterprise Platform

An enterprise-grade Agent-native runtime and application foundation.

## Design principles

- Agent Framework != Agent Runtime
- Durable execution is owned by the platform core
- Tool calls are policy-authorized and idempotent
- State transitions and outbox publication have explicit transaction boundaries
- AgentScope, LangGraph, Eino, and Mastra integrate through one runtime contract
- The same benchmark suite validates every adapter
- Vercel is a stateless application edge; durable worker execution remains independently deployable

## Repository layout

```text
apps/                 # API, web, worker
packages/             # runtime and domain packages
packages/adapters/    # AgentScope, LangGraph, Eino, Mastra adapters
packages/deployment-boundary/ # Vercel-safe application boundary + LLM gateway contract
tests/                # contract, integration, benchmark tests
infra/                # local infrastructure
docs/                 # architecture and implementation plans
```

## Deployment boundary

The Vercel-facing boundary validates requests and delegates to the platform Runtime Contract. It does not own recovery loops, leases, transactional outbox publication, or authoritative in-memory state.

Durable execution is handled independently by the worker. PostgreSQL remains the durable source of truth and Redis is optional coordination/queue infrastructure.

Model access is provider-neutral through `LlmGateway`; provider credentials are deployment secrets and are never persisted into run state.

See `docs/architecture/vercel-deployment-boundary.md` for topology, environment variables, and failure semantics.

### Environment

Required:

- `DATABASE_URL`

Optional:

- `REDIS_URL`
- `LLM_GATEWAY_URL`
- `LLM_PROVIDER_API_KEY`
- `WORKER_ENDPOINT`

Missing required configuration fails closed; optional configuration is never replaced by an unsafe default.

## Local Compose

Local Compose runs PostgreSQL, Redis, migrations, the durable-worker smoke test, and the benchmark smoke test. It does not fabricate a mock production API or LLM provider merely for deployment cosmetics.

## Implementation plan

See `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` and the Task 9 plan at `docs/superpowers/plans/2026-09-11-vercel-deployment-boundary.md`.

## Status

Phase 9: Vercel deployment boundary established as a stateless, framework-neutral application boundary. Durable worker and platform-core semantics remain outside request-lifetime execution.
