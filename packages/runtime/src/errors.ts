export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = 'RunNotFoundError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key conflict: ${key}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class LostFencingError extends Error {
  constructor(runId: string) {
    super(`Lost fencing ownership for run: ${runId}`);
    this.name = 'LostFencingError';
  }
}

export class ToolPermissionDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool permission denied: ${toolName}`);
    this.name = 'ToolPermissionDeniedError';
  }
}

export class NonReplayableExecutionError extends Error {
  constructor(kind: string, id: string) {
    super(`Non-replayable ${kind} requires reconciliation: ${id}`);
    this.name = 'NonReplayableExecutionError';
  }
}
