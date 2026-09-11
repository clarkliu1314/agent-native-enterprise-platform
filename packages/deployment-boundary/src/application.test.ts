import { describe, expect, it } from 'vitest';
import { RunState, type AgentRuntime } from '@agent-native/runtime-contract';
import { DeploymentApplication } from './application';

function runtimeDouble(): AgentRuntime {
  return {
    startRun: async (input) => ({
      runId: 'run-1',
      agentId: input.agentId,
      state: RunState.CREATED,
      input: input.input,
      version: 0,
      metadata: input.metadata ?? {},
    }),
    executeTurn: async () => ({ turnId: 'turn-1', sequence: 1, input: null }),
    checkpoint: async () => ({
      runId: 'run-1', agentId: 'agent-1', input: 'hello', state: RunState.CREATED,
      version: 0, turns: [], metadata: {},
    }),
    recover: async () => { throw new Error('not request-safe'); },
    cancel: async () => { throw new Error('not request-safe'); },
    getRunState: async () => ({
      runId: 'run-1', agentId: 'agent-1', state: RunState.CREATED,
      input: 'hello', version: 0, metadata: {},
    }),
  };
}

describe('deployment application boundary', () => {
  it('delegates request-safe operations without exposing worker-only operations', async () => {
    const app = new DeploymentApplication(runtimeDouble());
    const run = await app.startRun({ agentId: 'agent-1', input: 'hello' });

    expect(run.state).toBe(RunState.CREATED);
    expect('claimRecoveryCandidate' in app).toBe(false);
    expect('publishOutbox' in app).toBe(false);
  });
});
