import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisher } from './outbox-publisher';
import type { OutboxRecord, OutboxRepository } from './repositories';
import type { QueuePublisher } from './ports';
import type { ObservabilityLogger } from '@agent-native/observability';

const correlation = {
  requestId: 'req-durable-1',
  traceId: 'trace-durable-1',
  tenantId: 'fund-durable-1',
  runId: 'run-durable-1',
  agentId: 'investment-worker',
};

const record: OutboxRecord = {
  outboxId: 'outbox-1',
  eventId: 'event-1',
  topic: 'agent.run',
  payload: {
    runId: 'run-durable-1',
    correlation,
  },
  attempts: 1,
};

describe('OutboxPublisher correlation durability', () => {
  it('emits publication telemetry from durable correlation without publisher-local context', async () => {
    const published: unknown[] = [];
    const events: unknown[] = [];
    const outbox: OutboxRepository = {
      claim: async () => [record],
      markPublished: async () => undefined,
      scheduleRetry: async () => undefined,
    };
    const queue: QueuePublisher = {
      publish: async (_topic, payload) => { published.push(payload); },
    };
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };

    const publisher = new OutboxPublisher(outbox, queue, 60_000, { logger });
    await publisher.publishBatch();

    expect(published).toEqual([record.payload]);
    expect(events).toEqual([expect.objectContaining({
      event: 'outbox.published',
      outcome: 'PUBLISHED',
      context: correlation,
    })]);
  });

  it('does not let telemetry failure prevent durable publication acknowledgement', async () => {
    const markPublished = vi.fn(async () => undefined);
    const outbox: OutboxRepository = {
      claim: async () => [record],
      markPublished,
      scheduleRetry: async () => undefined,
    };
    const queue: QueuePublisher = { publish: async () => undefined };
    const logger: ObservabilityLogger = { emit: () => { throw new Error('telemetry unavailable'); } };

    const publisher = new OutboxPublisher(outbox, queue, 60_000, { logger });
    await expect(publisher.publishBatch()).resolves.toEqual({ published: 1, retried: 0 });
    expect(markPublished).toHaveBeenCalledWith(record.outboxId);
  });
});
