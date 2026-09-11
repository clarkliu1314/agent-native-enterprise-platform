---
name: repo-review
description: Review this repository's architecture, tests, dependencies, CI, and Code Agent readiness before substantial changes or when asked to audit the codebase.
---

# Repository Review

1. Read `AGENTS.md`, the active plan under `docs/superpowers/plans/`, and `docs/wiki/README.md`.
2. Map packages, apps, tests, infrastructure, CI, and agent configuration.
3. Check architecture boundaries: runtime contract, durability, permission, idempotency, outbox, recovery, adapters.
4. Check test coverage for every safety invariant and failure mode.
5. Check TypeScript/package exports and workspace dependency declarations.
6. Check local developer experience: install, typecheck, test, Docker, and deterministic fixtures.
7. Report findings by severity: blocker, high, medium, low.
8. Fix only issues in scope; create follow-up issues for independent work.

Required output: exact file paths, evidence, impact, recommended change, and verification command. Never infer a passing state from inspection alone.
