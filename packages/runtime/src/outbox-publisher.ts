import {
  classifyError,
  createStructuredLogEvent,
  safeEmit,
  type CorrelationContext,
  type ObservabilityLogLevel,
  type ObservabilityLogger,
  type ObservabilityOutcome,
  type StableErrorCode,
} from '@agent-native/observability';
import type { QueuePublisher } from './ports';
import type { OutboxRecord, OutboxRepository } from './repositories';

export interface OutboxPublisherOptions {
  logger?: ObservabilityLogger;
}

export class OutboxPublisher {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly queue: QueuePublisher,
    private readonly maxBackoffMs = 60_000,
    private readonly options: OutboxPublisherOptions = {},
  ) {}

  async publishBatch(limit = 50): Promise<{ published: number; retried: number }> {
    const records = await this.outbox.claim(limit);
    let published = 0;
    let retried = 0;
    for (const record of records) {
      const context = readDurableCorrelation(record);
      try {
        await this.queue.publish(record.topic, record.payload);
        await this.outbox.markPublished(record.outboxId);
        published += 1;
        this.emit(context, {
          event: 'outbox.published',
          level: 'INFO',
          outcome: 'PUBLISHED',
          attributes: { outboxId: record.outboxId, eventId: record.eventId, topic: record.topic },
        });
      } catch (error) {
        const delay = Math.min(this.maxBackoffMs, 2 ** Math.min(record.attempts, 10) * 100);
        await this.outbox.scheduleRetry(record.outboxId, new Date(Date.now() + delay));
        retried += 1;
        this.emit(context, {
          event: 'outbox.retried',
          level: 'WARN',
          outcome: 'RETRYING',
          errorCode: classifyError(error),
          attributes: { outboxId: record.outboxId, eventId: record.eventId, topic: record.topic, attempts: record.attempts },
        });
      }
    }
    return { published, retried };
  }

  private emit(
    context: CorrelationContext | undefined,
    input: {
      event: string;
      level: ObservabilityLogLevel;
      outcome?: ObservabilityOutcome;
      errorCode?: StableErrorCode;
      attributes?: Record<string, unknown>;
    },
  ): void {
    if (!context || !this.options.logger) return;
    safeEmit(this.options.logger, createStructuredLogEvent({ context, ...input }));
  }
}

function readDurableCorrelation(record: OutboxRecord): CorrelationContext | undefined {
  if (!record.payload || typeof record.payload !== 'object') return undefined;
  const payload = record.payload as Record<string, unknown>;
  const raw = payload.correlation;
  if (!raw || typeof raw !== 'object') return undefined;
  const correlation = raw as Record<string, unknown>;
  if (
    typeof correlation.requestId !== 'string' ||
    typeof correlation.traceId !== 'string' ||
    typeof correlation.tenantId !== 'string'
  ) return undefined;
  return {
    requestId: correlation.requestId,
    traceId: correlation.traceId,
    tenantId: correlation.tenantId,
    ...(typeof correlation.runId === 'string' ? { runId: correlation.runId } : {}),
    ...(typeof correlation.workflowId === 'string' ? { workflowId: correlation.workflowId } : {}),
    ...(typeof correlation.agentId === 'string' ? { agentId: correlation.agentId } : {}),
    ...(typeof correlation.actorId === 'string' ? { actorId: correlation.actorId } : {}),
  };
}
