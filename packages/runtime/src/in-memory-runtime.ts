import {
  assertValidRunStateTransition,
  RunState,
  type AgentRun,
  type AgentRuntime,
  type RunSnapshot,
  type StartRunInput,
  type Turn,
} from '@agent-native/runtime-contract';

interface StoredRun extends AgentRun {
  turns: Turn[];
}

export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly runs = new Map<string, StoredRun>();
  private nextRunNumber = 1;

  async startRun(input: StartRunInput): Promise<AgentRun> {
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

    if (run.state !== RunState.RUNNING) {
      assertValidRunStateTransition(run.state, RunState.RUNNING);
      run.state = RunState.RUNNING;
    }

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
