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
}

/**
 * Queue-driven worker boundary. RuntimeFacade remains the execution authority;
 * the optional heartbeat is infrastructure-owned and fenced by the claimed token.
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
      await this.process(payload.runId);
    });
  }

  async process(runId: string): Promise<void> {
    const deadlineAt = new Date(this.now().getTime() + this.executionSliceMs);
    await this.runtime.executeRunBounded(runId, this.options.owner, deadlineAt);
  }
}
