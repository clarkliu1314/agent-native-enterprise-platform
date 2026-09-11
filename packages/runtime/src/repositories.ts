import type {
  CheckpointEnvelope,
  CreateRunCommand,
  RunView,
  RuntimeEventView,
} from '@agent-native/runtime-contract/durable';

export interface RunClaim {
  run: RunView;
  fencingToken: bigint;
}

export interface IdempotencyRecord {
  key: string;
  commandHash: string;
  runId?: string;
  response?: unknown;
}

export interface DurableRepositories {
  createRun(command: CreateRunCommand, runId: string): Promise<RunView>;
  getRun(runId: string): Promise<RunView | null>;
  getIdempotency(key: string): Promise<IdempotencyRecord | null>;
  insertIdempotency(record: IdempotencyRecord): Promise<void>;
  claimRun(runId: string, owner: string, leaseMs: number): Promise<RunClaim | null>;
  renewLease(runId: string, owner: string, fencingToken: bigint, leaseMs: number): Promise<boolean>;
  transitionRun(input: {
    runId: string;
    fencingToken?: bigint;
    from: RunView['state'];
    to: RunView['state'];
    owner?: string;
    error?: string;
  }): Promise<RunView>;
  appendEvent(input: {
    runId: string;
    type: string;
    payload: unknown;
    fencingToken?: bigint;
  }): Promise<RuntimeEventView>;
  listEvents(runId: string, afterSequence?: bigint): Promise<RuntimeEventView[]>;
  createOutbox(input: { eventId: string; topic: string; payload: unknown }): Promise<void>;
  saveCheckpoint(checkpoint: CheckpointEnvelope): Promise<void>;
  getLatestCheckpoint(runId: string): Promise<CheckpointEnvelope | null>;
  findExpiredRuns(limit: number): Promise<RunView[]>;
  reclaimExpiredRun(runId: string, owner: string, leaseMs: number): Promise<RunClaim | null>;
  saveIdempotencyResponse(key: string, response: unknown): Promise<void>;
}

export interface OutboxRecord {
  outboxId: string;
  eventId: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxRepository {
  claim(limit: number): Promise<OutboxRecord[]>;
  markPublished(outboxId: string): Promise<void>;
  scheduleRetry(outboxId: string, nextAttemptAt: Date): Promise<void>;
}
