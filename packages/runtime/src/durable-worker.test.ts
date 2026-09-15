import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import type { QueueConsumer } from './ports';
import { DurableWorker } from './durable-worker';

const runtimeDouble = (): RuntimeFacade => ({
  createRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(),
  executeRunBounded: vi.fn(async () => ({ run: {} as never, terminal: true })),
  getRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
});

describe('DurableWorker', () => {
  it('consumes only agent.run messages and lets RuntimeFacade claim with the worker owner', async () => {
    const runtime = runtimeDouble();
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', executionSliceMs: 5_000, now: () => new Date(0) });

    await worker.start();
    await handler?.({ topic: 'other', payload: { runId: 'ignored' } });
    await handler?.({ topic: 'agent.run', payload: { runId: 'run-1' } });

    expect(runtime.executeRunBounded).toHaveBeenCalledOnce();
    expect(runtime.executeRunBounded).toHaveBeenCalledWith('run-1', 'worker-1', new Date(5_000));
  });

  it('never trusts caller-supplied owner or fencing token from a queue message', async () => {
    const runtime = runtimeDouble();
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'authoritative-worker', executionSliceMs: 5_000, now: () => new Date(0) });

    await worker.start();
    await handler?.({
      topic: 'agent.run',
      payload: { runId: 'run-2', owner: 'forged-owner', fencingToken: '999999' },
    });

    expect(runtime.executeRunBounded).toHaveBeenCalledOnce();
    expect(runtime.executeRunBounded).toHaveBeenCalledWith('run-2', 'authoritative-worker', new Date(5_000));
  });

  it('defers concurrent work above maxConcurrency and resumes the next queued delivery after a slot is released', async () => {
    const runtime = runtimeDouble();
    let releaseFirst!: () => void;
    const firstExecution = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const executeRunBounded = vi.fn()
      .mockImplementationOnce(async () => firstExecution)
      .mockImplementation(async () => undefined);
    runtime.executeRunBounded = executeRunBounded;

    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', maxConcurrency: 1 });

    await worker.start();
    const first = handler?.({ topic: 'agent.run', payload: { runId: 'run-1' } });
    await Promise.resolve();
    const second = handler?.({ topic: 'agent.run', payload: { runId: 'run-2' } });
    await Promise.resolve();

    expect(executeRunBounded).toHaveBeenCalledTimes(1);
    releaseFirst();
    await first;
    await second;

    expect(executeRunBounded).toHaveBeenCalledTimes(2);
    expect(executeRunBounded).toHaveBeenNthCalledWith(1, 'run-1', 'worker-1', expect.any(Date));
    expect(executeRunBounded).toHaveBeenNthCalledWith(2, 'run-2', 'worker-1', expect.any(Date));
  });

  it('releases a saturated worker slot even when execution fails', async () => {
    const runtime = runtimeDouble();
    const executeRunBounded = vi.fn()
      .mockRejectedValueOnce(new Error('worker crash'))
      .mockResolvedValueOnce({ run: {} as never, terminal: true });
    runtime.executeRunBounded = executeRunBounded;

    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', maxConcurrency: 1 });

    await worker.start();
    await expect(handler?.({ topic: 'agent.run', payload: { runId: 'run-crash' } })).rejects.toThrow('worker crash');
    await handler?.({ topic: 'agent.run', payload: { runId: 'run-after-crash' } });

    expect(executeRunBounded).toHaveBeenCalledTimes(2);
    expect(executeRunBounded).toHaveBeenNthCalledWith(2, 'run-after-crash', 'worker-1', expect.any(Date));
  });

  it('ignores malformed runtime messages', async () => {
    const runtime = runtimeDouble();
    let handler: ((message: { topic: string; payload: unknown }) => Promise<void>) | undefined;
    const consumer: QueueConsumer = { consume: vi.fn(async (next) => { handler = next; }) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1' });

    await worker.start();
    await handler?.({ topic: 'agent.run', payload: {} });

    expect(runtime.executeRunBounded).not.toHaveBeenCalled();
  });
});
