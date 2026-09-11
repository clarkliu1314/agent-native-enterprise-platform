/**
 * Framework-neutral tool execution boundary.
 *
 * AgentScope/LangGraph/Eino/Mastra adapters must enter the application through this
 * service instead of invoking effectful tools directly. That keeps authorization,
 * idempotency, and outbox rules in one auditable location.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  sideEffect: boolean;
}

export interface ToolExecutionContext {
  actorId: string;
  tenantId: string;
  permissions: string[];
}

export interface ToolExecutionRequest {
  tool: ToolDefinition;
  input: unknown;
  context: ToolExecutionContext;
  idempotencyKey: string;
}

export interface ToolExecutionResult {
  output: unknown;
  replayed: boolean;
}

export interface ToolExecutionOutboxEvent {
  type: 'tool.execution.completed';
  idempotencyKey: string;
  toolName: string;
  tenantId: string;
  actorId: string;
  output: unknown;
}

export interface ToolExecutionCommit {
  idempotencyKey: string;
  toolName: string;
  tenantId: string;
  actorId: string;
  output: unknown;
  outboxEvent: ToolExecutionOutboxEvent;
}

export interface ToolExecutionLookup {
  idempotencyKey: string;
  tenantId: string;
  toolName: string;
}

export type IdempotencyState =
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

export type IdempotencyReservation =
  | { kind: 'RESERVED'; state: 'IN_PROGRESS' }
  | { kind: 'REPLAY'; state: 'SUCCEEDED'; output: unknown }
  | { kind: 'RETRY'; state: 'FAILED_RETRYABLE' }
  | { kind: 'CONFLICT'; state: IdempotencyState };

export interface ToolExecutionStore {
  reserve(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    actorId: string;
    input: unknown;
  }): Promise<IdempotencyReservation>;
  get(lookup: ToolExecutionLookup): Promise<unknown | null>;
  commit(commit: ToolExecutionCommit): Promise<void>;
  fail(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    error: unknown;
    retryable: boolean;
  }): Promise<void>;
}

export interface ToolExecutionDependencies {
  authorize: (request: ToolExecutionRequest) => Promise<boolean>;
  execute: (request: ToolExecutionRequest) => Promise<unknown>;
  persistResultAndPublishOutbox?: (commit: ToolExecutionCommit) => Promise<void>;
  store?: ToolExecutionStore;
}

export class ToolPermissionDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool permission denied: ${toolName}`);
    this.name = 'ToolPermissionDeniedError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key conflict: ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyInProgressError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency operation already in progress: ${idempotencyKey}`);
    this.name = 'IdempotencyInProgressError';
  }
}

export class IdempotencyFinalFailureError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency operation permanently failed: ${idempotencyKey}`);
    this.name = 'IdempotencyFinalFailureError';
  }
}

export class ToolExecutionService {
  private readonly results = new Map<string, ToolExecutionResult>();
  private readonly inFlight = new Map<string, Promise<ToolExecutionResult>>();

  constructor(private readonly dependencies: ToolExecutionDependencies) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    if (!(await this.dependencies.authorize(request))) {
      throw new ToolPermissionDeniedError(request.tool.name);
    }

    const durable = this.dependencies.store;
    if (durable) {
      const reservation = await durable.reserve({
        idempotencyKey: request.idempotencyKey,
        tenantId: request.context.tenantId,
        toolName: request.tool.name,
        actorId: request.context.actorId,
        input: request.input,
      });
      if (reservation.kind === 'REPLAY') return { output: reservation.output, replayed: true };
      if (reservation.kind === 'CONFLICT') {
        if (reservation.state === 'IN_PROGRESS') throw new IdempotencyInProgressError(request.idempotencyKey);
        if (reservation.state === 'FAILED_FINAL') throw new IdempotencyFinalFailureError(request.idempotencyKey);
        throw new IdempotencyConflictError(request.idempotencyKey);
      }
    } else {
      const existing = this.results.get(request.idempotencyKey);
      if (existing) return { ...existing, replayed: true };
    }

    const existing = this.inFlight.get(request.idempotencyKey);
    if (existing) {
      const result = await existing;
      return { ...result, replayed: true };
    }

    const execution = this.executeOnce(request);
    this.inFlight.set(request.idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      this.inFlight.delete(request.idempotencyKey);
    }
  }

  private async executeOnce(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    let output: unknown;
    try {
      output = await this.dependencies.execute(request);
    } catch (error) {
      await this.dependencies.store?.fail({
        idempotencyKey: request.idempotencyKey,
        tenantId: request.context.tenantId,
        toolName: request.tool.name,
        error,
        retryable: isRetryableError(error),
      });
      throw error;
    }

    const commit: ToolExecutionCommit = {
      idempotencyKey: request.idempotencyKey,
      toolName: request.tool.name,
      tenantId: request.context.tenantId,
      actorId: request.context.actorId,
      output,
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: request.idempotencyKey,
        toolName: request.tool.name,
        tenantId: request.context.tenantId,
        actorId: request.context.actorId,
        output,
      },
    };

    if (this.dependencies.store) await this.dependencies.store.commit(commit);
    else if (this.dependencies.persistResultAndPublishOutbox) await this.dependencies.persistResultAndPublishOutbox(commit);

    const result: ToolExecutionResult = { output, replayed: false };
    this.results.set(request.idempotencyKey, result);
    return result;
  }
}

function isRetryableError(error: unknown): boolean {
  return !(error instanceof Error && error.name === 'NonRetryableToolError');
}
