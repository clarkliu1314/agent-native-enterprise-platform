import { createHash, randomUUID } from 'node:crypto';
import type { CheckpointEnvelope, CreateRunCommand, ExecuteBoundedResult, RunView, RuntimeEventView, RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { assertValidDurableTransition } from './state-machine';
import { IdempotencyConflictError, RunNotFoundError } from './errors';
import type { Clock, IdGenerator, RuntimeAdapter } from './ports';
import type { DurableRepositories } from './repositories';
import { createLeaseHeartbeat } from './lease-heartbeat';

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
};
export const hashCommand = (command: CreateRunCommand): string => createHash('sha256').update(canonicalize({ agentId: command.agentId, input: command.input, metadata: command.metadata ?? {}, executionMode: command.executionMode ?? 'async' })).digest('hex');
const defaultClock: Clock = { now: () => new Date() };
const defaultIds: IdGenerator = { next: (prefix) => `${prefix}_${randomUUID()}` };
export interface RuntimeServiceOptions {
  leaseMs?: number;
  heartbeatMs?: number;
  clock?: Clock;
  ids?: IdGenerator;
  adapter: RuntimeAdapter;
}

export interface ClaimedRunExecution {
  runId: string;
  owner: string;
  fencingToken: bigint;
}

export class DurableRuntimeService implements RuntimeFacade {
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly adapter: RuntimeAdapter;
  constructor(private readonly repos: DurableRepositories, options: RuntimeServiceOptions) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(this.leaseMs / 3));
    this.clock = options.clock ?? defaultClock;
    this.ids = options.ids ?? defaultIds;
    this.adapter = options.adapter;
  }
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
    return this.repos.transitionRunAndEmit({ runId, from: run.state, to: 'CANCELLED', error: reason, eventType: 'RUN_CANCELLED', eventPayload: { reason }, topic: 'agent.run' });
  }
  async approveRun(runId: string, approvalId: string): Promise<RunView> {
    const run = await this.requireRun(runId); if (run.state !== 'WAITING') throw new Error(`Run is not waiting for approval: ${runId}`); assertValidDurableTransition('WAITING', 'QUEUED');
    return this.repos.transitionRunAndEmit({ runId, from: 'WAITING', to: 'QUEUED', eventType: 'RUN_APPROVED', eventPayload: { approvalId }, topic: 'agent.run' });
  }
  async executeRunBounded(runId: string, owner: string, deadlineAt: Date): Promise<ExecuteBoundedResult> {
    const run = await this.resumeRun(runId, owner);
    if (run.state !== 'RUNNING') return { run, terminal: true };
    return this.executeClaimedRunBounded({ runId, owner, fencingToken: run.fencingToken }, deadlineAt);
  }

  /** Internal worker/recovery boundary: execute a run already reclaimed with its fencing token. */
  async executeClaimedRunBounded(claim: ClaimedRunExecution, deadlineAt: Date): Promise<ExecuteBoundedResult> {
    let run = await this.requireRun(claim.runId);
    if (run.state !== 'RUNNING' || run.fencingToken !== claim.fencingToken) {
      return { run, terminal: run.state === 'SUCCEEDED' || run.state === 'FAILED' || run.state === 'CANCELLED' };
    }
    if (this.clock.now() >= deadlineAt) return { run, terminal: false };
    const executionController = new AbortController();
    const timeoutMs = Math.max(1, deadlineAt.getTime() - this.clock.now().getTime());
    const timeout = setTimeout(() => executionController.abort(new DOMException('Execution deadline exceeded', 'TimeoutError')), timeoutMs);
    timeout.unref?.();
    const heartbeat = createLeaseHeartbeat(
      ({ runId, owner, fencingToken, leaseMs }) => this.repos.renewLease(runId, owner, fencingToken, leaseMs),
      { intervalMs: this.heartbeatMs },
    ).start(claim, () => {
      executionController.abort(new DOMException('Run lease lost', 'AbortError'));
    });
    try {
      const result = await this.adapter.run({ run, signal: executionController.signal });
      assertValidDurableTransition('RUNNING', result.kind);
      run = await this.repos.transitionRunAndEmit({ runId: claim.runId, owner: claim.owner, fencingToken: claim.fencingToken, from: 'RUNNING', to: result.kind, error: result.error, eventType: `RUN_${result.kind}`, eventPayload: { output: result.output, error: result.error }, topic: 'agent.run' });
      return { run, terminal: run.state === 'SUCCEEDED' || run.state === 'FAILED' || run.state === 'CANCELLED' };
    } catch (error) {
      if (isDeadlineError(error)) {
        const current = await this.requireRun(claim.runId);
        return { run: current, terminal: current.state === 'SUCCEEDED' || current.state === 'FAILED' || current.state === 'CANCELLED' };
      }
      throw error;
    } finally {
      heartbeat.stop();
      clearTimeout(timeout);
    }
  }
  async getRun(runId: string): Promise<RunView> { return this.requireRun(runId); }
  async listRunEvents(runId: string, afterSequence?: bigint): Promise<RuntimeEventView[]> { await this.requireRun(runId); return this.repos.listEvents(runId, afterSequence); }
  async getRunCheckpoint(runId: string): Promise<CheckpointEnvelope | null> { await this.requireRun(runId); return this.repos.getLatestCheckpoint(runId); }
  async getToolCall(toolCallId: string): Promise<unknown> { return this.repos.getToolCall ? this.repos.getToolCall(toolCallId) : null; }
  private async requireRun(runId: string): Promise<RunView> { const run = await this.repos.getRun(runId); if (!run) throw new RunNotFoundError(runId); return run; }
}

function isDeadlineError(error: unknown): boolean { return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'); }
