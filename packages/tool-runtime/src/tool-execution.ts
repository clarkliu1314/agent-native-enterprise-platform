import { classifyError, createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger } from '@agent-native/observability';

export interface ToolDefinition { name: string; description: string; sideEffect: boolean; }
export interface ToolExecutionContext { actorId: string; tenantId: string; permissions: string[]; }
export interface ToolExecutionRequest { tool: ToolDefinition; input: unknown; context: ToolExecutionContext; idempotencyKey: string; }
export interface ToolExecutionResult { output: unknown; replayed: boolean; }
export interface ToolExecutionCorrelation { requestId: string; traceId: string; tenantId: string; runId?: string; workflowId?: string; agentId?: string; actorId?: string; }
export interface ToolExecutionOutboxEvent { type: 'tool.execution.completed'; idempotencyKey: string; toolName: string; tenantId: string; actorId: string; output: unknown; correlation?: ToolExecutionCorrelation; }
export interface ToolExecutionCommit { idempotencyKey: string; toolName: string; tenantId: string; actorId: string; output: unknown; outboxEvent: ToolExecutionOutboxEvent; }
export interface ToolExecutionLookup { idempotencyKey: string; tenantId: string; toolName: string; }
export type IdempotencyState = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
export type IdempotencyReservation =
  | { kind: 'RESERVED'; state: 'IN_PROGRESS' }
  | { kind: 'REPLAY'; state: 'SUCCEEDED'; output: unknown }
  | { kind: 'RETRY'; state: 'FAILED_RETRYABLE' }
  | { kind: 'CONFLICT'; state: IdempotencyState };
export interface ToolExecutionStore {
  reserve(input: { idempotencyKey: string; tenantId: string; toolName: string; actorId: string; input: unknown }): Promise<IdempotencyReservation>;
  get(lookup: ToolExecutionLookup): Promise<unknown | null>;
  commit(commit: ToolExecutionCommit): Promise<void>;
  fail(input: { idempotencyKey: string; tenantId: string; toolName: string; error: unknown; retryable: boolean }): Promise<void>;
  reconcileReplay?(request: ToolExecutionRequest, output: unknown): Promise<void>;
}
export interface ToolExecutionDependencies {
  authorize: (request: ToolExecutionRequest) => Promise<boolean>;
  execute: (request: ToolExecutionRequest) => Promise<unknown>;
  persistResultAndPublishOutbox?: (commit: ToolExecutionCommit) => Promise<void>;
  store?: ToolExecutionStore;
}
export interface ToolExecutionObservabilityOptions { logger?: ObservabilityLogger; correlation?: CorrelationContext; }

export class ToolPermissionDeniedError extends Error { constructor(toolName: string) { super(`Tool permission denied: ${toolName}`); this.name = 'ToolPermissionDeniedError'; } }
export class IdempotencyConflictError extends Error { constructor(idempotencyKey: string) { super(`Idempotency key conflict: ${idempotencyKey}`); this.name = 'IdempotencyConflictError'; } }
export class IdempotencyInProgressError extends Error { constructor(idempotencyKey: string) { super(`Idempotency operation already in progress: ${idempotencyKey}`); this.name = 'IdempotencyInProgressError'; } }
export class IdempotencyFinalFailureError extends Error { constructor(idempotencyKey: string) { super(`Idempotency operation permanently failed: ${idempotencyKey}`); this.name = 'IdempotencyFinalFailureError'; } }

export class ToolExecutionService {
  private readonly results = new Map<string, ToolExecutionResult>();
  private readonly inFlight = new Map<string, Promise<ToolExecutionResult>>();

  constructor(private readonly dependencies: ToolExecutionDependencies, private readonly observability: ToolExecutionObservabilityOptions = {}) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const context = this.observability.correlation ? { ...this.observability.correlation, tenantId: request.context.tenantId } : undefined;
    if (!(await this.dependencies.authorize(request))) {
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.rejected', level: 'WARN', outcome: 'REJECTED', errorCode: 'AUTHORIZATION_DENIED', attributes: { toolName: request.tool.name } }));
      throw new ToolPermissionDeniedError(request.tool.name);
    }

    const durable = this.dependencies.store;
    if (durable) {
      const reservation = await durable.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input });
      if (reservation.kind === 'REPLAY') {
        await durable.reconcileReplay?.(request, reservation.output);
        if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.replayed', level: 'INFO', outcome: 'SUCCEEDED', attributes: { toolName: request.tool.name, replayed: true } }));
        return { output: reservation.output, replayed: true };
      }
      if (reservation.kind === 'CONFLICT') {
        if (reservation.state === 'IN_PROGRESS') throw new IdempotencyInProgressError(request.idempotencyKey);
        if (reservation.state === 'FAILED_FINAL') throw new IdempotencyFinalFailureError(request.idempotencyKey);
        throw new IdempotencyConflictError(request.idempotencyKey);
      }
    } else {
      const existing = this.results.get(request.idempotencyKey);
      if (existing) {
        if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.replayed', level: 'INFO', outcome: 'SUCCEEDED', attributes: { toolName: request.tool.name, replayed: true } }));
        return { ...existing, replayed: true };
      }
    }

    const existing = this.inFlight.get(request.idempotencyKey);
    if (existing) {
      const result = await existing;
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.replayed', level: 'INFO', outcome: 'SUCCEEDED', attributes: { toolName: request.tool.name, replayed: true } }));
      return { ...result, replayed: true };
    }
    if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.started', level: 'INFO', outcome: 'STARTED', attributes: { toolName: request.tool.name, sideEffect: request.tool.sideEffect } }));

    const execution = this.executeOnce(request);
    this.inFlight.set(request.idempotencyKey, execution);
    try {
      const result = await execution;
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.succeeded', level: 'INFO', outcome: 'SUCCEEDED', durationMs: Date.now() - startedAt, attributes: { toolName: request.tool.name, replayed: false } }));
      return result;
    } catch (error) {
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({ context, event: 'tool.failed', level: 'ERROR', outcome: 'FAILED', durationMs: Date.now() - startedAt, errorCode: classifyError(error), attributes: { toolName: request.tool.name } }));
      throw error;
    } finally { this.inFlight.delete(request.idempotencyKey); }
  }

  private async executeOnce(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    let output: unknown;
    try { output = await this.dependencies.execute(request); }
    catch (error) {
      await this.dependencies.store?.fail({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, error, retryable: isRetryableError(error) });
      throw error;
    }
    const correlation = this.observability.correlation;
    const commit: ToolExecutionCommit = {
      idempotencyKey: request.idempotencyKey, toolName: request.tool.name, tenantId: request.context.tenantId, actorId: request.context.actorId, output,
      outboxEvent: { type: 'tool.execution.completed', idempotencyKey: request.idempotencyKey, toolName: request.tool.name, tenantId: request.context.tenantId, actorId: request.context.actorId, output, ...(correlation ? { correlation: { ...correlation, actorId: correlation.actorId ?? request.context.actorId } } : {}) },
    };
    if (this.dependencies.store) await this.dependencies.store.commit(commit);
    else if (this.dependencies.persistResultAndPublishOutbox) await this.dependencies.persistResultAndPublishOutbox(commit);
    const result: ToolExecutionResult = { output, replayed: false }; this.results.set(request.idempotencyKey, result); return result;
  }
}
function isRetryableError(error: unknown): boolean { return !(error instanceof Error && error.name === 'NonRetryableToolError'); }
