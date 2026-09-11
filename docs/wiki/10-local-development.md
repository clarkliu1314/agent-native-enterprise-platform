# Local Development

## Prerequisites

- Node.js 22 or newer
- pnpm 10.15.0
- Docker with Compose

## Fast verification

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Durable services

Use `docker compose up -d` for the repository's PostgreSQL/Redis development services once the Compose stack is configured for the corresponding application stage. Persistence tests must run against PostgreSQL rather than a mocked repository.

## Agent workflow

Start from `AGENTS.md`, use `.codex/skills` for specialized workflows, and keep focused commits. CI is the final authority when local tooling cannot reproduce the hosted environment.
