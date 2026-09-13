import { describe, expect, it } from 'vitest';
import { OutboxPublisher } from './outbox-publisher';
import type { OutboxRecord, OutboxRepository } from './repositories';
import type { QueuePublisher } from './ports';

describe('OutboxPublisher correlation durability', () => {
  it('publishes correlation carried by the durable outbox payload after publisher context is lost', async () => {
    const record: OutboxRecord = {
      outboxId: 'outbox-1',
      eventId: 'event-1',
      topic: 'agent.run',
      payload: {
        runId: 'run-durable-1',
        correlation: {
          requestId: 'req-durable-1',
          traceId: 'trace-durable-1',
          tenantId: 'fund-durable-1',
          runId: 'run-durable-1',
          agentId: 'investment-worker',
        },
      },
      attempts: 1,
    };
    const published: unknown[] = [];
    const outbox: OutboxRepository = {
      claim: async () => [record],
      markPublished: async () => undefined,
      scheduleRetry: async () => undefined,
    };
    const queue: QueuePublisher = {
      publish: async (_topic, payload) => { published.push(payload); },
    };

    const publisher = new OutboxPublisher(outbox, queue);
    await publisher.publishBatch();

    expect(published).toEqual([record.payload]);
  });
});
