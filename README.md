# Agent-native Enterprise Platform

An enterprise-grade Agent-native runtime and equity-investment management foundation.

## Design principles

- Agent Framework != Agent Runtime
- Durable execution is owned by the platform core
- Tool calls are policy-authorized and idempotent
- State transitions and outbox publication have explicit transaction boundaries
- AgentScope, LangGraph, Eino, and Mastra integrate through one runtime contract
- The same benchmark framework validates every adapter
- Vercel is a stateless application edge; durable worker execution remains independently deployable

## Repository layout

```text
apps/                       # API, worker, recovery, outbox publisher
packages/                   # runtime, durability, safety, and business-domain packages
packages/adapters/          # AgentScope, LangGraph, Eino, Mastra adapters
packages/investment-domain/ # bounded investment domain: domain/application/persistence/workflow/tool
packages/benchmark/         # shared benchmark framework and platform/domain cases
tests/                      # contract, architecture, integration, and E2E tests
infra/                      # local infrastructure
docs/                       # architecture, status, and implementation plans
```

See `docs/architecture/repository-structure.md` for dependency direction and boundary rules.

## Deployment boundary

The Vercel-facing boundary validates requests and delegates to the platform Runtime Contract. It does not own recovery loops, leases, transactional outbox publication, or authoritative in-memory state.

Durable execution is handled independently by the worker. PostgreSQL remains the durable source of truth and Redis is optional coordination/queue infrastructure.

Model access is provider-neutral through `LlmGateway`; provider credentials are deployment secrets and are never persisted into run state.

See `docs/architecture/vercel-deployment-boundary.md` for topology, environment variables, and failure semantics.

## Local Compose

Local Compose runs PostgreSQL, Redis, migrations, the durable-worker smoke test, and the benchmark smoke test. It does not fabricate a mock production API or LLM provider merely for deployment cosmetics.

## Verification

```bash
pnpm typecheck
pnpm test
```

Persistence/recovery changes also require PostgreSQL integration assertions. Adapter changes require the shared contract suite. Benchmark changes require the full benchmark matrix and Compose smoke verification.

## Current status

Stage 12.7 Final Mainline Verification is complete. The platform foundation, production-readiness hardening, equity-investment vertical slice, benchmark matrix, auditability, SLO/failure handling, and security hardening have been verified on main.

Repository Boundary Consolidation is complete and merged to `main`. The repository is now ready for the next product-development cycle, with the explicit domain/application/persistence/workflow boundaries and platform/investment benchmark and E2E ownership documented above.
