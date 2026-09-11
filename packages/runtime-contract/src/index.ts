/**
 * Stable application-facing state machine.
 *
 * Agent frameworks are adapters, not the source of truth for these states. Keeping the
 * lifecycle here means recovery, cancellation, persistence, and benchmarks can be tested
 * once and then applied identically to AgentScope/LangGraph/Eino/Mastra.
 */
export enum RunState {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RECOVERING = 'RECOVERING',
}

/** Lifecycle state of a tool call recorded inside a run/checkpoint. */
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
  /** Monotonically increasing optimistic-concurrency version. */
  version: number;
  metadata: Record<string, unknown>;
}

export interface Turn {
  turnId: string;
  /** One-based, stable ordering used for deterministic replay/recovery. */
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
  /** Retry token passed through to the Tool Runtime for effectful calls. */
  idempotencyKey?: string;
}

/**
 * Durable checkpoint shape. It contains enough information for a runtime adapter to rebuild
 * its framework-specific execution state without persisting framework implementation types.
 */
export interface RunSnapshot {
  runId: string;
  agentId: string;
  input: unknown;
  state: RunState;
  version: number;
  turns: Turn[];
  metadata: Record<string, unknown>;
}

/**
 * The only lifecycle API that the application layer should depend on. Concrete framework
 * adapters implement this interface; application code must not depend on framework APIs.
 */
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

/**
 * Explicit state-machine table. Do not infer transitions from framework behavior: this
 * table is the platform contract and therefore must stay deterministic and reviewable.
 */
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

/** Throws unless the requested lifecycle transition is explicitly part of the contract. */
export function assertValidRunStateTransition(from: RunState, to: RunState): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidRunStateTransitionError(from, to);
  }
}
