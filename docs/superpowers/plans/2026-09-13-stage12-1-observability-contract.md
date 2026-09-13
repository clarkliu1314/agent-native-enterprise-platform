# Stage 12.1 Observability Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a framework-neutral production observability contract with correlation, structured logs, metrics, sensitive-data protection, failure isolation, and end-to-end propagation.

**Architecture:** Keep telemetry outside the durable business state machine. Define small interfaces in a framework-neutral package, provide deterministic sanitization and in-memory test adapters, then wire correlation through application/runtime/tool/outbox boundaries without introducing a vendor SDK. Durable recovery/outbox records retain only the minimum continuation context required by existing asynchronous boundaries.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, existing RuntimeFacade/Application/ToolExecution/Outbox packages, PostgreSQL integration tests where persistence propagation is required.

**Spec:** `docs/superpowers/specs/2026-09-13-stage12-1-observability-contract.md`

## Global Constraints

- PostgreSQL remains the durable source of truth; telemetry is not a state store.
- Runtime/domain contracts remain framework-neutral and vendor-neutral.
- Redis remains delivery/scheduling only.
- Telemetry failure must not change durable business outcomes.
- Prompts, tool payloads, credentials, authorization material, and arbitrary domain objects are never serialized into telemetry.
- Metric labels are bounded-cardinality and never contain requestId, traceId, runId, or arbitrary user input.
- Existing 64/64 benchmark semantics and all existing durability invariants remain unchanged.
- TDD is mandatory: every behavior starts with a failing test.

## File Map

Create or modify only the following responsibilities unless tests reveal an existing boundary that must be extended:

- Create `packages/observability/src/index.ts`: framework-neutral correlation, logging, metrics, error-code, and sanitization contracts.
- Create `packages/observability/src/sanitizer.ts`: deterministic scalar allow-list sanitizer and secret-key filtering.
- Create `packages/observability/src/testing.ts`: in-memory logger/metrics adapters used by contract tests and integration tests.
- Create `packages/observability/src/*.test.ts`: unit-level contract tests for context, sanitizer, logger, metrics, and failure isolation.
- Modify workspace package manifests only as required to expose `@agent-native/observability` without introducing a telemetry vendor dependency.
- Modify application/runtime/tool/recovery/outbox composition boundaries only where correlation context must be accepted or propagated.
- Create `tests/observability.e2e.test.ts`: end-to-end correlation and telemetry-failure isolation test using the real application/runtime/tool/outbox path.
- Modify `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md` only after final verification to record Stage 12.1 evidence.

### Task 1: Establish the RED contract

**Files:**
- Create: `packages/observability/src/index.test.ts`
- Create: `packages/observability/src/sanitizer.test.ts`
- Create: `packages/observability/src/testing.test.ts`
- Create: `tests/observability.e2e.test.ts`

**Interfaces:**
- Tests target the exact contracts in the Stage 12.1 specification: `CorrelationContext`, `StructuredLogEvent`, `ObservabilityLogger`, `ObservabilityMetrics`, stable error codes, sanitizer behavior, and propagation/failure-isolation behavior.
- No production implementation is added in this task beyond package scaffolding needed for Vitest discovery.

- [ ] **Step 1: Create the observability package test scaffolding**

Add the package test files and write tests for these exact behaviors:

```ts
it('requires request and trace correlation for every lifecycle event', () => {
  const context = {
    requestId: 'req-1',
    traceId: 'trace-1',
    tenantId: 'fund-1',
    runId: 'run-1',
  };
  const event = makeLifecycleEvent(context, 'run.started');
  expect(event.context).toEqual(context);
  expect(event.event).toBe('run.started');
});

it('drops prompts, tool payloads, and credential-like fields', () => {
  const result = sanitizeAttributes({
    state: 'RUNNING',
    prompt: 'secret prompt',
    input: { password: 'secret' },
    apiKey: 'secret-key',
    durationMs: 12,
  });
  expect(result).toEqual({ state: 'RUNNING', durationMs: 12 });
});

it('rejects unbounded metric labels', () => {
  expect(() => validateMetricLabels({ runId: 'run-1' })).toThrow('unbounded metric label');
});

it('does not fail business execution when telemetry throws', async () => {
  const result = await executeWithObservabilityFailure(async () => ({ ok: true }));
  expect(result).toEqual({ ok: true });
});
```

The E2E test must assert that the same `traceId`, tenant, and run identity are visible across application/runtime/tool/outbox lifecycle events while no payload fields appear.

- [ ] **Step 2: Run the RED gate**

Run:

```bash
pnpm exec vitest run packages/observability/src/index.test.ts packages/observability/src/sanitizer.test.ts packages/observability/src/testing.test.ts tests/observability.e2e.test.ts
```

Expected: FAIL because the observability package/contracts and wiring do not yet exist. Record the failing test names before implementation.

- [ ] **Step 3: Commit the RED gate**

```bash
git add packages/observability tests/observability.e2e.test.ts
git commit -m "test: establish Stage 12.1 observability RED gate"
```

### Task 2: Implement the framework-neutral observability contract

**Files:**
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/src/sanitizer.ts`
- Create: `packages/observability/src/testing.ts`
- Modify: package workspace manifest/package metadata as required
- Test: `packages/observability/src/index.test.ts`, `packages/observability/src/sanitizer.test.ts`, `packages/observability/src/testing.test.ts`

**Interfaces:**

```ts
export interface CorrelationContext {
  requestId: string;
  traceId: string;
  tenantId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
  actorId?: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  context: CorrelationContext;
  outcome?: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'RETRYING';
  durationMs?: number;
  errorCode?: string;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface ObservabilityLogger {
  emit(event: StructuredLogEvent): void;
}

export interface ObservabilityMetrics {
  increment(name: string, value?: number, attributes?: Record<string, string>): void;
  observe(name: string, value: number, attributes?: Record<string, string>): void;
  gauge(name: string, value: number, attributes?: Record<string, string>): void;
}
```

- [ ] **Step 1: Implement the exact context and event contracts**

Define the types, stable event names, canonical metric names, and error-code union from the specification. Keep the exports dependency-free.

- [ ] **Step 2: Implement deterministic sanitization**

`sanitizeAttributes(input: Record<string, unknown>): Record<string, string | number | boolean | null>` must recursively inspect input, drop keys matching credential/payload classes (`prompt`, `completion`, `password`, `token`, `secret`, `apiKey`, `authorization`, `cookie`, `input`, `output`, `body`, `privateKey`), reject nested arbitrary objects/arrays rather than serialize them, and preserve only scalar operational values.

- [ ] **Step 3: Implement failure-isolated test adapters**

Provide an in-memory logger and metrics collector with optional failure injection so tests can verify that telemetry exceptions are isolated from business execution.

- [ ] **Step 4: Run unit tests**

Run:

```bash
pnpm exec vitest run packages/observability/src/index.test.ts packages/observability/src/sanitizer.test.ts packages/observability/src/testing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/observability package.json pnpm-lock.yaml
 git commit -m "feat: add framework-neutral observability contract"
```

### Task 3: Wire correlation through application, runtime, recovery, tool, and outbox boundaries

**Files:**
- Modify: existing application composition boundary under `apps/api/src/`
- Modify: RuntimeFacade/runtime composition under `packages/runtime/`
- Modify: recovery continuation under `packages/durability/`
- Modify: tool execution composition under `packages/tool-runtime/`
- Modify: outbox publisher composition under `packages/outbox/`
- Test: existing package tests plus focused propagation tests next to each modified boundary

**Interfaces:**
- Application entrypoints create `CorrelationContext` with requestId, traceId, tenantId, and known actor/agent fields.
- Runtime execution accepts context and carries run/workflow/agent identity when available.
- Recovery continuation preserves traceId and tenantId while allowing a new requestId per recovery delivery.
- Tool execution emits lifecycle telemetry using context without exposing tool input/output.
- Outbox publisher consumes correlation metadata from the durable event and emits publication telemetry.

- [ ] **Step 1: Add failing boundary tests**

For each boundary, first add a test asserting the exact propagation rule. A worker recovery test must assert that a new delivery request ID does not replace the original trace ID. A tool test must assert `tool.started` and `tool.succeeded` contain correlation fields but not request payloads. An outbox test must assert publication telemetry carries the same trace ID stored with the event.

- [ ] **Step 2: Run focused tests and confirm RED**

Run the new tests individually with Vitest. Expected: FAIL only on the new propagation assertions.

- [ ] **Step 3: Implement the thinnest explicit propagation**

Pass `CorrelationContext` through existing method parameters/composition objects. Do not introduce AsyncLocalStorage as a hidden propagation mechanism and do not add vendor tracing SDKs.

- [ ] **Step 4: Persist only continuation metadata where required**

Extend existing recovery/outbox payloads only with safe scalar correlation fields needed after process boundaries. Do not add prompts, tool payloads, or credentials to durable telemetry metadata.

- [ ] **Step 5: Isolate telemetry failures**

Wrap logger/metric emission at the telemetry adapter boundary so an emitter exception is converted into local diagnostics and never changes the business result or PostgreSQL transaction outcome.

- [ ] **Step 6: Run focused and existing tests**

Run the affected package tests plus the complete existing test suite:

```bash
pnpm test
pnpm typecheck
pnpm --filter @agent-native/api typecheck
pnpm --filter @agent-native/api build
```

Expected: PASS with no changes to existing business assertions.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/runtime packages/durability packages/tool-runtime packages/outbox
 git commit -m "feat: propagate observability correlation context"
```

### Task 4: Complete the end-to-end RED-to-GREEN gate and operational safety checks

**Files:**
- Modify: `tests/observability.e2e.test.ts`
- Modify: CI configuration only if a new focused gate is needed
- Test: `tests/observability.e2e.test.ts`

**Interfaces:**
- The test must exercise the existing application/runtime/tool/outbox path rather than mocks that bypass production composition.
- Telemetry is observed through the in-memory adapter; business state remains PostgreSQL-backed where the existing integration path requires it.

- [ ] **Step 1: Complete the end-to-end assertions**

Assert all of the following in one deterministic scenario:

1. `api.accepted`, `run.started`, `tool.started`, `tool.succeeded`, and `outbox.published` are emitted.
2. The events share the same `traceId` and `tenantId`.
3. Run-specific events carry `runId`.
4. No event contains prompt, tool input/output, token, password, authorization, cookie, or credential-like values.
5. Metric labels contain no requestId/traceId/runId.
6. Injecting a logger/metric exception does not change the successful durable business result.

- [ ] **Step 2: Run the focused E2E gate**

```bash
pnpm exec vitest run tests/observability.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full 64-case benchmark**

Use the repository's existing benchmark command used by CI and require exactly `64/64` passed with zero invariant violations. Do not modify the benchmark count or pass criteria.

- [ ] **Step 4: Run the full verification suite**

```bash
pnpm test
pnpm typecheck
pnpm --filter @agent-native/api typecheck
pnpm --filter @agent-native/api build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/observability.e2e.test.ts .github/workflows/ci.yml
 git commit -m "test: verify observability propagation and failure isolation"
```

### Task 5: Review, mainline verification, and documentation closure

**Files:**
- Modify: `docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md`
- Optional: `docs/superpowers/plans/2026-09-13-stage12-1-observability-contract.md`

**Interfaces:**
- Documentation records only verified SHA/run evidence and does not claim completion from feature-branch tests alone.

- [ ] **Step 1: Review the diff for architectural leakage**

Confirm no framework/vendor SDK types cross framework-neutral contracts, no sensitive payload is logged or persisted, no metric uses high-cardinality IDs, and no telemetry call can alter transaction success/failure.

- [ ] **Step 2: Run CI on the final PR head**

Require all existing hard gates plus the new observability tests to pass.

- [ ] **Step 3: Merge only after review and green checks**

Record the final merge commit SHA. Treat pre-merge runs as implementation evidence, not completion evidence.

- [ ] **Step 4: Verify the post-merge mainline run**

Require Compose smoke, Typecheck, API Typecheck, API Build, Deployment Boundary, Benchmark hard gate `64/64`, Full test, and observability E2E to be GREEN on the merge commit.

- [ ] **Step 5: Update the authoritative implementation plan**

Append Stage 12.1 status, scope, exact PR/commit/run evidence, and the final mainline verification result. Mark Stage 12.1 `CLOSED / COMPLETE` only after the post-merge run is GREEN.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/superpowers/plans/2026-09-11-agent-native-enterprise-platform.md docs/superpowers/plans/2026-09-13-stage12-1-observability-contract.md
git commit -m "docs: close Stage 12.1 observability verification"
```

## Verification Checklist

- [ ] RED Gate is committed and demonstrably failing before implementation.
- [ ] Observability contract unit tests GREEN.
- [ ] Sanitizer tests GREEN.
- [ ] Telemetry failure isolation tests GREEN.
- [ ] API → Runtime → Worker → Recovery → Tool → Outbox correlation E2E GREEN.
- [ ] No secret/prompt/tool payload leakage detected by tests.
- [ ] Metric cardinality restrictions GREEN.
- [ ] Existing 64/64 benchmark remains GREEN.
- [ ] Existing full test suite remains GREEN.
- [ ] API typecheck/build remain GREEN.
- [ ] Post-merge mainline CI is GREEN.
- [ ] Authoritative plan updated with final evidence.
