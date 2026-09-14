import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { classifyError, createStructuredLogEvent, safeEmit, safeMetric, type CorrelationContext, type ObservabilityLogger, type ObservabilityMetrics } from '@agent-native/observability';
import type { QueueConsumer } from './ports';
import type { OperationalControlService } from './operational-control';

export interface DurableWorkerOptions {
  owner: string;
  executionSliceMs?: number;
  now?: () => Date;
  heartbeat?: {
    start(input: { runId: string; owner: string; fencingToken: bigint }): { stop(): void };
  };
  operationalControl?: OperationalControlService;
  logger?: ObservabilityLogger;
  metrics?: ObservabilityMetrics;
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
    const context = baseContext
      ? { ...baseContext, runId }
      : await this.loadDurableCorrelation(runId);
    if (this.options.logger && context) {
      safeEmit(this.options.logger, createStructuredLogEvent({ context, event: 'run.started', level: 'INFO', outcome: 'STARTED' }));
    }
    safeMetric(() => this.options.metrics?.increment('agent_run_started_total', 1, { state: 'RUNNING' }));
    const deadlineAt = new Date(startedAt.getTime() + this.executionSliceMs);
    try {
      const canContinue = await this.authorizeOperationalContinuation(runId);
      if (!canContinue) return;
      await this.runtime.executeRunBounded(runId, this.options.owner, deadlineAt);
      if (this.options.logger && context) safeEmit(this.options.logger, createStructuredLogEvent({
        context, event: 'run.succeeded', level: 'INFO', outcome: 'SUCCEEDED',
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
      }));
      safeMetric(() => this.options.metrics?.increment('agent_run_completed_total', 1, { outcome: 'SUCCEEDED' }));
    } catch (error) {
      if (this.options.logger && context) safeEmit(this.options.logger, createStructuredLogEvent({
        context, event: 'run.failed', level: 'ERROR', outcome: 'FAILED',
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
        errorCode: classifyError(error),
      }));
      safeMetric(() => this.options.metrics?.increment('agent_run_failed_total', 1, { error_code: classifyError(error) }));
      throw error;
    }
  }

  private async authorizeOperationalContinuation(runId: string): Promise<boolean> {
    const control = this.options.operationalControl;
    if (!control) return true;

    const durableRun = await this.runtime.getRun(runId);
    if (!durableRun) return true;

    const tenantId = typeof durableRun.metadata?.tenantId === 'string'
      ? durableRun.metadata.tenantId
      : undefined;
    if (!tenantId) return true;

    const state = await control.getControl(tenantId, runId);
    if (state.paused) return false;

    await control.authorizeContinuation({
      tenantId,
      runId,
      fencingToken: durableRun.fencingToken,
    });
    return true;
  }

  private async loadDurableCorrelation(runId: string): Promise<CorrelationContext | undefined> {
    const durableRun = await this.runtime.getRun(runId);
    if (!durableRun) return undefined;
    return {
      requestId: typeof durableRun.metadata?.requestId === 'string' ? durableRun.metadata.requestId : `req-${runId}`,
      traceId: typeof durableRun.metadata?.traceId === 'string' ? durableRun.metadata.traceId : `trace-${runId}`,
      tenantId: typeof durableRun.metadata?.tenantId === 'string' ? durableRun.metadata.tenantId : 'unknown',
      runId: durableRun.runId,
      agentId: durableRun.agentId,
    };
  }
}
