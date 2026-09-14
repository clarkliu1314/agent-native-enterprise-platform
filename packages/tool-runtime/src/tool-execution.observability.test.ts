import { describe, expect, it } from 'vitest';
import { MemoryObservabilityMetrics, type ObservabilityLogger } from '@agent-native/observability';
import { ToolExecutionService, type ToolExecutionRequest } from './tool-execution';

describe('ToolExecutionService observability', () => {
  it('emits tool lifecycle events without exposing input or output payloads', async () => {
    const events: unknown[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    const request: ToolExecutionRequest = {
      tool: { name: 'lookup-company', description: 'lookup', sideEffect: false },
      input: { secret: 'do-not-log' },
      context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['tool:read'] },
      idempotencyKey: 'idem-1',
    };
    const service = new ToolExecutionService(
      { authorize: async () => true, execute: async () => ({ result: 'safe-output' }) },
      { logger, correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', agentId: 'investment-worker' } },
    );

    await service.execute(request);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'tool.started' }),
      expect.objectContaining({ event: 'tool.succeeded' }),
    ]));
    expect(JSON.stringify(events)).not.toContain('do-not-log');
    expect(JSON.stringify(events)).not.toContain('safe-output');
  });

  it('records canonical execution metrics', async () => {
    const metrics = new MemoryObservabilityMetrics();
    const request: ToolExecutionRequest = {
      tool: { name: 'lookup-company', description: 'lookup', sideEffect: false },
      input: {},
      context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['tool:read'] },
      idempotencyKey: 'idem-metrics-1',
    };
    const service = new ToolExecutionService(
      { authorize: async () => true, execute: async () => ({ ok: true }) },
      { metrics },
    );

    await service.execute(request);

    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent_tool_execution_total', labels: expect.objectContaining({ tool: 'lookup-company', outcome: 'SUCCEEDED' }) }),
    ]));
  });
});
