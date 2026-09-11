# Architecture

## Core principle

Agent Framework != Agent Runtime. The application depends on a stable runtime contract. Framework-specific execution is isolated behind adapters.

## Ownership

- Runtime contract: lifecycle types and operations.
- Runtime core: run state, turns, checkpoints, recovery and cancellation semantics.
- Durability: PostgreSQL persistence and concurrency control.
- Tool runtime: Permission + Idempotency + external invocation + Outbox boundary.
- Worker: durable asynchronous recovery and background execution.
- Adapters: AgentScope, LangGraph, Eino, and Mastra integration surfaces.

## Failure model

A business effect can have an ambiguous external outcome. Therefore retry identity belongs to the logical operation, not to a worker attempt. A successful transport publish may be repeated if acknowledgement is lost; consumers must deduplicate.

## Deployment boundary

Request-lifetime infrastructure is not the durable execution boundary. The web/API edge may initiate work, while PostgreSQL and an independently running worker own durable progress.
