import { classifyError, createStructuredLogEvent, safeEmit, safeMetric, type CorrelationContext, type ObservabilityLogger, type ObservabilityMetrics } from '@agent-native/observability';

export interface OutboxMessage { eventId: string; eventType: string; payload: unknown; correlation?: CorrelationContext; }
export interface OutboxRepository {
  claim(limit: number, workerId: string): Promise<OutboxMessage[]>;
  markPublished(eventId: string, workerId: string): Promise<void>;
  release(eventId: string, workerId: string, error: unknown): Promise<void>;
}
export type OutboxTransport = (message: OutboxMessage) => Promise<void>;
export interface OutboxObservabilityOptions { logger?: ObservabilityLogger; metrics?: ObservabilityMetrics; correlation?: CorrelationContext; }

export class OutboxPublisher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly transport: OutboxTransport,
    private readonly observability: OutboxObservabilityOptions = {},
  ) {}

  async publishBatch(limit = 100, workerId = 'outbox-worker'): Promise<number> {
    const messages = await this.repository.claim(limit, workerId);
    let published = 0;
    for (const message of messages) {
      const context = message.correlation ?? this.observability.correlation;
      try {
        await this.transport(message);
        await this.repository.markPublished(message.eventId, workerId);
        published += 1;
        safeMetric(() => this.observability.metrics?.increment('agent_outbox_publish_total', 1, { outcome: 'PUBLISHED' }));
        if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
          context, event: 'outbox.published', level: 'INFO', outcome: 'PUBLISHED',
          attributes: { eventType: message.eventType },
        }));
      } catch (error) {
        await this.repository.release(message.eventId, workerId, error);
        const errorCode = classifyError(error) === 'INTERNAL_ERROR' ? 'OUTBOX_PUBLISH_FAILED' : classifyError(error);
        safeMetric(() => this.observability.metrics?.increment('agent_outbox_publish_failed_total', 1, { error_code: errorCode }));
        if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
          context, event: 'outbox.failed', level: 'ERROR', outcome: 'FAILED',
          errorCode, attributes: { eventType: message.eventType },
        }));
      }
    }
    return published;
  }
}
