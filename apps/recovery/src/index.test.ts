import { describe, expect, it } from 'vitest';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { composeRecovery } from './index';

const adapter: RuntimeAdapter = {
  name: 'test-adapter',
  version: '1.0.0',
  run: async () => ({ kind: 'SUCCEEDED' }),
  serializeCheckpoint: () => new Uint8Array(),
  deserializeCheckpoint: () => ({}),
};

describe('recovery composition root', () => {
  it('constructs recovery against the same PostgreSQL runtime repository boundary', () => {
    const composition = composeRecovery(adapter);
    expect(composition.database).toBeDefined();
    expect(composition.repositories).toBeDefined();
    expect(composition.coordinator).toBeDefined();
  });
});
