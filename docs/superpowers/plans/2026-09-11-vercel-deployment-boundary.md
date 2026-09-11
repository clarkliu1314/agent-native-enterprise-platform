# Vercel Deployment Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Vercel-facing application boundary that remains stateless and framework-neutral while durable execution, recovery, and outbox ownership remain in the platform worker.

**Architecture:** Add a small platform-owned deployment boundary package containing environment validation, a provider-agnostic LLM gateway interface, and a request-facing application service. The boundary exposes only request-safe operations and delegates durable work to existing platform services; it never imports the recovery worker loop or owns leases/outbox publication. No concrete LLM provider or fake production API is introduced.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, existing runtime/tool/durability packages, Next.js/Vercel-compatible Node request boundary, PostgreSQL/Redis configuration via environment variables.

**Spec:** `docs/superpowers/specs/2026-09-11-vercel-deployment-boundary-design.md`

## Global Constraints

- Vercel is a stateless application/request boundary only.
- Durable execution, recovery/retry, and outbox publication remain independently deployable worker responsibilities.
- PostgreSQL remains the durable source of truth; Redis is optional coordination/queue infrastructure.
- The application-facing contract remains framework-neutral.
- LLM access is provider-agnostic; provider credentials are deployment configuration and never run-state data.
- Missing required deployment configuration fails closed.
- No production provider, fake API, or worker implementation is introduced solely for deployment validation.
- No existing permission, idempotency, outbox, or recovery semantics are duplicated.
- Every production implementation change begins with a failing test.

## File Map

- Create `packages/deployment-boundary/package.json`: workspace package metadata and dependencies for the Vercel-facing boundary.
- Create `packages/deployment-boundary/src/config.ts`: required/optional environment parsing and fail-closed validation.
- Create `packages/deployment-boundary/src/llm-gateway.ts`: provider-agnostic model invocation interface and request/result types.
- Create `packages/deployment-boundary/src/application.ts`: request-safe application service that delegates to `AgentRuntime` and optional LLM gateway without importing worker-only code.
- Create `packages/deployment-boundary/src/index.ts`: public boundary exports.
- Create `packages/deployment-boundary/src/config.test.ts`: environment contract tests.
- Create `packages/deployment-boundary/src/application.test.ts`: delegation and worker-boundary tests.
- Create `packages/deployment-boundary/src/llm-gateway.test.ts`: provider-neutral gateway contract tests.
- Create `apps/api/package.json`: Vercel-compatible request application package.
- Create `apps/api/src/handler.ts`: thin request handler using deployment-boundary application service.
- Create `apps/api/src/handler.test.ts`: request/response contract tests.
- Create `apps/api/vercel.json`: explicit Vercel runtime/build boundary without worker deployment.
- Modify `.github/workflows/ci.yml`: add API typecheck/build and deployment-boundary contract verification.
- Modify `docker-compose.yml`: keep local worker ownership explicit while documenting the API boundary without fabricating a model provider.
- Modify `README.md`: document local Compose versus Vercel topology, configuration, and failure semantics.
- Modify `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`: mark Task 9 progress and verification status.

### Task 1: Deployment-boundary package contract

**Files:**
- Create: `packages/deployment-boundary/package.json`
- Create: `packages/deployment-boundary/src/config.test.ts`
- Create: `packages/deployment-boundary/src/llm-gateway.test.ts`
- Create: `packages/deployment-boundary/src/application.test.ts`

**Interfaces:**
- Produces `DeploymentConfig`, `parseDeploymentConfig(env)`, `LlmGateway`, `LlmRequest`, `LlmResponse`, and `DeploymentApplication` contracts used by later tasks.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('requires DATABASE_URL and fails closed when it is absent', () => {
  expect(() => parseDeploymentConfig({})).toThrow('DATABASE_URL');
});

it('accepts optional Redis and gateway configuration', () => {
  expect(parseDeploymentConfig({ DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://redis' }))
    .toMatchObject({ databaseUrl: 'postgres://db', redisUrl: 'redis://redis' });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run packages/deployment-boundary/src/config.test.ts`
Expected: FAIL because the package and parser do not exist.

- [ ] **Step 3: Write failing provider-neutral gateway tests**

```ts
it('delegates model invocation through the gateway contract', async () => {
  const gateway: LlmGateway = { complete: vi.fn().mockResolvedValue({ output: 'ok' }) };
  const result = await gateway.complete({ model: 'test-model', input: 'hello' });
  expect(result.output).toBe('ok');
  expect(gateway.complete).toHaveBeenCalledWith({ model: 'test-model', input: 'hello' });
});
```

- [ ] **Step 4: Run gateway tests and verify RED**

Run: `pnpm vitest run packages/deployment-boundary/src/llm-gateway.test.ts`
Expected: FAIL because the contract does not exist.

- [ ] **Step 5: Write failing application boundary tests**

```ts
it('delegates request work to the runtime and does not expose worker operations', async () => {
  const runtime = makeRuntimeDouble();
  const app = new DeploymentApplication(runtime);
  const run = await app.startRun({ agentId: 'agent-1', input: 'hello' });
  expect(run.state).toBe(RunState.CREATED);
  expect('claimRecoveryCandidate' in app).toBe(false);
  expect('publishOutbox' in app).toBe(false);
});
```

- [ ] **Step 6: Run application tests and verify RED**

Run: `pnpm vitest run packages/deployment-boundary/src/application.test.ts`
Expected: FAIL because `DeploymentApplication` does not exist.

### Task 2: Implement deployment-boundary contracts

**Files:**
- Modify: `packages/deployment-boundary/package.json`
- Create: `packages/deployment-boundary/src/config.ts`
- Create: `packages/deployment-boundary/src/llm-gateway.ts`
- Create: `packages/deployment-boundary/src/application.ts`
- Create: `packages/deployment-boundary/src/index.ts`

**Interfaces:**
- `parseDeploymentConfig(env: Record<string, string | undefined>): DeploymentConfig` requires `DATABASE_URL`; optional values are preserved; no unsafe defaults are introduced.
- `LlmGateway.complete(request: LlmRequest): Promise<LlmResponse>` is the only model-provider dependency.
- `DeploymentApplication.startRun(input)` and `getRunState(runId)` delegate to `AgentRuntime`; no recovery-worker/outbox publisher imports are permitted.

- [ ] **Step 1: Implement the minimum configuration parser**

```ts
export interface DeploymentConfig {
  databaseUrl: string;
  redisUrl?: string;
  llmGatewayUrl?: string;
  llmProviderApiKey?: string;
  workerEndpoint?: string;
}

export function parseDeploymentConfig(env: Record<string, string | undefined>): DeploymentConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    databaseUrl,
    redisUrl: env.REDIS_URL,
    llmGatewayUrl: env.LLM_GATEWAY_URL,
    llmProviderApiKey: env.LLM_PROVIDER_API_KEY,
    workerEndpoint: env.WORKER_ENDPOINT,
  };
}
```

- [ ] **Step 2: Implement the provider-neutral LLM interface**

```ts
export interface LlmRequest { model: string; input: unknown; }
export interface LlmResponse { output: unknown; }
export interface LlmGateway { complete(request: LlmRequest): Promise<LlmResponse>; }
```

- [ ] **Step 3: Implement the request-safe application service**

```ts
export class DeploymentApplication {
  constructor(private readonly runtime: AgentRuntime, private readonly llmGateway?: LlmGateway) {}
  startRun(input: StartRunInput) { return this.runtime.startRun(input); }
  getRunState(runId: string) { return this.runtime.getRunState(runId); }
  completeWithModel(request: LlmRequest) {
    if (!this.llmGateway) throw new Error('LLM gateway is not configured');
    return this.llmGateway.complete(request);
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run packages/deployment-boundary/src/*.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

### Task 3: Vercel-compatible API entrypoint

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/handler.ts`
- Create: `apps/api/src/handler.test.ts`
- Create: `apps/api/vercel.json`

**Interfaces:**
- `handler(request)` is a thin stateless request adapter.
- It validates configuration/request shape and delegates to `DeploymentApplication`.
- It does not import `RecoveryWorker`, recovery stores, lease APIs, or outbox publisher implementations.

- [ ] **Step 1: Write failing handler tests**

```ts
it('returns accepted run state without assuming request lifetime', async () => {
  const response = await handler(makeRequest({ agentId: 'agent-1', input: 'hello' }));
  expect(response.status).toBe(202);
  expect(response.body.state).toBe('CREATED');
});

it('rejects missing agent input', async () => {
  const response = await handler(makeRequest({ input: 'hello' }));
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run handler tests and verify RED**

Run: `pnpm vitest run apps/api/src/handler.test.ts`
Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the thin handler**

```ts
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await request.json() as { agentId?: string; input?: unknown };
  if (!body.agentId || !('input' in body)) return Response.json({ error: 'invalid_request' }, { status: 400 });
  const runtime = createRequestRuntime();
  const run = await new DeploymentApplication(runtime).startRun({ agentId: body.agentId, input: body.input });
  return Response.json(run, { status: 202 });
}
```

- [ ] **Step 4: Add explicit Vercel configuration**

```json
{ "functions": { "apps/api/src/handler.ts": { "runtime": "nodejs22.x" } } }
```

The configuration must not define the worker as a Vercel function.

- [ ] **Step 5: Run handler tests and typecheck**

Run: `pnpm vitest run apps/api/src/handler.test.ts && pnpm typecheck`
Expected: PASS.

### Task 4: Deployment-boundary static safety contract

**Files:**
- Modify: `packages/deployment-boundary/src/application.test.ts`
- Create: `apps/api/src/deployment-boundary.test.ts`

- [ ] **Step 1: Write a failing source-boundary test**

```ts
it('does not import worker-only modules into the API boundary', async () => {
  const source = await readFile(new URL('./handler.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/recovery-worker|recovery-store|outbox-publisher|claimRecoveryCandidate/);
});
```

- [ ] **Step 2: Run the boundary test and verify RED if the forbidden dependency is present**

Run: `pnpm vitest run apps/api/src/deployment-boundary.test.ts`
Expected: FAIL only when a worker-only dependency is introduced.

- [ ] **Step 3: Add the same invariant to package-level application tests**

Assert the public deployment-boundary exports contain only configuration, LLM gateway, and request-safe application operations.

- [ ] **Step 4: Run all boundary tests**

Run: `pnpm vitest run packages/deployment-boundary apps/api`
Expected: PASS.

### Task 5: Local topology and documentation

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Create: `docs/architecture/vercel-deployment-boundary.md`

- [ ] **Step 1: Write topology assertions before changing Compose**

Assert the local worker remains independently deployed and no worker command is placed in the API service.

- [ ] **Step 2: Run topology tests and verify RED**

Run: `pnpm vitest run tests/compose-topology.test.ts`
Expected: FAIL only for newly required API/worker boundary assertions.

- [ ] **Step 3: Add the real API service without a fake model provider**

Use the API entrypoint for request handling. Keep PostgreSQL/Redis/worker ownership unchanged. Do not add a mock LLM service merely to satisfy Compose.

- [ ] **Step 4: Document configuration and failure semantics**

Document required `DATABASE_URL`, optional `REDIS_URL`, optional `LLM_GATEWAY_URL`, provider secret ownership, optional `WORKER_ENDPOINT`, request timeout behavior, durable async handoff, worker crash recovery, and duplicate delivery semantics.

- [ ] **Step 5: Run Compose config validation**

Run: `docker compose config`
Expected: PASS with API and worker as separate services.

### Task 6: CI verification and plan status

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`

- [ ] **Step 1: Add API package typecheck/build to CI**

Run API typecheck/build independently from worker smoke. The job must not require real Vercel credentials.

- [ ] **Step 2: Add deployment-boundary tests to CI**

Run `pnpm vitest run packages/deployment-boundary apps/api` before Compose smoke.

- [ ] **Step 3: Update the master plan status**

Mark Task 9 complete only after focused tests, full tests, typecheck, API build, Compose validation, and CI all pass.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
pnpm typecheck
pnpm test
docker compose config
```

Expected: all commands PASS.

- [ ] **Step 5: Commit each independently testable task**

Use focused commit messages such as `test: establish deployment boundary contract`, `feat: add Vercel request boundary`, and `docs: document Vercel deployment topology`.
