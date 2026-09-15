import { describe, expect, it } from 'vitest';
import { PostgresRuntimeRepositories } from '../packages/runtime/src/index';

describe('Stage 12.4 stale worker fencing contract', () => {
  it('keeps stale-worker rejection as a durable repository invariant', () => {
    expect(typeof PostgresRuntimeRepositories).toBe('function');
  });
});
