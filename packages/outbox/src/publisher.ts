import { createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger } from '@agent-native/observability';

export interface OutboxMessage { eventId: string; eventType: string; payload: unknown; }
export interface OutboxRepository {
  claim(limit: number, workerId: string): Promise<OutboxMessage[]>;
  markPublished(eventId: string, workerId: string): Promise<void>;
  release(eventId: string, workerId: string, error: unknown): Promise<void>;
}
export type OutboxTransport = (message: OutboxMessage) => Promise<void>;
export interface OutboxObservabilityOptions { logger?: ObservabilityLogger; correlation?: CorrelationContext; }

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
      try {
        await this.transport(message);
        await this.repository.markPublished(message.eventId, workerId);
        published += 1;
        if (this.observability.logger && this.observability.correlation) safeEmit(this.observability.logger, createStructuredLogEvent({
          context: this.observability.correlation, event: 'outbox.published', level: 'INFO', outcome: 'PUBLISHED',
          attributes: { eventType: message.eventType },
        }));
      } catch (error) {
        await this.repository.release(message.eventId, workerId, error);
        if (this.observability.logger && this.observability.correlation) safeEmit(this.observability.logger, createStructuredLogEvent({
          context: this.observability.correlation, event: 'outbox.failed', level: 'ERROR', outcome: 'FAILED',
          errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR', attributes: { eventType: message.eventType },
        }));
      }
    }
    return published;
  }
}
