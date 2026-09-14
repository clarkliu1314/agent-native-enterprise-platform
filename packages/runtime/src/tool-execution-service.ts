import { classifyError, safeMetric, type ObservabilityMetrics } from '@agent-native/observability';
import type { ToolKind } from '@agent-native/runtime-contract/durable';
import { LostFencingError, NonReplayableExecutionError, ToolPermissionDeniedError } from './errors';
import type { ToolInvoker, ToolPermission } from './ports';
import type { DurableRepositories } from './repositories';

export interface ToolExecutionInput {
  runId: string; agentId: string; owner: string; fencingToken: bigint; toolCallId: string;
  toolName: string; kind: ToolKind; input: unknown; idempotencyKey: string;
}

export interface ToolExecutionObservabilityOptions { metrics?: ObservabilityMetrics; }

export class ToolExecutionService {
  constructor(
    private readonly repos: DurableRepositories,
    private readonly permission: ToolPermission,
    private readonly invoker: ToolInvoker,
    private readonly observability: ToolExecutionObservabilityOptions = {},
  ) {}

  async execute(input: ToolExecutionInput): Promise<unknown> {
    const allowed = await this.permission.authorize({ runId: input.runId, agentId: input.agentId, toolName: input.toolName, input: input.input });
    if (!allowed) {
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_total', 1, { tool: input.toolName, outcome: 'REJECTED' }));
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_failed_total', 1, { tool: input.toolName, error_code: 'AUTHORIZATION_DENIED' }));
      throw new ToolPermissionDeniedError(input.toolName);
    }

    const getToolCall = this.repos.getToolCall;
    if (!getToolCall) throw new Error('Durable tool persistence is required');
    const existing = await getToolCall.call(this.repos, input.toolCallId);
    if (existing?.status === 'SUCCEEDED') {
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_total', 1, { tool: input.toolName, outcome: 'REPLAYED' }));
      return existing.output;
    }
    if (existing?.kind === 'SIDE_EFFECTING' && (existing.status === 'REQUESTED' || existing.status === 'RUNNING' || existing.status === 'WAITING')) {
      throw new NonReplayableExecutionError('tool', input.toolCallId);
    }

    const createToolCall = this.repos.createToolCall;
    const completeToolCall = this.repos.completeToolCall;
    if (!createToolCall || !completeToolCall) throw new Error('Durable tool persistence is required');

    await createToolCall.call(this.repos, { toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, idempotencyKey: input.idempotencyKey, toolName: input.toolName, kind: input.kind, status: 'RUNNING', input: input.input });
    try {
      const output = await this.invoker.invoke({ toolName: input.toolName, input: input.input, idempotencyKey: input.idempotencyKey });
      const persisted = await completeToolCall.call(this.repos, { toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, status: 'SUCCEEDED', output });
      if (!persisted) throw new LostFencingError(input.runId);
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_total', 1, { tool: input.toolName, outcome: 'SUCCEEDED' }));
      return output;
    } catch (error) {
      if (error instanceof LostFencingError) {
        safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_failed_total', 1, { tool: input.toolName, error_code: classifyError(error) }));
        throw error;
      }
      await completeToolCall.call(this.repos, { toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_total', 1, { tool: input.toolName, outcome: 'FAILED' }));
      safeMetric(() => this.observability.metrics?.increment('agent_tool_execution_failed_total', 1, { tool: input.toolName, error_code: classifyError(error) }));
      throw error;
    }
  }
}
