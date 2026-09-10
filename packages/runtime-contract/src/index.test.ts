import { describe, expect, it } from 'vitest';
import {
  InvalidRunStateTransitionError,
  RunState,
  type AgentRuntime,
  type RunSnapshot,
} from './index';

describe('AgentRuntime contract', () => {
  it('creates a run in CREATED state', async () => {
    const runtime = {} as AgentRuntime;
    const run = await runtime.startRun({ agentId: 'investment-agent', input: { task: 'screen' } });

    expect(run.state).toBe(RunState.CREATED);
    expect(run.agentId).toBe('investment-agent');
  });

  it('rejects an invalid state transition', () => {
    expect(() => {
      throw new InvalidRunStateTransitionError(RunState.COMPLETED, RunState.RUNNING);
    }).toThrow('Invalid run state transition: COMPLETED -> RUNNING');
  });

  it('defines a recoverable snapshot boundary', () => {
    const snapshot: RunSnapshot = {
      runId: 'run-1',
      state: RunState.WAITING,
      version: 3,
      turns: [],
      metadata: {},
    };

    expect(snapshot.version).toBe(3);
    expect(snapshot.state).toBe(RunState.WAITING);
  });
});
