import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import type { QueueConsumer } from './ports';
import { DurableWorker } from './durable-worker';

const baseRuntime = (): RuntimeFacade => ({
  createRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), executeRunBounded: vi.fn(),
  getRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
});

describe('DurableWorker reclaimed execution', () => {
  it('uses the normal durable claim path and ignores forged queue ownership metadata', async () => {
    const runtime = baseRuntime();
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'authoritative-worker', now: () => new Date(0), executionSliceMs: 100 });

    await worker.start();
    await handler?.({
      topic: 'agent.run',
      payload: { runId: 'run-1', owner: 'forged-owner', fencingToken: '999999' },
    });

    expect(runtime.executeRunBounded).toHaveBeenCalledOnce();
    expect(runtime.executeRunBounded).toHaveBeenCalledWith('run-1', 'authoritative-worker', new Date(100));
  });

  it('uses the normal durable claim path for ordinary queue work', async () => {
    const runtime = baseRuntime();
    const consumer: QueueConsumer = { consume: vi.fn().mockResolvedValue(undefined) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', now: () => new Date(0), executionSliceMs: 100 });

    await worker.process('run-1');

    expect(runtime.executeRunBounded).toHaveBeenCalledWith('run-1', 'worker-1', new Date(100));
  });
});
