/**
 * Framework-neutral tool execution boundary.
 *
 * AgentScope/LangGraph/Eino/Mastra adapters must enter the application through this
 * service instead of invoking effectful tools directly. That keeps authorization,
 * idempotency, and outbox rules in one auditable location.
 */

export interface ToolDefinition {
  /** Stable enterprise tool name, for example `crm.create_company`. */
  name: string;
  description: string;
  /** True when invocation can mutate external or durable state. */
  sideEffect: boolean;
}

export interface ToolExecutionContext {
  actorId: string;
  tenantId: string;
  /** Permission strings already resolved by the policy layer. */
  permissions: string[];
}

export interface ToolExecutionRequest {
  tool: ToolDefinition;
  input: unknown;
  context: ToolExecutionContext;
  /** Stable caller-owned key reused for every retry of one logical command. */
  idempotencyKey: string;
}

export interface ToolExecutionResult {
  output: unknown;
  /** True when this call reused a previously completed logical operation. */
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

/**
 * Durable idempotency/outbox storage contract.
 *
 * The runtime only depends on this tiny interface. PostgreSQL, a test store, or a future
 * enterprise persistence service can implement it without changing any Agent adapter.
 */
export interface ToolExecutionStore {
  get(idempotencyKey: string): Promise<unknown | null>;
  commit(commit: ToolExecutionCommit): Promise<void>;
}

export interface ToolExecutionDependencies {
  /** Must be evaluated before any side effect is attempted. */
  authorize: (request: ToolExecutionRequest) => Promise<boolean>;
  /** Performs the actual external operation. */
  execute: (request: ToolExecutionRequest) => Promise<unknown>;
  /**
   * Reference persistence hook. It is intentionally optional because production callers
   * should provide `store`, while small unit tests can exercise the execution ordering.
   */
  persistResultAndPublishOutbox?: (commit: ToolExecutionCommit) => Promise<void>;
  /** Durable store used by production runtimes. */
  store?: ToolExecutionStore;
}

export class ToolPermissionDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool permission denied: ${toolName}`);
    this.name = 'ToolPermissionDeniedError';
  }
}

/**
 * Reference execution service.
 *
 * The pipeline is explicit and should remain stable:
 *   authorize -> idempotency -> execute -> persist result + outbox
 *
 * When `store` is supplied, idempotency survives process restarts and is safe to share
 * across workers. The local maps are only a single-process optimization for the reference
 * implementation and must never be treated as the enterprise durability mechanism.
 */
export class ToolExecutionService {
  private readonly results = new Map<string, ToolExecutionResult>();
  private readonly inFlight = new Map<string, Promise<ToolExecutionResult>>();

  constructor(private readonly dependencies: ToolExecutionDependencies) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    // Authorization is checked before idempotency lookup so an unauthorized actor cannot
    // probe or reuse a result belonging to another actor/tenant.
    if (!(await this.dependencies.authorize(request))) {
      throw new ToolPermissionDeniedError(request.tool.name);
    }

    const durableOutput = await this.dependencies.store?.get(request.idempotencyKey);
    if (durableOutput !== null && durableOutput !== undefined) {
      return { output: durableOutput, replayed: true };
    }

    const existing = this.results.get(request.idempotencyKey);
    if (existing) {
      return { ...existing, replayed: true };
    }

    // Close the common in-process race where two identical Agent retries arrive together.
    // Cross-process uniqueness is enforced by the durable store's database constraint.
    const running = this.inFlight.get(request.idempotencyKey);
    if (running) {
      const result = await running;
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
    // A failed external operation reaches no persistence callback, so it cannot emit a
    // false successful completion event.
    const output = await this.dependencies.execute(request);

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

    // Prefer the durable store. It is responsible for making result + outbox one
    // transaction. The callback remains available as a lightweight reference seam for
    // unit tests and alternate transactional implementations.
    if (this.dependencies.store) {
      await this.dependencies.store.commit(commit);
    } else if (this.dependencies.persistResultAndPublishOutbox) {
      await this.dependencies.persistResultAndPublishOutbox(commit);
    }

    const result: ToolExecutionResult = { output, replayed: false };
    this.results.set(request.idempotencyKey, result);
    return result;
  }
}
