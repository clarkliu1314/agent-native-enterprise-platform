import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { classifyError, createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger } from '@agent-native/observability';
import type { QueueConsumer } from './ports';

export interface DurableWorkerOptions {
  owner: string;
  executionSliceMs?: number;
  now?: () => Date;
  heartbeat?: {
    start(input: { runId: string; owner: string; fencingToken: bigint }): { stop(): void };
  };
  logger?: ObservabilityLogger;
  correlation?: CorrelationContext;
}

export interface DurableRunMessage { runId: string; correlation?: CorrelationContext; }

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
      await this.process(payload.runId, payload.correlation);
    });
  }

  async process(runId: string, messageCorrelation?: CorrelationContext): Promise<void> {
    const startedAt = this.now();
    const baseContext = messageCorrelation ?? this.options.correlation;
    const context = baseContext ? { ...baseContext, runId } : undefined;
    if (this.options.logger && context) {
      safeEmit(this.options.logger, createStructuredLogEvent({ context, event: 'run.started', level: 'INFO', outcome: 'STARTED' }));
    }
    const deadlineAt = new Date(startedAt.getTime() + this.executionSliceMs);
    try {
      await this.runtime.executeRunBounded(runId, this.options.owner, deadlineAt);
      if (this.options.logger && context) safeEmit(this.options.logger, createStructuredLogEvent({
        context, event: 'run.succeeded', level: 'INFO', outcome: 'SUCCEEDED',
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
      }));
    } catch (error) {
      if (this.options.logger && context) safeEmit(this.options.logger, createStructuredLogEvent({
        context, event: 'run.failed', level: 'ERROR', outcome: 'FAILED',
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
        errorCode: classifyError(error),
      }));
      throw error;
    }
  }
}
