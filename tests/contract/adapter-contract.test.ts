import { describe, expect, it } from 'vitest';
import { InMemoryAgentRuntime } from '@agent-native/runtime';
import { createAgentScopeAdapter } from '../../packages/adapters/agentscope/src';
import { createLangGraphAdapter } from '../../packages/adapters/langgraph/src';
import { createEinoAdapter } from '../../packages/adapters/eino/src';
import { createMastraAdapter } from '../../packages/adapters/mastra/src';
import type { AgentFrameworkAdapter } from '../../packages/adapters/core/src';

const adapters: Array<[string, (runtime: InMemoryAgentRuntime) => AgentFrameworkAdapter]> = [
  ['agentscope', createAgentScopeAdapter],
  ['langgraph', createLangGraphAdapter],
  ['eino', createEinoAdapter],
  ['mastra', createMastraAdapter],
];

describe('framework adapter contract', () => {
  for (const [name, createAdapter] of adapters) {
    it(`${name} exposes the same durable lifecycle`, async () => {
      const adapter = createAdapter(new InMemoryAgentRuntime());
      expect(adapter.framework).toBe(name);

      const run = await adapter.startRun({ agentId: 'benchmark-agent', input: { prompt: 'hello' } });
      expect(run.state).toBe('CREATED');

      const turn = await adapter.executeTurn(run.runId, { prompt: 'hello' });
      expect(turn.sequence).toBe(1);

      const snapshot = await adapter.checkpoint(run.runId);
      expect(snapshot.runId).toBe(run.runId);
      expect(snapshot.turns).toHaveLength(1);

      const recovered = await adapter.recover(snapshot);
      expect(recovered.runId).toBe(run.runId);
      expect((await adapter.getRunState(run.runId)).version).toBe(snapshot.version);

      const cancelled = await adapter.cancel(run.runId);
      expect(cancelled.state).toBe('CANCELLED');
    });
  }
});
