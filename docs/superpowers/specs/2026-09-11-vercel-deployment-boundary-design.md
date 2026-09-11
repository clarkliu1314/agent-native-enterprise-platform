# Vercel Deployment Boundary Design

**Date:** 2026-09-11  
**Status:** Approved architecture; implementation pending written-spec review

## Goal

Define a deployment boundary that allows a future Vercel-hosted web/API edge to use the Agent-native platform without moving durable execution, crash recovery, database ownership, or outbox publication into request-lifetime serverless execution.

## Architecture

Vercel is an edge/request boundary only. It may validate/authenticate a request, invoke the stable Runtime Contract, read durable state, and return an accepted/completed response, but it must not own long-running execution, recovery leases, transactional outbox publication, or worker-only coordination.

The durable worker remains independently deployable and owns asynchronous execution, recovery/retry, and outbox publication. PostgreSQL remains the durable source of truth. Redis may provide coordination/queue capabilities but is not the source of truth.

The application boundary must remain framework-neutral: AgentScope, LangGraph, Eino, and Mastra continue to integrate through the existing runtime contract rather than through Vercel-specific runtime semantics.

## LLM boundary

Model invocation is exposed through a provider-agnostic LLM gateway interface. The Vercel request path and worker path depend on that interface rather than on a concrete model provider SDK. Provider credentials remain deployment secrets/configuration and are never persisted into run state.

The gateway is intentionally an interface boundary in this task; no production model provider is introduced merely to satisfy deployment validation.

## Request/data flow

1. Vercel receives a stateless application request.
2. The request boundary authenticates/validates input and invokes platform-core APIs through stable interfaces.
3. Durable state is read/written through platform-owned repositories/services.
4. Work that can outlive the request is represented by persisted state and/or an outbox record and is processed by the independently deployed worker.
5. The worker performs recovery/retry and external effect execution under the existing permission and idempotency rules.
6. The Vercel boundary never assumes that a request process remains alive after returning a response.

## Explicit forbidden dependencies

The Vercel boundary must not:

- run the recovery worker loop;
- claim or renew recovery leases;
- publish the transactional outbox directly as its durable responsibility;
- keep in-memory process state as the authoritative run state;
- depend on a request staying alive for tool execution or crash recovery;
- bypass the existing permission/idempotency/outbox services;
- embed a concrete LLM provider into the application-facing contract.

## Environment/deployment contract

The deployment contract will define:

- `DATABASE_URL`: PostgreSQL connection for durable platform state;
- `REDIS_URL`: optional Redis coordination/queue connection where required;
- `LLM_GATEWAY_URL`: optional external gateway endpoint when the gateway is separately deployed;
- `LLM_PROVIDER_API_KEY`: provider credential supplied only to the deployment that actually invokes the provider, never persisted as run data;
- `WORKER_ENDPOINT`: optional internal control-plane address for explicitly asynchronous handoff, without making the worker a Vercel request-lifetime dependency.

The implementation will distinguish required-at-startup variables from optional variables and will fail closed when a required boundary variable is absent.

## Failure semantics

- A Vercel request timeout or process termination does not imply loss of durable work.
- A request that creates durable work may return an accepted/persisted result before asynchronous processing completes.
- Worker crash is handled by the existing recovery/lease mechanism.
- Duplicate delivery is handled by the existing idempotency/outbox semantics.
- LLM gateway failure is surfaced as a retryable/final application error according to the caller's execution context; it does not create a second source of durable state.
- Missing or invalid deployment configuration fails startup/request validation rather than silently selecting an unsafe default.

## Testing strategy

TDD starts with a deployment-boundary contract test that fails if a Vercel entrypoint imports or invokes worker-only capabilities. Additional tests cover:

1. required/optional environment configuration;
2. request-to-runtime delegation without owning durable execution;
3. provider-agnostic LLM gateway delegation;
4. asynchronous handoff semantics that do not require request lifetime;
5. explicit rejection of worker-only operations from the Vercel boundary;
6. typecheck/build validation for the Vercel-facing application boundary.

No real Vercel credentials or production deployment is required. CI validates the boundary and build contract; production deployment remains an operational concern.

## Documentation deliverables

The implementation will document:

- local Compose versus Vercel deployment topology;
- which capabilities belong to Vercel versus the durable worker;
- environment variables and secret ownership;
- request timeout/crash semantics;
- LLM gateway/provider separation;
- the fact that Vercel is an application edge, not the durable execution runtime.

## Non-goals

- Do not introduce a fake production API, web app, or model provider solely for deployment cosmetics.
- Do not migrate PostgreSQL or Redis into Vercel-managed request execution.
- Do not deploy the worker through Vercel Functions.
- Do not add provider-specific business logic to the Runtime Contract.
- Do not change the permission, idempotency, outbox, or recovery semantics already implemented by platform core.
