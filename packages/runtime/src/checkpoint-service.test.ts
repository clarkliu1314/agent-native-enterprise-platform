import { describe, expect, it, vi } from 'vitest';
import type { CheckpointEnvelope } from '@agent-native/runtime-contract/durable';
import type { RuntimeAdapter } from './ports';
import type { DurableRepositories } from './repositories';
import { CheckpointService } from './checkpoint-service';

const envelope: CheckpointEnvelope = {
  checkpointId: 'checkpoint:1', runId: 'run-1', sequence: 7n, fencingToken: 3n,
  adapter: 'test', adapterVersion: '1', schemaVersion: 1,
  createdAt: new Date(0).toISOString(), payload: new Uint8Array([1, 2, 3]),
};

const adapter: RuntimeAdapter = {
  name: 'test', version: '1',
  async run() { return { kind: 'SUCCEEDED' }; },
  serializeCheckpoint: vi.fn(() => envelope.payload),
  deserializeCheckpoint: vi.fn(() => ({ cursor: 7 })),
};

describe('CheckpointService', () => {
  it('persists an opaque adapter envelope with the current fencing token', async () => {
    const saveCheckpoint = vi.fn(async (checkpoint: CheckpointEnvelope) => {
      expect(checkpoint.runId).toBe('run-1');
      expect(checkpoint.fencingToken).toBe(3n);
      expect(checkpoint.payload).toEqual(new Uint8Array([1, 2, 3]));
    });
    const repos = { saveCheckpoint } as unknown as DurableRepositories;
    const service = new CheckpointService(repos, adapter, { next: () => 'checkpoint:1' });

    const saved = await service.save({ runId: 'run-1', sequence: 7n, fencingToken: 3n, state: { cursor: 7 } });

    expect(saved).toMatchObject({ runId: 'run-1', sequence: 7n, fencingToken: 3n, adapter: 'test', adapterVersion: '1' });
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(adapter.serializeCheckpoint).toHaveBeenCalledWith({ cursor: 7 });
  });
});
