import { describe, expect, it } from 'vitest';
import type { QueueConsumer, RuntimeAdapter } from '@agent-native/runtime';
import { composeWorker } from './index';

const adapter: RuntimeAdapter = {
  name: 'test-adapter',
  version: '1.0.0',
  run: async () => ({ kind: 'SUCCEEDED' }),
  serializeCheckpoint: () => new Uint8Array(),
  deserializeCheckpoint: () => ({}),
};

const consumer: QueueConsumer = {
  consume: async () => undefined,
};

describe('worker composition root', () => {
  it('constructs a durable runtime without constructing request-bound state', () => {
    const composition = composeWorker(adapter, consumer, { owner: 'worker-test' });
    expect(composition.runtime).toBeDefined();
    expect(composition.repositories).toBeDefined();
    expect(composition.worker).toBeDefined();
    expect(composition.worker).not.toBeNull();
  });
});
