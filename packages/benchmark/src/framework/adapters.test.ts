import { describe, expect, it } from 'vitest';
import { InMemoryAgentRuntime } from '@agent-native/runtime';
import { benchmarkAdapters } from './types';
import { createBenchmarkAdapters } from './adapters';

describe('benchmark adapter execution contract', () => {
  it('creates one framework adapter per benchmark adapter name over the same runtime contract', () => {
    const runtime = new InMemoryAgentRuntime();
    const adapters = createBenchmarkAdapters(runtime);

    expect(adapters).toHaveLength(benchmarkAdapters.length);
    expect(adapters.map((adapter) => adapter.framework)).toEqual([...benchmarkAdapters]);
    for (const adapter of adapters) {
      expect(adapter.capabilities).toEqual(
        new Set(['turns', 'checkpoint', 'recovery', 'cancellation']),
      );
    }
  });

  it('executes a lifecycle through every framework adapter without framework-specific semantics', async () => {
    const runtime = new InMemoryAgentRuntime();
    const adapters = createBenchmarkAdapters(runtime);

    for (const adapter of adapters) {
      const run = await adapter.startRun({ agentId: 'benchmark-agent', input: { case: 'B01' } });
      const turn = await adapter.executeTurn(run.runId, { tool: 'read' });
      const snapshot = await adapter.checkpoint(run.runId);
      const recovered = await adapter.recover(snapshot);
      const state = await adapter.getRunState(run.runId);

      expect(turn.sequence).toBe(1);
      expect(snapshot.runId).toBe(run.runId);
      expect(recovered.runId).toBe(run.runId);
      expect(state.version).toBe(1);
    }
  });
});
