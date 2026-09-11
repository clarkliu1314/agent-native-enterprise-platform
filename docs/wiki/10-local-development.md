# Local Docker Compose environment

The repository provides a self-contained local environment for the durable platform core. It keeps PostgreSQL and Redis inside the Compose network and runs migration, worker-package smoke tests, and benchmark smoke tests without requiring Node.js or pnpm on the host.

## Services

| Service | Role |
| --- | --- |
| `postgres` | PostgreSQL durable system of record |
| `redis` | Local asynchronous delivery/queue infrastructure boundary |
| `migrate` | Idempotent schema bootstrap and deterministic seed |
| `worker` | Worker package startup/test smoke gate |
| `benchmark` | Framework-neutral benchmark smoke gate |

The repository does not yet contain production API, web, or mock-LLM applications. Compose intentionally does not create fake application services; those boundaries will be added when their implementation tasks land.

## Start and verify

Run:

```bash
docker compose up --build -d
docker compose wait benchmark
test "$(docker inspect "$(docker compose ps -q benchmark)" --format '{{.State.ExitCode}}')" = "0"
docker compose down -v
```

For a one-shot CI-style verification, the workflow performs the same sequence and also validates `docker compose config` first.

## Determinism

- PostgreSQL and Redis use pinned major-version images (`postgres:17-alpine` and `redis:7-alpine`).
- PostgreSQL and Redis expose health checks before dependent services proceed.
- `migrate` waits for PostgreSQL health and applies `infra/compose/migrate.sql` with `ON_ERROR_STOP=1`.
- The seed row is inserted with `ON CONFLICT DO NOTHING`, so repeated startup is safe.
- Benchmark containers receive service-local `DATABASE_URL` and `REDIS_URL` values and `TZ=UTC`.

## Architectural boundary

Compose is orchestration only. It does not redefine the Runtime Contract, Tool Permission, Idempotency, transactional Outbox, or Crash Recovery semantics. PostgreSQL remains the durable source of truth; Redis is an infrastructure boundary for future asynchronous delivery rather than a replacement for durable state.
