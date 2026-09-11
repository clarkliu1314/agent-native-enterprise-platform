# Agent-native Enterprise Platform Wiki

This directory is the durable project knowledge base for developers and Code Agents. Read `AGENTS.md` first, then this index, then the package-specific page relevant to the change.

## Architecture

1. [Architecture](./01-architecture.md) — ownership boundaries and system topology.
2. [Runtime Contract](./02-runtime-contract.md) — stable lifecycle contract and state model.
3. [Durability](./03-durability.md) — PostgreSQL as system of record and transaction boundaries.
4. [Tool Permission](./04-tool-permission.md) — default-deny authorization boundary.
5. [Idempotency](./05-idempotency.md) — logical effect identity and replay semantics.
6. [Outbox](./06-outbox.md) — transactional outbox and at-least-once transport.
7. [Crash Recovery](./07-crash-recovery.md) — durable recovery, leases, retries, and restart safety.
8. [Adapters](./08-adapters.md) — framework-neutral adapter contract.
9. [Benchmark](./09-benchmark.md) — shared 16-case evaluation model.

## Engineering

10. [Local Development](./10-local-development.md) — pnpm, tests, PostgreSQL, Docker Compose.
11. [Codex Development](./11-codex-development.md) — how a Code Agent should work in this repository.
12. [Deployment](./12-deployment.md) — web/API edge versus durable worker.

## Source of truth

The implementation plan in `docs/superpowers/plans/` tracks staged delivery. GitHub Issues track explicitly separated follow-up work. Code, tests, and CI are authoritative for current behavior; this Wiki documents the intended architecture and operating model.
