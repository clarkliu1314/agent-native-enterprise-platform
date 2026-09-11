import type { QueuePublisher } from './ports';
import type { OutboxRepository } from './repositories';

export class OutboxPublisher {
  constructor(private readonly outbox: OutboxRepository, private readonly queue: QueuePublisher, private readonly maxBackoffMs = 60_000) {}

  async publishBatch(limit = 50): Promise<{ published: number; retried: number }> {
    const records = await this.outbox.claim(limit);
    let published = 0;
    let retried = 0;
    for (const record of records) {
      try {
        await this.queue.publish(record.topic, record.payload);
        await this.outbox.markPublished(record.outboxId);
        published += 1;
      } catch {
        const delay = Math.min(this.maxBackoffMs, 2 ** Math.min(record.attempts, 10) * 100);
        await this.outbox.scheduleRetry(record.outboxId, new Date(Date.now() + delay));
        retried += 1;
      }
    }
    return { published, retried };
  }
}
