import { describe, expect, it } from 'vitest';

describe('production observability correlation gate', () => {
  it('uses the production API handler, worker, tool service, and outbox publisher as one correlated chain', async () => {
    const { runProductionObservabilityScenario } = await import('./observability.e2e.js');

    const result = await runProductionObservabilityScenario({
      requestId: 'req-prod-e2e-1',
      traceId: 'trace-prod-e2e-1',
      tenantId: 'fund-prod-1',
      runId: 'run-prod-e2e-1',
      toolName: 'crm.create_company',
      secretInput: 'production-secret-must-not-be-logged',
    });

    expect(result.httpStatus).toBe(200);
    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.events.map((event) => event.event)).toEqual([
      'api.accepted',
      'run.started',
      'tool.started',
      'tool.succeeded',
      'outbox.published',
      'run.succeeded',
    ]);

    const contexts = result.events.map((event) => event.context);
    expect(new Set(contexts.map((context) => context.requestId))).toEqual(
      new Set(['req-prod-e2e-1', 'delivery-req-prod-e2e-1']),
    );
    expect(new Set(contexts.map((context) => context.traceId))).toEqual(new Set(['trace-prod-e2e-1']));
    expect(new Set(contexts.map((context) => context.tenantId))).toEqual(new Set(['fund-prod-1']));
    const runScopedContexts = contexts.filter((context) => context.runId !== undefined);
    expect(new Set(runScopedContexts.map((context) => context.runId))).toEqual(new Set(['run-prod-e2e-1']));
    expect(contexts.find((context) => context.runId === undefined)).toBeDefined();
    expect(result.serializedTelemetry).not.toContain('production-secret-must-not-be-logged');
  });

  it('keeps the production business path successful when every telemetry emission fails', async () => {
    const { runProductionObservabilityScenario } = await import('./observability.e2e.js');

    const result = await runProductionObservabilityScenario({
      requestId: 'req-prod-e2e-2',
      traceId: 'trace-prod-e2e-2',
      tenantId: 'fund-prod-1',
      runId: 'run-prod-e2e-2',
      failTelemetry: true,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.telemetryErrors).toBeGreaterThanOrEqual(4);
  });
});
