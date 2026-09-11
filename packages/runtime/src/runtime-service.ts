import { createHash, randomUUID } from 'node:crypto';
import type { CheckpointEnvelope, CreateRunCommand, ExecuteBoundedResult, RunView, RuntimeEventView, RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { assertValidDurableTransition } from './state-machine';
import { IdempotencyConflictError, RunNotFoundError } from './errors';
import type { Clock, IdGenerator, RuntimeAdapter } from './ports';
import type { DurableRepositories } from './repositories';

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
};
export const hashCommand = (command: CreateRunCommand): string => createHash('sha256').update(canonicalize({ agentId: command.agentId, input: command.input, metadata: command.metadata ?? {}, executionMode: command.executionMode ?? 'async' })).digest('hex');
const defaultClock: Clock = { now: () => new Date() };
const defaultIds: IdGenerator = { next: (prefix) => `${prefix}_${randomUUID()}` };
export interface RuntimeServiceOptions { leaseMs?: number; clock?: Clock; ids?: IdGenerator; adapter: RuntimeAdapter; }

export class DurableRuntimeService implements RuntimeFacade {
  private readonly leaseMs: number; private readonly clock: Clock; private readonly ids: IdGenerator; private readonly adapter: RuntimeAdapter;
  constructor(private readonly repos: DurableRepositories, options: RuntimeServiceOptions) { this.leaseMs = options.leaseMs ?? 30_000; this.clock = options.clock ?? defaultClock; this.ids = options.ids ?? defaultIds; this.adapter = options.adapter; }
  async createRun(command: CreateRunCommand) {
    const key = command.idempotencyKey; const commandHash = hashCommand(command);
    if (key) { const existing = await this.repos.getIdempotency(key); if (existing) { if (existing.commandHash !== commandHash) throw new IdempotencyConflictError(key); if (!existing.runId) throw new Error(`Incomplete idempotency record: ${key}`); return { run: await this.requireRun(existing.runId), replayed: true }; } }
    const runId = this.ids.next('run'); const eventId = this.ids.next('event');
    try { return { run: await this.repos.admitRun({ command, commandHash, runId, eventId }), replayed: false }; }
    catch (error) { if (!key) throw error; const existing = await this.repos.getIdempotency(key); if (existing?.commandHash === commandHash && existing.runId) return { run: await this.requireRun(existing.runId), replayed: true }; throw error; }
  }
  async resumeRun(runId: string, owner: string): Promise<RunView> { const current = await this.requireRun(runId); if (current.state === 'SUCCEEDED' || current.state === 'FAILED' || current.state === 'CANCELLED') return current; const claimed = await this.repos.claimRun(runId, owner, this.leaseMs); if (!claimed) throw new Error(`Run cannot be claimed: ${runId}`); return claimed.run; }
  async cancelRun(runId: string, reason?: string): Promise<RunView> {
    const run = await this.requireRun(runId); if (run.state === 'SUCCEEDED' || run.state === 'FAILED' || run.state === 'CANCELLED') return run; assertValidDurableTransition(run.state, 'CANCELLED');
    const updated = await this.repos.transitionRun({ runId, from: run.state, to: 'CANCELLED', error: reason }); await this.appendEventAndOutbox(runId, 'RUN_CANCELLED', { reason }); return updated;
  }
  async approveRun(runId: string, approvalId: string): Promise<RunView> {
    const run = await this.requireRun(runId); if (run.state !== 'WAITING') throw new Error(`Run is not waiting for approval: ${runId}`); assertValidDurableTransition('WAITING', 'QUEUED');
    const updated = await this.repos.transitionRun({ runId, from: 'WAITING', to: 'QUEUED' }); await this.appendEventAndOutbox(runId, 'RUN_APPROVED', { approvalId }); return updated;
  }
  async executeRunBounded(runId: string, owner: string, deadlineAt: Date): Promise<ExecuteBoundedResult> {
    let run = await this.resumeRun(runId, owner); if (run.state !== 'RUNNING') return { run, terminal: true }; if (this.clock.now() >= deadlineAt) return { run, terminal: false };
    const result = await this.adapter.run({ run, signal: AbortSignal.timeout(Math.max(1, deadlineAt.getTime() - this.clock.now().getTime())) });
    const nextState = result.kind;
    assertValidDurableTransition('RUNNING', nextState);
    run = await this.repos.transitionRun({ runId, owner, fencingToken: run.fencingToken, from: 'RUNNING', to: nextState, error: result.error });
    await this.appendEventAndOutbox(runId, `RUN_${result.kind}`, { output: result.output, error: result.error }, run.fencingToken);
    return { run, terminal: run.state === 'SUCCEEDED' || run.state === 'FAILED' || run.state === 'CANCELLED' };
  }
  async getRun(runId: string): Promise<RunView> { return this.requireRun(runId); }
  async listRunEvents(runId: string, afterSequence?: bigint): Promise<RuntimeEventView[]> { await this.requireRun(runId); return this.repos.listEvents(runId, afterSequence); }
  async getRunCheckpoint(runId: string): Promise<CheckpointEnvelope | null> { await this.requireRun(runId); return this.repos.getLatestCheckpoint(runId); }
  async getToolCall(toolCallId: string): Promise<unknown> { return this.repos.getToolCall ? this.repos.getToolCall(toolCallId) : null; }
  private async appendEventAndOutbox(runId: string, type: string, payload: unknown, fencingToken?: bigint): Promise<void> { if (!this.repos.appendEventAndOutbox) throw new Error('Atomic event/outbox persistence is required'); await this.repos.appendEventAndOutbox({ runId, type, payload, topic: 'agent.run', fencingToken }); }
  private async requireRun(runId: string): Promise<RunView> { const run = await this.repos.getRun(runId); if (!run) throw new RunNotFoundError(runId); return run; }
}
