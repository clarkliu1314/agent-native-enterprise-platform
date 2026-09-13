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
  it('propagates durable correlation context and emits run lifecycle events', async () => {
    const runtime = baseRuntime();
    const events: unknown[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const options = {
      owner: 'worker-1', now: () => new Date(0), executionSliceMs: 100,
      logger, correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1', agentId: 'investment-worker' } as CorrelationContext,
    } as any;
    const worker = new DurableWorker(runtime, consumer, options);

    await worker.start();
    await handler?.({ topic: 'agent.run', payload: { runId: 'run-1' } });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'run.started' }),
      expect.objectContaining({ event: 'run.succeeded' }),
    ]));
    const lifecycle = events.filter((entry): entry is { context: CorrelationContext } => typeof entry === 'object' && entry !== null && 'context' in entry);
    expect(lifecycle.every((entry) => entry.context.traceId === 'trace-1' && entry.context.tenantId === 'tenant-1' && entry.context.runId === 'run-1')).toBe(true);
  });
});
