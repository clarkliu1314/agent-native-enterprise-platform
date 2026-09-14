import { describe, expect, it } from 'vitest';
import { RunState, type AgentRuntime } from '@agent-native/runtime-contract';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { DeploymentApplication } from '@agent-native/deployment-boundary';
import { createHandler, createVercelHandler } from './handler';

function runtimeDouble(): AgentRuntime {
  return {
    startRun: async (input) => ({ runId: 'run-1', agentId: input.agentId, state: RunState.CREATED, input: input.input, version: 0, metadata: {} }),
    executeTurn: async () => ({ turnId: 'turn-1', sequence: 1, input: null }),
    checkpoint: async () => ({ runId: 'run-1', agentId: 'agent-1', input: 'hello', state: RunState.CREATED, version: 0, turns: [], metadata: {} }),
    recover: async () => { throw new Error('worker-only'); },
    cancel: async () => { throw new Error('worker-only'); },
    getRunState: async () => ({ runId: 'run-1', agentId: 'agent-1', state: RunState.CREATED, input: 'hello', version: 0, metadata: {} }),
  };
}

describe('Vercel request boundary', () => {
  it('returns accepted run state without assuming request lifetime', async () => {
    const handler = createHandler(new DeploymentApplication(runtimeDouble()));
    const response = await handler(new Request('https://example.test/runs', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent-1', input: 'hello' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ state: RunState.CREATED });
  });

  it('rejects malformed run requests', async () => {
    const handler = createHandler(new DeploymentApplication(runtimeDouble()));
    const response = await handler(new Request('https://example.test/runs', {
      method: 'POST',
      body: JSON.stringify({ input: 'hello' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
  });

  it('rejects unsupported methods', async () => {
    const handler = createHandler(new DeploymentApplication(runtimeDouble()));
    const response = await handler(new Request('https://example.test/runs', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('accepts the durable RuntimeFacade used by production composition', async () => {
    const runtime: RuntimeFacade = {
      createRun: async () => ({
        run: {
          runId: 'run-durable-1',
          agentId: 'agent-1',
          state: 'QUEUED',
          input: 'hello',
          version: 0,
          metadata: {},
          fencingToken: 0n,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
        replayed: false,
      }),
      resumeRun: async () => { throw new Error('not used'); },
      executeRunBounded: async () => { throw new Error('not used'); },
      cancelRun: async () => { throw new Error('not used'); },
      approveRun: async () => { throw new Error('not used'); },
      getRun: async () => { throw new Error('not used'); },
      listRunEvents: async () => [],
      getRunCheckpoint: async () => null,
      getToolCall: async () => null,
    };
    const handler = createVercelHandler(runtime);
    const response = await handler(new Request('https://example.test/runs', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent-1', input: 'hello' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ runId: 'run-durable-1', state: 'QUEUED' });
  });
});
