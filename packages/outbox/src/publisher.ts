export interface OutboxMessage {
  eventId: string;
  eventType: string;
  payload: unknown;
}

export interface OutboxRepository {
  /** Claim unpublished messages so concurrent workers do not process the same row concurrently. */
  claim(limit: number): Promise<OutboxMessage[]>;
  /** Mark a message published only after the broker confirms acceptance. */
  markPublished(eventId: string): Promise<void>;
  /** Release a failed claim so the message can be retried. */
  release(eventId: string, error: unknown): Promise<void>;
}

export type OutboxTransport = (message: OutboxMessage) => Promise<void>;

/**
 * At-least-once outbox publisher.
 *
 * The critical ordering is transport -> durable acknowledgement. A process crash between
 * those operations may produce a duplicate broker delivery, so consumers must be
 * idempotent. The publisher intentionally never claims exactly-once semantics across two
 * independent systems.
 */
export class OutboxPublisher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly transport: OutboxTransport,
  ) {}

  async publishBatch(limit = 100): Promise<number> {
    const messages = await this.repository.claim(limit);
    let published = 0;

    for (const message of messages) {
      try {
        await this.transport(message);
        await this.repository.markPublished(message.eventId);
        published += 1;
      } catch (error) {
        // The event remains unpublished and is explicitly released for a later retry.
        // This covers both transport failures and acknowledgement failures. If the
        // transport succeeded but the acknowledgement failed, a duplicate is possible;
        // that is the expected at-least-once trade-off and requires consumer idempotency.
        await this.repository.release(message.eventId, error);
      }
    }

    return published;
  }
}
