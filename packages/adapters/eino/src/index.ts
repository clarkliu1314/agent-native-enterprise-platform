import type { AgentRuntime } from '@agent-native/runtime-contract';
import { createReferenceAdapter, type AgentFrameworkAdapter } from '@agent-native/adapter-core';

export function createEinoAdapter(runtime: AgentRuntime): AgentFrameworkAdapter {
  return createReferenceAdapter('eino', runtime, ['turns', 'checkpoint', 'recovery', 'cancellation']);
}
