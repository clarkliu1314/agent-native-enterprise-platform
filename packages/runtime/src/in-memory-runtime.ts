import {
  assertValidRunStateTransition,
  RunState,
  type AgentRun,
  type AgentRuntime,
  type RunSnapshot,
  type StartRunInput,
  type Turn,
} from '@agent-native/runtime-contract';

/**
 * Reference-only storage representation.
 *
 * The in-memory runtime deliberately keeps turns beside the public AgentRun metadata so
 * checkpoint/recovery semantics can be exercised without PostgreSQL. Production runtimes
 * will replace this map with durable persistence while preserving AgentRuntime's contract.
 */
interface StoredRun extends AgentRun {
  turns: Turn[];
}

/**
 * Small deterministic runtime used as the executable reference implementation for the
 * contract tests. It is not intended to provide durability; its value is proving lifecycle
 * semantics before any framework adapter is introduced.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly runs = new Map<string, StoredRun>();
  private nextRunNumber = 1;

  async startRun(input: StartRunInput): Promise<AgentRun> {
    // Run IDs are deterministic within one runtime instance, which makes contract and
    // benchmark fixtures easy to reproduce. A durable runtime will use a persistent ID.
    const run: StoredRun = {
      runId: `run-${this.nextRunNumber++}`,
      agentId: input.agentId,
      state: RunState.CREATED,
      input: input.input,
      version: 0,
      metadata: { ...(input.metadata ?? {}) },
      turns: [],
    };

    this.runs.set(run.runId, run);
    return this.publicRun(run);
  }

  async executeTurn(runId: string, input: unknown): Promise<Turn> {
    const run = this.requireRun(runId);

    // The first turn transitions CREATED -> RUNNING. Subsequent turns remain RUNNING;
    // terminal states are rejected by the central state-machine contract.
    if (run.state !== RunState.RUNNING) {
      assertValidRunStateTransition(run.state, RunState.RUNNING);
      run.state = RunState.RUNNING;
    }

    // This reference runtime echoes input as output. Real adapters will replace this with
    // model/tool orchestration; the lifecycle and sequencing semantics remain unchanged.
    const turn: Turn = {
      turnId: `turn-${runId}-${run.turns.length + 1}`,
      sequence: run.turns.length + 1,
      input,
      output: input,
    };

    run.turns.push(turn);
    run.version += 1;
    return { ...turn };
  }

  async checkpoint(runId: string): Promise<RunSnapshot> {
    const run = this.requireRun(runId);

    // Clone arrays/metadata at the checkpoint boundary so later in-memory mutations cannot
    // silently alter an already-issued snapshot. A durable implementation provides the same
    // immutability property through a committed database row/event.
    return {
      runId: run.runId,
      agentId: run.agentId,
      input: run.input,
      state: run.state,
      version: run.version,
      turns: run.turns.map((turn) => ({ ...turn })),
      metadata: { ...run.metadata },
    };
  }

  async recover(snapshot: RunSnapshot): Promise<AgentRun> {
    // Recovery reconstructs only platform-level state. Framework-specific state belongs in
    // an adapter and must be derived from this stable snapshot rather than leaked into it.
    const run: StoredRun = {
      runId: snapshot.runId,
      agentId: snapshot.agentId,
      state: snapshot.state,
      input: snapshot.input,
      version: snapshot.version,
      metadata: { ...snapshot.metadata },
      turns: snapshot.turns.map((turn) => ({ ...turn })),
    };

    this.runs.set(run.runId, run);
    return this.publicRun(run);
  }

  async cancel(runId: string): Promise<AgentRun> {
    const run = this.requireRun(runId);

    // Cancellation is idempotent: retrying a cancellation request must not advance the
    // version repeatedly or turn a harmless retry into an invalid transition.
    if (run.state === RunState.CANCELLED) {
      return this.publicRun(run);
    }

    assertValidRunStateTransition(run.state, RunState.CANCELLED);
    run.state = RunState.CANCELLED;
    run.version += 1;
    return this.publicRun(run);
  }

  async getRunState(runId: string): Promise<AgentRun> {
    return this.publicRun(this.requireRun(runId));
  }

  private requireRun(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  /** Return a defensive public projection so callers cannot mutate internal runtime state. */
  private publicRun(run: StoredRun): AgentRun {
    return {
      runId: run.runId,
      agentId: run.agentId,
      state: run.state,
      input: run.input,
      version: run.version,
      metadata: { ...run.metadata },
    };
  }
}
