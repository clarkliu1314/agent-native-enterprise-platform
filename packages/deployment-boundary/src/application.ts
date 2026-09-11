import type {
  AgentRuntime,
  AgentRun,
  StartRunInput,
} from '@agent-native/runtime-contract';
import type { LlmGateway, LlmRequest, LlmResponse } from './llm-gateway';

export class DeploymentApplication {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly llmGateway?: LlmGateway,
  ) {}

  startRun(input: StartRunInput): Promise<AgentRun> {
    return this.runtime.startRun(input);
  }

  getRunState(runId: string): Promise<AgentRun> {
    return this.runtime.getRunState(runId);
  }

  completeWithModel(request: LlmRequest): Promise<LlmResponse> {
    if (!this.llmGateway) {
      throw new Error('LLM gateway is not configured');
    }
    return this.llmGateway.complete(request);
  }
}
