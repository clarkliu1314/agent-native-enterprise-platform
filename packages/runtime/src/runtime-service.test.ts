import { describe, expect, it } from 'vitest';
import type { CheckpointEnvelope, CreateRunCommand, RunView, RuntimeEventView } from '@agent-native/runtime-contract/durable';
import type { RuntimeAdapter } from './ports';
import type { DurableRepositories, IdempotencyRecord, RunClaim } from './repositories';
import { DurableRuntimeService } from './runtime-service';

const run = (state: RunView['state'] = 'QUEUED'): RunView => ({
  runId: 'run-1', agentId: 'agent', state, input: { x: 1 }, metadata: {}, fencingToken: state === 'RUNNING' ? 1n : 0n,
  attempt: state === 'RUNNING' ? 1 : 0, createdAt: new Date(0).toISOString(),
});

class FakeRepos implements DurableRepositories {
  current = run();
  idempotency?: IdempotencyRecord;
  events: RuntimeEventView[] = [];
  checkpoints: CheckpointEnvelope[] = [];
  failAtomicTransition = false;
  async admitRun(input: { command: CreateRunCommand; commandHash: string; runId: string; eventId: string }) { this.idempotency = { key: input.command.idempotencyKey ?? `run:${input.runId}`, commandHash: input.commandHash, runId: input.runId }; this.current = { ...this.current, runId: input.runId, agentId: input.command.agentId, input: input.command.input }; return this.current; }
  async getRun(id: string) { return id === this.current.runId ? this.current : null; }
  async getIdempotency(key: string) { return this.idempotency?.key === key ? this.idempotency : null; }
  async insertIdempotency(record: IdempotencyRecord) { this.idempotency = record; }
  async claimRun() { this.current = { ...this.current, state: 'RUNNING', fencingToken: this.current.fencingToken + 1n, attempt: this.current.attempt + 1 }; return { run: this.current, fencingToken: this.current.fencingToken } as RunClaim; }
  async renewLease() { return true; }
  async transitionRun(input: { runId: string; fencingToken?: bigint; from: RunView['state']; to: RunView['state']; owner?: string; error?: string }) { expect(this.current.state).toBe(input.from); this.current = { ...this.current, state: input.to }; return this.current; }
  async transitionRunAndEmit(input: { runId: string; fencingToken?: bigint; from: RunView['state']; to: RunView['state']; owner?: string; error?: string; eventType: string; eventPayload: unknown; topic: string }) {
    const previous = this.current;
    expect(previous.state).toBe(input.from);
    this.current = { ...previous, state: input.to };
    try {
      if (this.failAtomicTransition) throw new Error('simulated event/outbox failure');
      await this.appendEvent({ runId: input.runId, type: input.eventType, payload: input.eventPayload, fencingToken: input.fencingToken });
      return this.current;
    } catch (error) {
      this.current = previous;
      throw error;
    }
  }
  async appendEvent(input: { runId: string; type: string; payload: unknown; fencingToken?: bigint }) { const event = { eventId: `event-${this.events.length + 1}`, runId: input.runId, sequence: BigInt(this.events.length + 1), type: input.type, payload: input.payload, createdAt: new Date(0).toISOString() }; this.events.push(event); return event; }
  async appendEventAndOutbox(input: { runId: string; type: string; payload: unknown; topic: string }) { return this.appendEvent(input); }
  async listEvents() { return this.events; }
  async createOutbox() {}
  async saveCheckpoint(cp: CheckpointEnvelope) { this.checkpoints.push(cp); }
  async getLatestCheckpoint() { return this.checkpoints.at(-1) ?? null; }
  async findExpiredRuns() { return []; }
  async reclaimExpiredRun() { return null; }
  async saveIdempotencyResponse() {}
}

const adapter: RuntimeAdapter = {
  name: 'reference', version: '1.0.0',
  async run() { return { kind: 'SUCCEEDED', output: { ok: true } }; },
  serializeCheckpoint: () => new Uint8Array(),
  deserializeCheckpoint: () => ({}),
};

describe('DurableRuntimeService', () => {
  it('replays an idempotent create command', async () => {
    const repos = new FakeRepos();
    const service = new DurableRuntimeService(repos, { adapter });
    const command: CreateRunCommand = { agentId: 'agent', input: { x: 1 }, idempotencyKey: 'same' };
    const first = await service.createRun(command);
    const second = await service.createRun(command);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.run.runId).toBe(first.run.runId);
  });

  it('runs to a terminal state only through the durable facade', async () => {
    const repos = new FakeRepos();
    const service = new DurableRuntimeService(repos, { adapter });
    const created = await service.createRun({ agentId: 'agent', input: {} });
    const result = await service.executeRunBounded(created.run.runId, 'worker-1', new Date(Date.now() + 1000));
    expect(result.terminal).toBe(true);
    expect(result.run.state).toBe('SUCCEEDED');
    expect(repos.events.map((event) => event.type)).toContain('RUN_SUCCEEDED');
  });

  it('does not claim an already terminal run as new work', async () => {
    const repos = new FakeRepos();
    repos.current = run('SUCCEEDED');
    const service = new DurableRuntimeService(repos, { adapter });
    const result = await service.executeRunBounded(repos.current.runId, 'worker-1', new Date(Date.now() + 1000));
    expect(result.terminal).toBe(true);
    expect(result.run.state).toBe('SUCCEEDED');
  });

  it('rolls back the lifecycle transition when event/outbox persistence fails', async () => {
    const repos = new FakeRepos();
    repos.failAtomicTransition = true;
    const service = new DurableRuntimeService(repos, { adapter });
    await expect(service.cancelRun(repos.current.runId, 'user requested')).rejects.toThrow('simulated event/outbox failure');
    expect(repos.current.state).toBe('QUEUED');
    expect(repos.events).toHaveLength(0);
  });
});
