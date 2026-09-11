import type { AgentRuntime } from '@agent-native/runtime-contract';
import { createReferenceAdapter, type AgentFrameworkAdapter } from '@agent-native/adapter-core';

export function createLangGraphAdapter(runtime: AgentRuntime): AgentFrameworkAdapter {
  return createReferenceAdapter('langgraph', runtime, ['turns', 'checkpoint', 'recovery', 'cancellation']);
}
