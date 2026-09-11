# Codex Development

Codex should treat this repository as an agent-maintained system with explicit contracts.

## Startup order

1. Read `AGENTS.md`.
2. Read this Wiki index and the relevant package page.
3. Read the active Superpowers plan/spec.
4. Inspect current tests and implementation before editing.
5. For behavior changes, create the failing test first.

## Repository-native Codex surfaces

- `AGENTS.md` is the primary repository instruction contract.
- `.agents/skills/*/SKILL.md` contains repository skills discovered by Codex.
- `.codex/config.toml` is intentionally minimal and contains no unsupported command aliases.
- A plugin is not required for local development: duplicating the repository skills into a plugin would create a second source of truth. Add a plugin only when a distributable/installable integration is needed.

## Specialized workflows

- `repo-review`: whole-repository readiness and architecture review.
- `durable-recovery`: PostgreSQL leases, retries, recovery, and idempotency.
- `benchmark`: shared adapter benchmark cases and result contracts.
- `architecture-review`: cross-package contract and dependency review.

## Completion rule

A Code Agent must report changed files, commits, focused verification, and CI status. “Looks correct” is not a verification result.
