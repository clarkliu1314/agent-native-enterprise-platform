import type { ToolKind } from '@agent-native/runtime-contract/durable';
import { LostFencingError, ToolPermissionDeniedError } from './errors';
import type { ToolInvoker, ToolPermission } from './ports';
import type { DurableRepositories } from './repositories';

export interface ToolExecutionInput {
  runId: string; agentId: string; owner: string; fencingToken: bigint; toolCallId: string;
  toolName: string; kind: ToolKind; input: unknown; idempotencyKey: string;
}

export class ToolExecutionService {
  constructor(private readonly repos: DurableRepositories, private readonly permission: ToolPermission, private readonly invoker: ToolInvoker) {}

  async execute(input: ToolExecutionInput): Promise<unknown> {
    if (!this.repos.getToolCall || !this.repos.createToolCall || !this.repos.completeToolCall) throw new Error('Durable tool persistence is required');
    const allowed = await this.permission.authorize({ runId: input.runId, agentId: input.agentId, toolName: input.toolName, input: input.input });
    if (!allowed) throw new ToolPermissionDeniedError(input.toolName);
    const existing = await this.repos.getToolCall(input.toolCallId);
    if (existing?.status === 'SUCCEEDED') return existing.output;
    await this.repos.createToolCall({ toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, idempotencyKey: input.idempotencyKey, toolName: input.toolName, kind: input.kind, status: 'RUNNING', input: input.input });
    try {
      const output = await this.invoker.invoke({ toolName: input.toolName, input: input.input, idempotencyKey: input.idempotencyKey });
      const persisted = await this.repos.completeToolCall({ toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, status: 'SUCCEEDED', output });
      if (!persisted) throw new LostFencingError(input.runId);
      return output;
    } catch (error) {
      await this.repos.completeToolCall({ toolCallId: input.toolCallId, runId: input.runId, fencingToken: input.fencingToken, status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
