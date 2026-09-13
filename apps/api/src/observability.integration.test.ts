import { describe, expect, it, vi } from 'vitest';
import { MemoryObservabilityMetrics, type ObservabilityLogger } from '@agent-native/observability';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { createDurableHandler } from './durable-handler';

const run = {
  runId: 'run-1',
  agentId: 'agent-1',
  state: 'QUEUED' as const,
  input: {},
  metadata: {},
  fencingToken: 0n,
  attempt: 0,
  createdAt: new Date(0).toISOString(),
};

describe('API observability wiring', () => {
  it('emits api.accepted and injects correlation metadata into the durable command', async () => {
    const logger: ObservabilityLogger = { emit: vi.fn() };
    const metrics = new MemoryObservabilityMetrics();
    const runtime: RuntimeFacade = {
      createRun: vi.fn(async (command) => {
        expect(command.metadata).toMatchObject({
          requestId: 'req-1',
          traceId: 'trace-1',
          tenantId: 'tenant-1',
        });
        return { run, replayed: false };
      }),
      executeRunBounded: vi.fn(),
      getRun: vi.fn(),
      resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
    } as unknown as RuntimeFacade;

    const response = await createDurableHandler(runtime, { logger, metrics })(new Request('https://example.test/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-1', 'x-trace-id': 'trace-1', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ agentId: 'agent-1', input: { company: 'safe-id' } }),
    }));

    expect(response.status).toBe(202);
    expect(logger.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'api.accepted', context: expect.objectContaining({ requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1' }) }));
    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'counter', name: 'agent_run_started_total' }),
    ]));
  });

  it('keeps business admission successful when telemetry fails', async () => {
    const logger: ObservabilityLogger = { emit: () => { throw new Error('telemetry down'); } };
    const runtime = {
      createRun: vi.fn(async () => ({ run, replayed: false })),
      executeRunBounded: vi.fn(),
      getRun: vi.fn(),
      resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
    } as unknown as RuntimeFacade;

    const response = await createDurableHandler(runtime, { logger })(new Request('https://example.test/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-2', 'x-trace-id': 'trace-2', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ agentId: 'agent-1', input: {} }),
    }));

    expect(response.status).toBe(202);
    expect(runtime.createRun).toHaveBeenCalledOnce();
  });
});
