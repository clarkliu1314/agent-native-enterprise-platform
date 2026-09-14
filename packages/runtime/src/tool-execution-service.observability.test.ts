import { describe, expect, it, vi } from 'vitest';
import { MemoryObservabilityMetrics } from '@agent-native/observability';
import { ToolExecutionService } from './tool-execution-service';

describe('runtime ToolExecutionService metrics', () => {
  it('records canonical success metrics without correlation labels', async () => {
    const metrics = new MemoryObservabilityMetrics();
    const repos = {
      getToolCall: vi.fn().mockResolvedValue(null),
      createToolCall: vi.fn().mockResolvedValue(undefined),
      completeToolCall: vi.fn().mockResolvedValue(true),
    };
    const service = new ToolExecutionService(
      repos as any,
      { authorize: vi.fn().mockResolvedValue(true) },
      { invoke: vi.fn().mockResolvedValue({ ok: true }) },
      { metrics },
    );

    await service.execute({
      runId: 'run-1', agentId: 'investment-worker', owner: 'worker-1', fencingToken: 1n,
      toolCallId: 'tool-1', toolName: 'crm.create_company', kind: 'SIDE_EFFECTING', input: {}, idempotencyKey: 'idem-1',
    });

    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent_tool_execution_total', labels: { tool: 'crm.create_company', outcome: 'SUCCEEDED' } }),
    ]));
  });
});
