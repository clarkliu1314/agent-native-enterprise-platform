import { describe, expect, it } from 'vitest';
import { runObservabilityScenario, runProductionObservabilityScenario } from './observability.e2e.js';

describe('observability end-to-end contract', () => {
  it('propagates one trace across API, runtime, tool, and outbox lifecycle events', async () => {
    const result = await runObservabilityScenario({ requestId: 'req-e2e-1', traceId: 'trace-e2e-1', tenantId: 'fund-1', runId: 'run-e2e-1', toolName: 'crm.create_company', toolInput: { name: 'must-not-be-logged' } });
    expect(result.events.map((event) => event.event)).toEqual(['api.accepted', 'run.started', 'tool.started', 'tool.succeeded', 'outbox.published']);
    expect(new Set(result.events.map((event) => event.context.traceId))).toEqual(new Set(['trace-e2e-1']));
    expect(new Set(result.events.map((event) => event.context.tenantId))).toEqual(new Set(['fund-1']));
    expect(result.serializedTelemetry).not.toContain('must-not-be-logged');
  });

  it('preserves successful business execution when telemetry is unavailable', async () => {
    const result = await runObservabilityScenario({ requestId: 'req-e2e-2', traceId: 'trace-e2e-2', tenantId: 'fund-1', runId: 'run-e2e-2', failTelemetry: true });
    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.telemetryErrors).toBeGreaterThan(0);
  });

  it('proves production API-to-worker-to-tool-to-outbox correlation and fail-open telemetry', async () => {
    const result = await runProductionObservabilityScenario({ requestId: 'req-prod-1', traceId: 'trace-prod-1', tenantId: 'fund-prod-1', runId: 'run-prod-1', toolName: 'crm.create_company', secretInput: 'production-secret' });
    expect(result.httpStatus).toBe(200);
    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.events.map((event) => event.event)).toEqual(['api.accepted', 'run.started', 'tool.started', 'tool.succeeded', 'outbox.published', 'run.succeeded']);
    expect(new Set(result.events.map((event) => event.context.traceId))).toEqual(new Set(['trace-prod-1']));
    expect(new Set(result.events.map((event) => event.context.tenantId))).toEqual(new Set(['fund-prod-1']));
    expect(new Set(result.events.map((event) => event.context.runId))).toEqual(new Set(['run-prod-1']));
    expect(result.serializedTelemetry).not.toContain('production-secret');
  });

  it('keeps production business success when the telemetry backend throws', async () => {
    const result = await runProductionObservabilityScenario({ requestId: 'req-prod-2', traceId: 'trace-prod-2', tenantId: 'fund-prod-1', runId: 'run-prod-2', failTelemetry: true });
    expect(result.httpStatus).toBe(200);
    expect(result.businessResult).toEqual({ status: 'SUCCEEDED' });
    expect(result.telemetryErrors).toBeGreaterThan(0);
  });
});
