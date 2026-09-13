import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisher, type OutboxMessage, type OutboxRepository } from './publisher';
import type { ObservabilityLogger } from '@agent-native/observability';

describe('OutboxPublisher observability', () => {
  it('emits published events with correlation context and emits failed events on transport failure', async () => {
    const events: unknown[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    const message: OutboxMessage = { eventId: 'evt-1', eventType: 'tool.execution.completed', payload: { secret: 'do-not-log' } };
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = new (OutboxPublisher as any)(
      repository,
      async () => undefined,
      { logger, correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1' } },
    ) as OutboxPublisher;

    await publisher.publishBatch(1, 'publisher-1');

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'outbox.published' }),
    ]));
    expect(JSON.stringify(events)).not.toContain('do-not-log');

    events.length = 0;
    const failingPublisher = new (OutboxPublisher as any)(
      repository,
      async () => { throw new Error('broker-down'); },
      { logger, correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1' } },
    ) as OutboxPublisher;
    await failingPublisher.publishBatch(1, 'publisher-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'outbox.failed' }),
    ]));
  });
});
