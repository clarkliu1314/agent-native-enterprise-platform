import type { AgentRuntime } from '@agent-native/runtime-contract';
import { createReferenceAdapter, type AgentFrameworkAdapter } from '@agent-native/adapter-core';

export function createAgentScopeAdapter(runtime: AgentRuntime): AgentFrameworkAdapter {
  return createReferenceAdapter('agentscope', runtime, ['turns', 'checkpoint', 'recovery', 'cancellation']);
}
