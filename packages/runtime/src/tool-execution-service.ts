import type { ToolKind } from '@agent-native/runtime-contract/durable';
import { LostFencingError, ToolPermissionDeniedError } from './errors';
import type { ToolInvoker, ToolPermission } from './ports';
import type { DurableRepositories } from './repositories';

export interface ToolExecutionInput {
  runId: string;
  agentId: string;
  fencingToken: bigint;
  toolCallId: string;
  toolName: string;
  kind: ToolKind;
  input: unknown;
  idempotencyKey: string;
}

export class ToolExecutionService {
  constructor(
    private readonly repos: DurableRepositories,
    private readonly permission: ToolPermission,
    private readonly invoker: ToolInvoker,
  ) {}

  async execute(input: ToolExecutionInput): Promise<unknown> {
    const allowed = await this.permission.authorize({ runId: input.runId, agentId: input.agentId, toolName: input.toolName, input: input.input });
    if (!allowed) throw new ToolPermissionDeniedError(input.toolName);

    const existing = await this.repos.getToolCall?.(input.toolCallId);
    if (existing && typeof existing === 'object' && existing !== null && 'output' in existing) return (existing as { output: unknown }).output;

    const output = await this.invoker.invoke({ toolName: input.toolName, input: input.input, idempotencyKey: input.idempotencyKey });
    if (input.kind === 'SIDE_EFFECTING') {
      const stillOwned = await this.repos.renewLease(input.runId, '', input.fencingToken, 1);
      if (!stillOwned) throw new LostFencingError(input.runId);
    }
    return output;
  }
}
