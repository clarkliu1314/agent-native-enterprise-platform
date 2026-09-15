import { describe, expect, it, vi } from 'vitest';
import { DurableWorker } from './durable-worker';

describe('durable worker concurrency contract', () => {
  it('never exceeds the configured process-local concurrency bound', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const process = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
    });

    const runtime = {
      executeRunBounded: process,
      getRun: vi.fn(async () => undefined),
    } as any;
    const messages = Array.from({ length: 3 }, (_, index) => ({ topic: 'agent.run', payload: { runId: `run-${index}` } }));
    const consumer = {
      consume: async (handler: any) => {
        await Promise.all(messages.map(handler));
      },
    } as any;

    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', maxConcurrency: 2 });
    const started = worker.start();
    await vi.waitFor(() => expect(peak).toBe(2));
    release();
    await started;
    expect(process).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects invalid concurrency configuration', () => {
    const runtime = { executeRunBounded: vi.fn(), getRun: vi.fn() } as any;
    const consumer = { consume: vi.fn() } as any;
    expect(() => new DurableWorker(runtime, consumer, { owner: 'worker-1', maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => new DurableWorker(runtime, consumer, { owner: 'worker-1', maxConcurrency: 1.5 })).toThrow(RangeError);
  });
});
