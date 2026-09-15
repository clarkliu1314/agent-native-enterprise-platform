import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisher } from './outbox-publisher';
import type { QueuePublisher } from './ports';
import type { OutboxRecord, OutboxRepository } from './repositories';

const record: OutboxRecord = {
  outboxId: 'outbox:delivery-after-attempt',
  eventId: 'event:delivery-after-attempt',
  topic: 'agent.run',
  payload: { eventId: 'event:delivery-after-attempt' },
  attempts: 1,
};

describe('Stage 12.4 outbox failure injection', () => {
  it('retries safely when delivery succeeds but the publication acknowledgement is lost', async () => {
    const claim = vi.fn<OutboxRepository['claim']>().mockResolvedValueOnce([record]).mockResolvedValueOnce([record]);
    const markPublished = vi.fn<OutboxRepository['markPublished']>().mockRejectedValueOnce(new Error('postgres unavailable after delivery'));
    const scheduleRetry = vi.fn<OutboxRepository['scheduleRetry']>().mockResolvedValue(undefined);
    const outbox: OutboxRepository = { claim, markPublished, scheduleRetry };
    const publish = vi.fn<QueuePublisher['publish']>().mockResolvedValue(undefined);
    const queue: QueuePublisher = { publish };
    const publisher = new OutboxPublisher(outbox, queue);

    const first = await publisher.publishBatch();
    expect(first).toEqual({ published: 0, retried: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(markPublished).toHaveBeenCalledWith(record.outboxId);
    expect(scheduleRetry).toHaveBeenCalledWith(record.outboxId, expect.any(Date));

    const second = await publisher.publishBatch();
    expect(second).toEqual({ published: 1, retried: 0 });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, record.topic, record.payload);
    expect(publish).toHaveBeenNthCalledWith(2, record.topic, record.payload);
  });

  it('does not acknowledge an outbox event when delivery itself fails', async () => {
    const claim = vi.fn<OutboxRepository['claim']>().mockResolvedValue([record]);
    const markPublished = vi.fn<OutboxRepository['markPublished']>().mockResolvedValue(undefined);
    const scheduleRetry = vi.fn<OutboxRepository['scheduleRetry']>().mockResolvedValue(undefined);
    const outbox: OutboxRepository = { claim, markPublished, scheduleRetry };
    const publish = vi.fn<QueuePublisher['publish']>().mockRejectedValue(new Error('redis unavailable'));
    const queue: QueuePublisher = { publish };
    const publisher = new OutboxPublisher(outbox, queue);

    await expect(publisher.publishBatch()).resolves.toEqual({ published: 0, retried: 1 });
    expect(markPublished).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith(record.outboxId, expect.any(Date));
  });
});
