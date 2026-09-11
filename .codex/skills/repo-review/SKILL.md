# Repository Review

Use this skill before substantial changes or when asked to audit the codebase.

## Workflow

1. Read `AGENTS.md`, the active plan under `docs/superpowers/plans/`, and `docs/wiki/README.md` if present.
2. Map packages, apps, tests, infrastructure, CI, and agent configuration.
3. Check architecture boundaries: runtime contract, durability, permission, idempotency, outbox, recovery, adapters.
4. Check test coverage for every safety invariant and failure mode.
5. Check TypeScript/package exports and workspace dependency declarations.
6. Check local developer experience: install, typecheck, test, Docker, and deterministic fixtures.
7. Report findings by severity: blocker, high, medium, low.
8. Fix only issues in scope; create follow-up issues for independent work.

## Required output

Include exact file paths, observed evidence, impact, recommended change, and verification command. Never infer a passing state from code inspection alone.
