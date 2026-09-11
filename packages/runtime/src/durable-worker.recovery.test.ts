import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import type { QueueConsumer } from './ports';
import { DurableWorker } from './durable-worker';

const baseRuntime = (): RuntimeFacade => ({
  createRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), executeRunBounded: vi.fn(),
  getRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
});

describe('DurableWorker reclaimed execution', () => {
  it('passes recovery fencing ownership to the internal runtime boundary', async () => {
    const runtime = baseRuntime() as RuntimeFacade & {
      executeClaimedRunBounded: ReturnType<typeof vi.fn>;
    };
    runtime.executeClaimedRunBounded = vi.fn().mockResolvedValue({ run: { state: 'RUNNING' }, terminal: false });
    const consumer: QueueConsumer = { consume: vi.fn().mockResolvedValue(undefined) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', now: () => new Date(0), executionSliceMs: 100 });

    await worker.process('run-1', 'recovery:owner', '7');

    expect(runtime.executeClaimedRunBounded).toHaveBeenCalledWith(
      { runId: 'run-1', owner: 'recovery:owner', fencingToken: 7n },
      new Date(100),
    );
    expect(runtime.executeRunBounded).not.toHaveBeenCalled();
  });

  it('uses the normal durable claim path for ordinary queue work', async () => {
    const runtime = baseRuntime();
    const consumer: QueueConsumer = { consume: vi.fn().mockResolvedValue(undefined) };
    const worker = new DurableWorker(runtime, consumer, { owner: 'worker-1', now: () => new Date(0), executionSliceMs: 100 });

    await worker.process('run-1');

    expect(runtime.executeRunBounded).toHaveBeenCalledWith('run-1', 'worker-1', new Date(100));
  });
});
