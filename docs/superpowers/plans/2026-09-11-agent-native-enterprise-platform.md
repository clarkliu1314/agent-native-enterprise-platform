# Agent-native Enterprise Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, enterprise-grade Agent-native runtime whose application contract is independent of AgentScope, LangGraph, Eino, and Mastra.

**Architecture:** The platform core owns Agent Run state, turns, tool execution, permissions, idempotency, outbox, event log, checkpointing, recovery, and cancellation. Frameworks are adapters behind a stable Runtime Contract. PostgreSQL is the durable system of record, Redis/queue handles asynchronous delivery, and Vercel hosts the web/API edge while the durable worker remains independently deployable.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, PostgreSQL, Redis, Node.js workers, Docker Compose, Vercel-compatible Node request boundary. Adapter packages will be added incrementally for AgentScope, LangGraph, Eino, and Mastra.

**Spec:** Project architecture and benchmark specification from the prior design conversation, including Tool Permission, Crash Recovery, Outbox + Idempotency, the 16-case adapter benchmark, and the approved Durable Runtime Composition + Vercel Request-Boundary Design in `docs/superpowers/specs/2026-09-12-durable-runtime-composition-design.md`.

## Global Constraints

- Agent Framework != Agent Runtime.
- Runtime Contract is the stable application-facing abstraction.
- Every externally effectful tool call must be authorized and idempotent.
- Durable state transitions and outbox publication must use an explicit transaction boundary.
- Recovery must be deterministic from persisted state/events/checkpoints.
- Adapter behavior is measured through one identical contract and benchmark suite.
- No production code is introduced before its corresponding test has demonstrated the intended failure mode.

## Completed foundation

Tasks 1-9 from the original plan are complete, including the Runtime Contract, in-memory runtime, PostgreSQL persistence, Tool Permission/Idempotency/Outbox, crash recovery, four framework adapter contract surface, 64-case benchmark hard gate, Docker Compose, and the stateless Vercel boundary. The authoritative benchmark CI runs #287/#288 passed on the merged benchmark head.

## Durable Runtime Composition checkpoint

The approved Durable Runtime Composition + Vercel Request-Boundary Design is implemented on `feat/durable-runtime-composition` in PR #5. PostgreSQL is the source of truth; Redis is delivery/scheduling only; RuntimeFacade is the sole application boundary; and API, Worker, Recovery, and Outbox Publisher have separate composition roots.

Implemented and covered: six-state Run FSM, atomic Run/Event/Outbox transactions, transactional API idempotency replay/conflict, monotonic PostgreSQL fencing, fenced lease heartbeat, permission-before-effect tools, side-effect replay protection, durable Model Call intent/attempt/result persistence with logical-call replay, opaque checkpoints, SKIP LOCKED recovery, Redis Streams ACK/pending reclamation, Outbox publishing/retry, facade-driven Worker execution, API bounded sync 200/202 semantics, and API→PostgreSQL→Outbox→Worker plus lease-expiry recovery E2E coverage.

A schema drift was corrected before declaring the slice green: `infra/compose/migrate.sql` now matches the durable repository schema and CI applies it before tests. Additional hardening now fences checkpoint persistence and prevents replay of in-flight side effects and already-succeeded logical Model Calls.

### Verification status

- Historical Run #354 is green but predates the final integration/hardening commits; it is not authoritative for the current HEAD.
- Current HEAD is `145067ac1ca5137086a174a647f9ffd5630ef96c`.
- Fresh CI is the final authority and must validate the same current HEAD for repository typecheck, API typecheck/build, deployment boundary, 64/64 benchmark hard gate, full test suite, PostgreSQL/Redis integration, and Compose smoke.
- Do not start the investment-domain application until that fresh current-HEAD gate is green.

### Remaining durable-runtime gate

- [x] Add sync-deadline E2E proving the API returns 202 while the durable Run remains RUNNING after the bounded request budget expires.
- [x] Add crash/replay tests for permission-before-effect, successful side-effect replay, in-flight side-effect protection, lost-fence result rejection, Model Call intent ordering, successful logical-call replay, and NON_REPLAYABLE failure handling.
- [x] Fence checkpoint persistence against the current RUNNING fencing token.
- [x] Update Model Call persistence to read durable logical-call status before replaying provider work.
- [x] Verify existing Worker recovery/duplicate-delivery and Redis ACK/pending coverage is present in the repository test matrix.
- [ ] Obtain a fresh authoritative CI run on the exact current HEAD.
- [ ] Record the final CI run number and all green jobs in this plan.
- [ ] Mark PR #5 Ready only after the fresh gate is green.
- [ ] Move to the equity-investment domain only after the durable-runtime gate is closed.

## Approved durable runtime architecture remains locked

1. `POST /runs`: async by default (`202`), optional bounded sync (`200` if terminal within budget; otherwise `202` and durable continuation).
2. Scheduler: Outbox/Redis primary path with PostgreSQL `FOR UPDATE SKIP LOCKED` recovery fallback.
3. Worker ownership: lease + fencing token.
4. Fencing: PostgreSQL monotonic `BIGINT`, database-generated, checked on every durable worker write.
5. Run FSM: `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
6. PostgreSQL ownership: lifecycle, turns, model calls, tool calls, events, outbox, idempotency, checkpoints, and wait conditions have explicit responsibilities.
7. Application boundary: `RuntimeFacade` is the sole API/Worker/Recovery application boundary.
8. Dependency direction: RuntimeFacade depends only on framework-neutral Ports; composition roots inject infrastructure.
9. Tool execution: permission before effect; side-effecting tools require external idempotency or durable reconciliation/wait.
10. Model execution: independent durable Model Step with logical call identity, request hash, provider attempts, and replay policy.
11. Framework adapters: Runtime is the execution authority; adapters only drive framework execution and translate to the Runtime Contract.
12. Checkpoints: Runtime-owned envelope + Adapter-owned opaque payload.
13. API idempotency: PostgreSQL transactional idempotency key + command hash + original-response replay.
14. Event ordering: transactional Event + Outbox with per-Run monotonic sequence.
15. Composition roots: API, Worker, Recovery, and Outbox Publisher are separate processes/roots sharing the same Runtime implementation and framework-neutral Ports.

## Next gate

Close PR #5 only after fresh current-HEAD CI proves the complete durable runtime. Then implement the equity-investment domain on top of the stable RuntimeFacade rather than coupling business logic to any framework adapter.
