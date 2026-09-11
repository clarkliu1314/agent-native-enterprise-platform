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

export interface ToolExecutionLookup {
  idempotencyKey: string;
  tenantId: string;
  toolName: string;
}

/**
 * Durable idempotency/outbox storage contract.
 *
 * `get()` is deliberately tenant/tool scoped. An idempotency key is a retry token,
 * not an authorization boundary, so callers must not be able to retrieve another
 * tenant's result merely by guessing its key.
 */
export interface ToolExecutionStore {
  get(lookup: ToolExecutionLookup): Promise<unknown | null>;
  /** Atomically persist the successful result and its outbox event. */
  commit(commit: ToolExecutionCommit): Promise<void>;
}

export interface ToolExecutionDependencies {
  /** Must be evaluated before any side effect is attempted or result is disclosed. */
  authorize: (request: ToolExecutionRequest) => Promise<boolean>;
  /** Performs the actual external operation. */
  execute: (request: ToolExecutionRequest) => Promise<unknown>;
  /**
   * Lightweight reference persistence seam. Production callers should provide `store`
   * so idempotency survives process restarts and can coordinate multiple workers.
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
 * The application-facing pipeline is intentionally explicit:
 *   authorize -> idempotency lookup -> execute -> persist result + outbox
 *
 * IMPORTANT LIMITATION
 * --------------------
 * This service protects retries after a completed durable result exists. A truly
 * production-grade external side effect also needs the downstream operation to accept
 * and honor the same idempotency key (or an equivalent reservation/command protocol).
 * Otherwise a worker crash after the external effect but before our database COMMIT is
 * inherently ambiguous: the database cannot prove whether the remote effect happened.
 * Crash Recovery will build on this contract rather than pretending that PostgreSQL alone
 * can make an arbitrary remote API exactly-once.
 */
export class ToolExecutionService {
  /**
   * Process-local completed-result cache. It is an optimization only; never rely on it
   * for durability because it disappears when the worker restarts.
   */
  private readonly results = new Map<string, ToolExecutionResult>();

  /**
   * Process-local single-flight map. It closes the common same-worker race while the
   * durable store handles completed retries across workers.
   */
  private readonly inFlight = new Map<string, Promise<ToolExecutionResult>>();

  constructor(private readonly dependencies: ToolExecutionDependencies) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    // Authorization is checked first so an unauthorized actor cannot probe or reuse a
    // result belonging to another actor/tenant.
    if (!(await this.dependencies.authorize(request))) {
      throw new ToolPermissionDeniedError(request.tool.name);
    }

    // Durable lookup is scoped by tenant + tool + key. This prevents idempotency from
    // becoming an accidental cross-tenant data-disclosure mechanism.
    const durableOutput = await this.dependencies.store?.get({
      idempotencyKey: request.idempotencyKey,
      tenantId: request.context.tenantId,
      toolName: request.tool.name,
    });
    if (durableOutput !== null && durableOutput !== undefined) {
      return { output: durableOutput, replayed: true };
    }

    const existing = this.results.get(request.idempotencyKey);
    if (existing) {
      return { ...existing, replayed: true };
    }

    // Close the common in-process race where two identical Agent retries arrive together.
    // Cross-process coordination belongs to the durable persistence layer and, for a
    // remote side effect, to the downstream service's idempotency protocol.
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
    // A failed external operation reaches no success-persistence callback, so it cannot
    // emit a false successful completion event.
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

    // Prefer the durable store. It owns the database transaction that makes the result
    // and Outbox event an atomic unit. The callback remains a lightweight test seam.
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
