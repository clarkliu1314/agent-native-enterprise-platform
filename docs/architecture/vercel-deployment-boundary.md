# Vercel Deployment Boundary

## Topology

```text
                 ┌──────────────────────┐
                 │       Vercel         │
                 │ stateless Web / API  │
                 └──────────┬───────────┘
                            │ Runtime Contract
                            ▼
                 ┌──────────────────────┐
                 │   Platform Core      │
                 │ state / tools /      │
                 │ permission / idem.   │
                 └───────┬────────┬─────┘
                         │        │
                 durable DB      outbox / queue
                         │        │
                         ▼        ▼
                 ┌──────────┐  ┌──────────┐
                 │PostgreSQL│  │  Redis   │
                 └──────────┘  └────┬─────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │ Durable     │
                             │ Worker      │
                             │ recovery /  │
                             │ retry /     │
                             │ publication │
                             └─────────────┘
```

Vercel is an application edge, not the durable execution runtime. A request may create durable work and return before that work completes. A request timeout or process termination therefore does not imply loss of the run.

## Capability ownership

| Capability | Vercel | Durable worker |
| --- | --- | --- |
| Request validation/authentication | Yes | No |
| Runtime Contract delegation | Yes | Yes |
| Durable state ownership | No | Through platform core |
| Long-running execution | No | Yes |
| Recovery lease claim/renewal | No | Yes |
| Crash recovery/retry | No | Yes |
| Transactional outbox publication | No | Yes |
| Idempotent external effects | Via existing platform service | Via existing platform service |
| LLM provider invocation | Through `LlmGateway` boundary | Through `LlmGateway` boundary |

The Vercel request path must not import recovery-worker loops, recovery stores, lease operations, or outbox publisher implementations.

## Environment contract

Required:

- `DATABASE_URL` — PostgreSQL connection used by the durable platform layer.

Optional:

- `REDIS_URL` — coordination/queue connection.
- `LLM_GATEWAY_URL` — separately deployed provider-agnostic LLM gateway.
- `LLM_PROVIDER_API_KEY` — secret available only to the deployment that invokes the provider; never persisted as run data.
- `WORKER_ENDPOINT` — internal asynchronous handoff/control-plane address where required.

Missing required configuration fails closed. Optional values have no unsafe fallback.

## Local Compose vs Vercel

Local Compose provides PostgreSQL, Redis, migration, worker smoke, and benchmark smoke services. The worker is a separate service and remains responsible for durable background behavior.

The repository does not fabricate a mock LLM or fake production API solely for Vercel deployment cosmetics. The API boundary is packaged separately so a real application composition can be connected when its durable runtime wiring is available.

Vercel deployment should point at the API application boundary. The worker is deployed independently and is never represented as a Vercel Function.

## Failure semantics

- Request termination is not a durable-state rollback mechanism.
- Asynchronous work must be persisted before the request relies on it surviving.
- Worker crash is handled by persisted recovery state, leases, retry/backoff, and idempotency.
- Duplicate delivery is handled by the existing outbox/idempotency semantics.
- LLM gateway failures remain provider-neutral and are classified by the execution context.
- No request-local memory is authoritative for run state.
