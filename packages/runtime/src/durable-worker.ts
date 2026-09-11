import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import type { QueueConsumer } from './ports';

export interface DurableWorkerOptions {
  owner: string;
  executionSliceMs?: number;
  now?: () => Date;
  heartbeat?: {
    start(input: { runId: string; owner: string; fencingToken: bigint }): { stop(): void };
  };
}

export interface DurableRunMessage {
  runId: string;
  owner?: string;
  fencingToken?: string;
}

interface ClaimedExecutionRuntime extends RuntimeFacade {
  executeClaimedRunBounded(input: { runId: string; owner: string; fencingToken: bigint }, deadlineAt: Date): Promise<unknown>;
}

/**
 * Queue-driven worker boundary. RuntimeFacade remains the execution authority;
 * reclaimed work carries its fencing token so recovery never requires a stale
 * RUNNING row to be moved back to QUEUED.
 */
export class DurableWorker {
  private readonly executionSliceMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly runtime: RuntimeFacade,
    private readonly consumer: QueueConsumer,
    private readonly options: DurableWorkerOptions,
  ) {
    this.executionSliceMs = options.executionSliceMs ?? 20_000;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.consumer.consume(async (message) => {
      const payload = message.payload as Partial<DurableRunMessage>;
      if (message.topic !== 'agent.run' || typeof payload.runId !== 'string' || payload.runId.length === 0) return;
      await this.process(payload.runId, payload.owner, payload.fencingToken);
    });
  }

  async process(runId: string, claimedOwner?: string, fencingToken?: string): Promise<void> {
    const deadlineAt = new Date(this.now().getTime() + this.executionSliceMs);
    if (claimedOwner && fencingToken) {
      const token = BigInt(fencingToken);
      const claimedRuntime = this.runtime as ClaimedExecutionRuntime;
      if (typeof claimedRuntime.executeClaimedRunBounded === 'function') {
        await claimedRuntime.executeClaimedRunBounded({ runId, owner: claimedOwner, fencingToken: token }, deadlineAt);
        return;
      }
    }
    await this.runtime.executeRunBounded(runId, this.options.owner, deadlineAt);
  }
}
