import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { createDurableHandler } from './durable-handler';

const baseRun = (state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' = 'QUEUED') => ({ runId: 'run-1', agentId: 'agent', state, input: {}, metadata: {}, fencingToken: state === 'RUNNING' ? 1n : 0n, attempt: state === 'RUNNING' ? 1 : 0, createdAt: new Date(0).toISOString() });

function runtimeDouble(executeResult: { state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED'; terminal: boolean } = { state: 'SUCCEEDED', terminal: true }): RuntimeFacade {
  return {
    createRun: vi.fn(async () => ({ run: baseRun(), replayed: false })),
    executeRunBounded: vi.fn(async () => ({ run: baseRun(executeResult.state), terminal: executeResult.terminal })),
    getRun: vi.fn(async () => baseRun()),
    resumeRun: vi.fn(), cancelRun: vi.fn(), approveRun: vi.fn(), listRunEvents: vi.fn(), getRunCheckpoint: vi.fn(), getToolCall: vi.fn(),
  } as unknown as RuntimeFacade;
}

describe('durable Vercel handler', () => {
  it('returns 202 for default async admission', async () => {
    const runtime = runtimeDouble();
    const response = await createDurableHandler(runtime)(new Request('https://example.test/runs', { method: 'POST', body: JSON.stringify({ agentId: 'agent', input: {} }) }));
    expect(response.status).toBe(202);
    expect(runtime.executeRunBounded).not.toHaveBeenCalled();
  });

  it('returns 200 for bounded sync completion', async () => {
    const runtime = runtimeDouble();
    const response = await createDurableHandler(runtime)(new Request('https://example.test/runs', { method: 'POST', body: JSON.stringify({ agentId: 'agent', input: {}, executionMode: 'sync' }) }));
    expect(response.status).toBe(200);
    expect(runtime.executeRunBounded).toHaveBeenCalledOnce();
  });

  it('returns 202 when bounded sync execution reaches its durable deadline', async () => {
    const runtime = runtimeDouble({ state: 'RUNNING', terminal: false });
    const response = await createDurableHandler(runtime, { syncBudgetMs: 1 })(new Request('https://example.test/runs', { method: 'POST', body: JSON.stringify({ agentId: 'agent', input: {}, executionMode: 'sync' }) }));
    expect(response.status).toBe(202);
    expect(runtime.executeRunBounded).toHaveBeenCalledOnce();
  });

  it('reads durable state through GET /runs/:id', async () => {
    const runtime = runtimeDouble();
    const response = await createDurableHandler(runtime)(new Request('https://example.test/runs/run-1', { method: 'GET' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId: 'run-1' });
  });
});
