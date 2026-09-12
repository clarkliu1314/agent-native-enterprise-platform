import { randomUUID } from 'node:crypto';
import type { CheckpointEnvelope } from '@agent-native/runtime-contract/durable';
import type { IdGenerator, RuntimeAdapter } from './ports';
import type { DurableRepositories } from './repositories';

export class CheckpointService {
  constructor(private readonly repos: DurableRepositories, private readonly adapter: RuntimeAdapter, private readonly ids: IdGenerator = { next: (prefix) => `${prefix}:${randomUUID()}` }) {}

  async save(input: { runId: string; turnId?: string; sequence: bigint; fencingToken: bigint; state: unknown }): Promise<CheckpointEnvelope> {
    const checkpoint: CheckpointEnvelope = {
      checkpointId: this.ids.next('checkpoint'), runId: input.runId, turnId: input.turnId,
      sequence: input.sequence, fencingToken: input.fencingToken, adapter: this.adapter.name,
      adapterVersion: this.adapter.version, schemaVersion: 1, createdAt: new Date().toISOString(),
      payload: this.adapter.serializeCheckpoint(input.state),
    };
    await this.repos.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  async load(runId: string): Promise<{ envelope: CheckpointEnvelope; state: unknown } | null> {
    const envelope = await this.repos.getLatestCheckpoint(runId);
    return envelope ? { envelope, state: this.adapter.deserializeCheckpoint(envelope.payload) } : null;
  }
}
