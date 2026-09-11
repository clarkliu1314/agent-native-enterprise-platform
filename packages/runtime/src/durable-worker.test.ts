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
  it('consumes only agent.run messages and delegates execution to RuntimeFacade', async () => {
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
