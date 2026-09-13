import { describe, expect, it } from 'vitest';

describe('observability end-to-end contract', () => {
  it('propagates one trace across API, runtime, tool, and outbox lifecycle events', async () => {
    const { runObservabilityScenario } = await import('../packages/observability/src/e2e.js');

    const result = await runObservabilityScenario({
      requestId: 'req-e2e-1',
      traceId: 'trace-e2e-1',
      tenantId: 'fund-1',
      runId: 'run-e2e-1',
      toolName: 'crm.create_company',
      toolInput: { name: 'must-not-be-logged' },
    });

    expect(result.events.map((event) => event.event)).toEqual([
      'api.accepted',
      'run.started',
      'tool.started',
      'tool.succeeded',
      'outbox.published',
    ]);
    expect(new Set(result.events.map((event) => event.context.traceId))).toEqual(
      new Set(['trace-e2e-1']),
    );
    expect(new Set(result.events.map((event) => event.context.tenantId))).toEqual(
      new Set(['fund-1']),
    );
    expect(result.serializedTelemetry).not.toContain('must-not-be-logged');
  });

  it('preserves successful business execution when telemetry is unavailable', async () => {
    const { runObservabilityScenario } = await import('../packages/observability/src/e2e.js');

    const result = await runObservabilityScenario({
      requestId: 'req-e2e-2',
      traceId: 'trace-e2e-2',
      tenantId: 'fund-1',
      runId: 'run-e2e-2',
      failTelemetry: true,
    });

    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.telemetryErrors).toBeGreaterThan(0);
  });
});
