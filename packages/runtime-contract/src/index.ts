export enum RunState {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RECOVERING = 'RECOVERING',
}

export type ToolCallStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

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

export interface ToolCall {
  toolCallId: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  output?: unknown;
  error?: string;
  idempotencyKey?: string;
}

export interface RunSnapshot {
  runId: string;
  agentId: string;
  input: unknown;
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

const VALID_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  [RunState.CREATED]: [RunState.RUNNING, RunState.CANCELLED],
  [RunState.RUNNING]: [
    RunState.WAITING,
    RunState.COMPLETED,
    RunState.FAILED,
    RunState.CANCELLED,
    RunState.RECOVERING,
  ],
  [RunState.WAITING]: [RunState.RUNNING, RunState.FAILED, RunState.CANCELLED, RunState.RECOVERING],
  [RunState.RECOVERING]: [RunState.RUNNING, RunState.FAILED, RunState.CANCELLED],
  [RunState.COMPLETED]: [],
  [RunState.FAILED]: [],
  [RunState.CANCELLED]: [],
};

export function assertValidRunStateTransition(from: RunState, to: RunState): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidRunStateTransitionError(from, to);
  }
}
