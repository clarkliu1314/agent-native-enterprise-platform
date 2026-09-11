import type { AgentRuntime } from '@agent-native/runtime-contract';
import { createReferenceAdapter, type AgentFrameworkAdapter } from '@agent-native/adapter-core';

export function createMastraAdapter(runtime: AgentRuntime): AgentFrameworkAdapter {
  return createReferenceAdapter('mastra', runtime, ['turns', 'checkpoint', 'recovery', 'cancellation']);
}
