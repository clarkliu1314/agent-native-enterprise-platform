/**
 * Framework-neutral tool execution boundary.
 *
 * This module intentionally knows nothing about AgentScope, LangGraph, Eino, or Mastra.
 * Framework adapters call this service through the application runtime contract so that
 * authorization, idempotency, and event publication cannot accidentally be bypassed.
 */

export interface ToolDefinition {
  /** Stable enterprise tool name, e.g. `crm.create_company`. */
  name: string;
  description: string;
  /** Marks whether invoking the tool can change external or durable state. */
  sideEffect: boolean;
}

export interface ToolExecutionContext {
  actorId: string;
  tenantId: string;
  /** Permission strings resolved by the policy layer for this actor/run. */
  permissions: string[];
}

export interface ToolExecutionRequest {
  tool: ToolDefinition;
  input: unknown;
  context: ToolExecutionContext;
  /** Caller-owned stable key. Retries of the same logical command must reuse it. */
  idempotencyKey: string;
}

export interface ToolExecutionResult {
  /** The actual tool result returned to the Agent Runtime. */
  output: unknown;
  /** True when the result came from an earlier idempotent execution. */
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

export interface ToolExecutionDependencies {
  /**
   * Authorization is deliberately the first dependency invoked. For a side-effecting
   * tool, a false result must prevent any call to `execute`.
   */
  authorize: (request: ToolExecutionRequest) => Promise<boolean>;
  /** Performs the actual external operation. */
  execute: (request: ToolExecutionRequest) => Promise<unknown>;
  /**
   * Publishes the durable event after a successful execution. A future PostgreSQL-backed
   * implementation will execute this in the same transaction as the idempotency record.
   */
  publishOutbox?: (event: ToolExecutionOutboxEvent) => Promise<void>;
}

export class ToolPermissionDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool permission denied: ${toolName}`);
    this.name = 'ToolPermissionDeniedError';
  }
}

/**
 * Minimal reference implementation of the execution semantics.
 *
 * The in-memory idempotency map is intentionally small and deterministic for unit tests.
 * Production persistence is introduced behind the same contract so that the Agent Runtime
 * does not need to know whether it is running against memory or PostgreSQL.
 */
export class ToolExecutionService {
  private readonly results = new Map<string, ToolExecutionResult>();

  constructor(private readonly dependencies: ToolExecutionDependencies) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    // Authorization must precede the idempotency lookup as well as the external effect:
    // otherwise an unauthorized retry could learn or reuse another actor's result.
    const authorized = await this.dependencies.authorize(request);
    if (!authorized) {
      throw new ToolPermissionDeniedError(request.tool.name);
    }

    // A successful prior result is the source of truth for a retry. This is what prevents
    // an Agent retry after a timeout from issuing the external command twice.
    const existing = this.results.get(request.idempotencyKey);
    if (existing) {
      return { ...existing, replayed: true };
    }

    const output = await this.dependencies.execute(request);
    const result: ToolExecutionResult = { output, replayed: false };

    // The outbox callback is invoked only after the external operation has succeeded.
    // In the durable implementation this write must be part of the same DB transaction
    // that records the idempotency result; keeping it behind a dependency makes that
    // transaction boundary explicit rather than hiding it inside an Agent framework.
    if (this.dependencies.publishOutbox) {
      await this.dependencies.publishOutbox({
        type: 'tool.execution.completed',
        idempotencyKey: request.idempotencyKey,
        toolName: request.tool.name,
        tenantId: request.context.tenantId,
        actorId: request.context.actorId,
        output,
      });
    }

    this.results.set(request.idempotencyKey, result);
    return result;
  }
}
