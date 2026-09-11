import type { AgentFrameworkAdapter } from '@agent-native/adapter-core';
import { createAgentScopeAdapter } from '@agent-native/adapter-agentscope';
import { createEinoAdapter } from '@agent-native/adapter-eino';
import { createLangGraphAdapter } from '@agent-native/adapter-langgraph';
import { createMastraAdapter } from '@agent-native/adapter-mastra';
import type { AgentRuntime } from '@agent-native/runtime-contract';
import type { BenchmarkAdapter } from './index';

const factories: Readonly<Record<BenchmarkAdapter, (runtime: AgentRuntime) => AgentFrameworkAdapter>> = {
  agentscope: createAgentScopeAdapter,
  langgraph: createLangGraphAdapter,
  eino: createEinoAdapter,
  mastra: createMastraAdapter,
};

export function createBenchmarkAdapters(runtime: AgentRuntime): AgentFrameworkAdapter[] {
  return Object.entries(factories).map(([name, factory]) => {
    const adapter = factory(runtime);
    if (adapter.framework !== name) {
      throw new Error(`Benchmark adapter identity mismatch: expected ${name}, got ${adapter.framework}`);
    }
    return adapter;
  });
}
