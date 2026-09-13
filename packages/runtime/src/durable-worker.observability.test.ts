import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import type { QueueConsumer } from './ports';
import { DurableWorker } from './durable-worker';
import type { CorrelationContext, ObservabilityLogger } from '@agent-native/observability';

const baseRuntime = (): RuntimeFacade => ({
  createRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), executeRunBounded: vi.fn().mockResolvedValue({
    run: {
      runId: 'run-1', agentId: 'investment-worker', state: 'SUCCEEDED', input: {}, metadata: {}, fencingToken: 1n,
      attempt: 1, createdAt: new Date(0).toISOString(),
    },
    terminal: true,
  }),
  getRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
});

describe('DurableWorker observability', () => {
  it('uses durable message correlation and permits a new delivery request id', async () => {
    const runtime = baseRuntime();
    const events: any[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, {
      owner: 'worker-1', now: () => new Date(0), executionSliceMs: 100,
      logger,
      correlation: { requestId: 'stale-memory', traceId: 'stale-memory', tenantId: 'stale-memory', runId: 'stale-memory' } as CorrelationContext,
    });

    await worker.start();
    await handler?.({
      topic: 'agent.run',
      payload: {
        runId: 'run-1',
        correlation: { requestId: 'delivery-2', traceId: 'trace-durable', tenantId: 'tenant-1', runId: 'run-1', agentId: 'investment-worker' },
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'run.started', context: expect.objectContaining({ requestId: 'delivery-2', traceId: 'trace-durable' }) }),
      expect.objectContaining({ event: 'run.succeeded', context: expect.objectContaining({ requestId: 'delivery-2', traceId: 'trace-durable' }) }),
    ]));
  });
});
