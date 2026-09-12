import { describe, expect, it } from 'vitest';
import type { QueuePublisher } from '@agent-native/runtime';
import { composeOutboxPublisher } from './index';

const queue: QueuePublisher = { publish: async () => undefined };

describe('outbox publisher composition root', () => {
  it('constructs the publisher against PostgreSQL-backed outbox state', () => {
    const composition = composeOutboxPublisher(queue);
    expect(composition.database).toBeDefined();
    expect(composition.repository).toBeDefined();
    expect(composition.publisher).toBeDefined();
  });
});
