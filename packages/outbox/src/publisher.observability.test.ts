import { describe, expect, it, vi } from 'vitest';
import { MemoryObservabilityMetrics } from '@agent-native/observability';
import { OutboxPublisher, type OutboxMessage, type OutboxRepository } from './publisher';
import type { ObservabilityLogger } from '@agent-native/observability';

describe('OutboxPublisher observability', () => {
  it('uses correlation metadata carried by the durable outbox event', async () => {
    const events: unknown[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    const message: OutboxMessage = {
      eventId: 'evt-1',
      eventType: 'tool.execution.completed',
      payload: { secret: 'do-not-log' },
      correlation: { requestId: 'req-original', traceId: 'trace-original', tenantId: 'tenant-1', runId: 'run-1' },
    };
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = new OutboxPublisher(repository, async () => undefined, { logger });

    await publisher.publishBatch(1, 'publisher-1');

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'outbox.published',
        context: expect.objectContaining({ requestId: 'req-original', traceId: 'trace-original', tenantId: 'tenant-1', runId: 'run-1' }),
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain('do-not-log');
  });

  it('does not depend on constructor process-memory correlation when the event has durable context', async () => {
    const events: any[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    const message: OutboxMessage = {
      eventId: 'evt-2',
      eventType: 'tool.execution.completed',
      payload: {},
      correlation: { requestId: 'req-recovery', traceId: 'trace-durable', tenantId: 'tenant-2', runId: 'run-2' },
    };
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = new OutboxPublisher(repository, async () => undefined, {
      logger,
      correlation: { requestId: 'stale-memory', traceId: 'stale-memory', tenantId: 'stale-memory', runId: 'stale-memory' },
    });

    await publisher.publishBatch(1, 'publisher-2');

    expect(events[0].context).toMatchObject({ requestId: 'req-recovery', traceId: 'trace-durable', tenantId: 'tenant-2', runId: 'run-2' });
  });

  it('records canonical publish metrics', async () => {
    const metrics = new MemoryObservabilityMetrics();
    const message: OutboxMessage = { eventId: 'evt-metrics-1', eventType: 'tool.execution.completed', payload: {}, correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1' } };
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    await new OutboxPublisher(repository, async () => undefined, { metrics }).publishBatch(1, 'publisher-1');

    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent_outbox_publish_total', labels: expect.objectContaining({ outcome: 'PUBLISHED' }) }),
    ]));
  });
});
