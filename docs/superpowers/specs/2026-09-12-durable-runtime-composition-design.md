# Durable Runtime Composition + Vercel Request-Boundary Design

**Date:** 2026-09-12  
**Status:** Design approved in conversation; implementation intentionally not started.

## 1. Goal

Establish a production-grade composition boundary for the durable Agent Runtime and connect the stateless Vercel-compatible API request boundary to that runtime without making request lifetime the durability boundary. The design preserves the framework-neutral Runtime Contract and the 16-case × 4-adapter benchmark semantics.

## 2. Core Architecture

```text
Request Boundary
  Vercel / HTTP / auth / validation
          |
          v
RuntimeFacade
          |
          v
Durable Runtime
  lifecycle / fencing / events / recovery /
  idempotency / checkpoints / model / tools
          |
          v
Framework Adapter
  AgentScope / LangGraph / Eino / Mastra
```

PostgreSQL is the durable source of truth. Redis/queue is a scheduling and coordination layer only.

## 3. Runtime Application Boundary

`RuntimeFacade` is the sole application boundary for API, Worker, and Recovery. Commands include `createRun`, `resumeRun`, `cancelRun`, `approveRun`, and `executeRunBounded`; queries include `getRun`, `listRunEvents`, `getRunCheckpoint`, and `getToolCall`.

API handlers must not directly call repositories or framework adapters. RuntimeFacade depends only on framework-neutral Ports. Composition roots construct and inject infrastructure implementations. No process-local singleton is a source of truth.

## 4. Run Lifecycle

Run states are exactly `QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

Valid transitions: QUEUED -> RUNNING; QUEUED -> CANCELLED; RUNNING -> WAITING; RUNNING -> SUCCEEDED; RUNNING -> FAILED; RUNNING -> CANCELLED; RUNNING -> RUNNING for heartbeat/lease renewal; WAITING -> QUEUED on a wake event; WAITING -> CANCELLED.

Terminal states are irreversible. Leases exist only while RUNNING. Recovery of an expired RUNNING lease reclaims directly with a new fencing token rather than materializing a transient QUEUED state.

## 5. Worker Ownership and Fencing

Worker ownership uses a lease plus a PostgreSQL-generated monotonic `BIGINT` fencing token. Successful claims atomically establish ownership and increment the token/attempt. Every durable write by a worker includes the current `run_id` and fencing token in its ownership predicate; zero affected rows means ownership was lost and durable execution must stop. The database, not API or Worker processes, generates fencing tokens.

## 6. Durable Data Ownership

PostgreSQL responsibilities are separated as follows:

- `agent_runs`: lifecycle and ownership authority
- `agent_turns`: durable turn history
- `model_calls` and `model_call_attempts`: durable model execution identity and provider attempts
- `tool_calls`: tool invocation state and idempotency identity
- `agent_events`: append-only runtime/domain history
- `outbox_events`: transactional publication intent
- `idempotency_keys`: command admission deduplication
- `checkpoints`: continuation snapshots
- `wait_conditions`: durable waiting semantics for approval, callbacks, webhooks, schedules, and similar wake conditions

Every durable child record carries `run_id`. Child tables do not implicitly own Run lifecycle.

## 7. Command Idempotency

`POST /runs` uses PostgreSQL transactional idempotency. An idempotency key is bound to a canonical command hash. The first request creates the idempotency record, Run, domain event, and Outbox event in one transaction. A retry with the same key and same command replays the original durable response. A retry with the same key but a different command returns `409 Conflict`.

Idempotency is command-admission semantics, not external-effect semantics.

## 8. Event and Outbox Ordering

Run state mutation, append-only event, and Outbox record are committed in the same PostgreSQL transaction. Each Run has a monotonic event sequence. Outbox publication references the already-created logical event rather than reconstructing a new event. Redis delivery order is not the correctness authority; durable Event Log ordering and current durable state are.

## 9. Execution Steps

The framework-neutral execution model uses four step types: `ModelStep`, `ToolStep`, `HumanStep`, and `WaitStep`. Run lifecycle remains six-state and does not grow framework-specific states.

## 10. Model Calls

A Model Call is an independent durable execution step, not a Tool Call. A logical Model Call has a stable `call_id`, `run_id`, `turn_id`, model identity, canonical `request_hash`, replay policy, status, and timestamps. Provider attempts are separately recorded with an attempt ID/number, request hash, provider request ID, timestamps, and outcome.

Execution follows `TX #1: MODEL_REQUESTED -> commit`, provider call, then `TX #2: MODEL_COMPLETED/result -> commit with fencing validation`.

LLM calls are not assumed to be naturally idempotent. After a crash, recovery first attempts reconciliation when provider request identity supports it. Replay is allowed only for calls classified `REPLAYABLE`; `NON_REPLAYABLE` calls enter durable reconciliation/wait semantics when safe recovery cannot establish whether the provider call completed.

## 11. Tool Execution

Permission is checked before an external effect. Side-effecting tools must provide a reliable external idempotency contract. Runtime records tool intent before the external call and records the result afterward under fencing validation. Runtime distinguishes permission, fencing, and idempotency: permission answers whether execution is allowed; fencing answers who may mutate durable runtime state; idempotency answers whether the logical external effect has already occurred.

If a side-effecting tool lacks reliable idempotency, automatic recovery retry is prohibited and durable reconciliation/wait is required.

## 12. Checkpoints

Checkpoint ownership uses a Runtime-owned envelope with an Adapter-owned opaque payload. Runtime owns checkpoint ID, Run/turn identity, sequence, fencing token, adapter identity/version, schema version, lifecycle and retention. The adapter owns serialization, deserialization, and migration of its payload.

The payload is stored as opaque bytes. Runtime validates envelope metadata but never interprets framework-specific state. Checkpoints answer where execution can continue; Event Log answers what happened. They are not interchangeable.

## 13. Framework Adapter Boundary

Runtime is the sole execution authority. Adapters only drive their framework execution and translate framework state/results into the framework-neutral Runtime Contract. They may serialize adapter-specific checkpoint payloads, but they cannot own Run lifecycle, permission, fencing, idempotency, PostgreSQL persistence, Outbox publication, or terminal-state decisions.

This boundary is essential to preserve the validity of the 16-case × 4-adapter benchmark: all frameworks are evaluated through the same Runtime Contract and durable safety semantics.

## 14. API Execution Semantics

`POST /runs` defaults to asynchronous execution and returns `202 Accepted` after durable admission. An optional `execution_mode=sync` performs bounded execution; if it completes within the API budget, return `200` with the terminal framework-neutral result. If the bounded deadline is reached, the durable Run remains active and continuation proceeds through Worker execution, with the API returning `202` rather than treating request lifetime as a durability boundary.

`GET /runs/:run_id` is a durable read contract.

## 15. Composition Roots and Deployment Boundary

There are separate composition roots for API, Worker, Recovery, and Outbox Publisher. API owns HTTP, validation/auth boundary, RuntimeFacade, and bounded execution. Worker owns queue consumption, Run claim, lease/heartbeat, fencing, and Runtime execution. Recovery owns expired-lease scanning, `FOR UPDATE SKIP LOCKED` reclaim, new fencing token, retry/reconciliation, and wake-up processing. Outbox Publisher owns unpublished-row claiming, Redis/queue publication, marking published, and safe retry.

All roots share the same Runtime implementation and framework-neutral Ports but instantiate their own process-specific infrastructure. Recovery is not a second Runtime and must enter through the same application/runtime rules rather than directly mutating lifecycle state.

## 16. Scheduler and Recovery

Primary scheduling uses Outbox -> Redis/queue -> Worker. PostgreSQL `FOR UPDATE SKIP LOCKED` polling is the recovery fallback. PostgreSQL remains the authority. Recovery must be deterministic from persisted state, events, checkpoints, idempotency records, leases, and wait conditions.

## 17. Failure and Consistency Model

The design explicitly handles API retries through transactional command idempotency; Worker crashes through lease expiration and fencing; stale workers through fencing predicates; publisher crashes through durable Outbox retry; tool ambiguity through external idempotency or reconciliation/wait; model ambiguity through provider reconciliation and replay policy; adapter restart through durable opaque checkpoints; and Redis loss through PostgreSQL recovery polling.

No request, Redis message, framework process, or adapter-local state is treated as the durable source of truth.

## 18. Verification Strategy

Implementation must be TDD-first and preserve all existing benchmark/CI hard gates. New verification must cover API idempotent admission and replay; durable Run creation and Event/Outbox atomicity; async API -> Outbox -> Worker execution; bounded sync execution and timeout continuation; atomic lease/fencing claims; stale-worker write rejection; model-call crash/reconciliation/replay semantics; checkpoint envelope and opaque payload behavior; Recovery via PostgreSQL fallback; independent API/Worker/Recovery/Publisher composition roots; end-to-end durable API reads; and existing 64-case benchmark plus Compose smoke remaining green.

## 19. Non-Goals

This phase does not make any framework adapter the persistence authority, does not make Redis the source of truth, does not introduce request-lifetime durability assumptions, and does not invent provider idempotency for arbitrary third-party systems.

## 20. Design Approval

The architecture was reviewed and approved conversationally, with the final composition-root choice explicitly confirmed as option A. Implementation is intentionally gated until this written specification is reviewed as the canonical design artifact.
