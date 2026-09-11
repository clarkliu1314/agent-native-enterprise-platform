export type DurableRunState = 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type ExecutionMode = 'async' | 'sync';
export type ReplayPolicy = 'REPLAYABLE' | 'NON_REPLAYABLE';
export type ToolKind = 'PURE' | 'SIDE_EFFECTING';
export type StepKind = 'MODEL' | 'TOOL' | 'HUMAN' | 'WAIT';

export interface CreateRunCommand {
  agentId: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  executionMode?: ExecutionMode;
  idempotencyKey?: string;
}

export interface RunView {
  runId: string;
  agentId: string;
  state: DurableRunState;
  input: unknown;
  metadata: Record<string, unknown>;
  fencingToken: bigint;
  attempt: number;
  createdAt: string;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
}

export interface CreateRunResult {
  run: RunView;
  replayed: boolean;
}

export interface ExecuteBoundedResult {
  run: RunView;
  terminal: boolean;
}

export interface RuntimeEventView {
  eventId: string;
  runId: string;
  sequence: bigint;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface CheckpointEnvelope {
  checkpointId: string;
  runId: string;
  turnId?: string;
  sequence: bigint;
  fencingToken: bigint;
  adapter: string;
  adapterVersion: string;
  schemaVersion: number;
  createdAt: string;
  payload: Uint8Array;
}

export interface RuntimeFacade {
  createRun(command: CreateRunCommand): Promise<CreateRunResult>;
  resumeRun(runId: string, owner: string): Promise<RunView>;
  cancelRun(runId: string, reason?: string): Promise<RunView>;
  approveRun(runId: string, approvalId: string): Promise<RunView>;
  executeRunBounded(runId: string, owner: string, deadlineAt: Date): Promise<ExecuteBoundedResult>;
  getRun(runId: string): Promise<RunView>;
  listRunEvents(runId: string, afterSequence?: bigint): Promise<RuntimeEventView[]>;
  getRunCheckpoint(runId: string): Promise<CheckpointEnvelope | null>;
  getToolCall(toolCallId: string): Promise<unknown>;
}
