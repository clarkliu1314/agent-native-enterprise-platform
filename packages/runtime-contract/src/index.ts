export enum RunState {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RECOVERING = 'RECOVERING',
}

export interface StartRunInput {
  agentId: string;
  input: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  runId: string;
  agentId: string;
  state: RunState;
  input: unknown;
  version: number;
  metadata: Record<string, unknown>;
}

export interface Turn {
  turnId: string;
  sequence: number;
  input: unknown;
  output?: unknown;
}

export interface RunSnapshot {
  runId: string;
  state: RunState;
  version: number;
  turns: Turn[];
  metadata: Record<string, unknown>;
}

export interface AgentRuntime {
  startRun(input: StartRunInput): Promise<AgentRun>;
  executeTurn(runId: string, input: unknown): Promise<Turn>;
  checkpoint(runId: string): Promise<RunSnapshot>;
  recover(snapshot: RunSnapshot): Promise<AgentRun>;
  cancel(runId: string): Promise<AgentRun>;
  getRunState(runId: string): Promise<AgentRun>;
}

export class InvalidRunStateTransitionError extends Error {
  constructor(from: RunState, to: RunState) {
    super(`Invalid run state transition: ${from} -> ${to}`);
    this.name = 'InvalidRunStateTransitionError';
  }
}
