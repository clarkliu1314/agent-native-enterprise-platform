import { describe, expect, it } from 'vitest';
import { RunState } from '@agent-native/runtime-contract';
import { InMemoryAgentRuntime } from './in-memory-runtime';

describe('InMemoryAgentRuntime', () => {
  it('starts a run in CREATED state with version 0', async () => {
    const runtime = new InMemoryAgentRuntime();

    const run = await runtime.startRun({
      agentId: 'investment-agent',
      input: { task: 'screen' },
    });

    expect(run.state).toBe(RunState.CREATED);
    expect(run.version).toBe(0);
    expect(run.agentId).toBe('investment-agent');
  });

  it('executes a turn, enters RUNNING, and increments the version', async () => {
    const runtime = new InMemoryAgentRuntime();
    const run = await runtime.startRun({ agentId: 'investment-agent', input: {} });

    const turn = await runtime.executeTurn(run.runId, { companyId: 'company-1' });
    const state = await runtime.getRunState(run.runId);

    expect(turn.sequence).toBe(1);
    expect(turn.input).toEqual({ companyId: 'company-1' });
    expect(turn.output).toEqual({ companyId: 'company-1' });
    expect(state.state).toBe(RunState.RUNNING);
    expect(state.version).toBe(1);
  });

  it('checkpoints turns and recovers them for continued execution', async () => {
    const runtime = new InMemoryAgentRuntime();
    const run = await runtime.startRun({ agentId: 'investment-agent', input: {} });
    await runtime.executeTurn(run.runId, { step: 1 });

    const snapshot = await runtime.checkpoint(run.runId);
    const recovered = new InMemoryAgentRuntime();
    await recovered.recover(snapshot);

    const nextTurn = await recovered.executeTurn(run.runId, { step: 2 });
    const recoveredSnapshot = await recovered.checkpoint(run.runId);

    expect(nextTurn.sequence).toBe(2);
    expect(recoveredSnapshot.turns).toHaveLength(2);
    expect(recoveredSnapshot.version).toBe(2);
  });

  it('cancels a run and makes cancellation idempotent', async () => {
    const runtime = new InMemoryAgentRuntime();
    const run = await runtime.startRun({ agentId: 'investment-agent', input: {} });

    const cancelled = await runtime.cancel(run.runId);
    const cancelledAgain = await runtime.cancel(run.runId);

    expect(cancelled.state).toBe(RunState.CANCELLED);
    expect(cancelledAgain.state).toBe(RunState.CANCELLED);
    expect(cancelledAgain.version).toBe(cancelled.version);
  });

  it('rejects execution after cancellation', async () => {
    const runtime = new InMemoryAgentRuntime();
    const run = await runtime.startRun({ agentId: 'investment-agent', input: {} });
    await runtime.cancel(run.runId);

    await expect(runtime.executeTurn(run.runId, { step: 1 })).rejects.toThrow(
      'Invalid run state transition: CANCELLED -> RUNNING',
    );
  });
});
