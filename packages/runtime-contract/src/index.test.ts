import { describe, expect, it } from 'vitest';
import {
  RunState,
  assertValidRunStateTransition,
  type RunSnapshot,
  type ToolCall,
} from './index';

describe('runtime contract', () => {
  it('accepts a valid CREATED -> RUNNING transition', () => {
    expect(() => assertValidRunStateTransition(RunState.CREATED, RunState.RUNNING)).not.toThrow();
  });

  it('rejects a terminal -> RUNNING transition', () => {
    expect(() => assertValidRunStateTransition(RunState.COMPLETED, RunState.RUNNING)).toThrow(
      'Invalid run state transition: COMPLETED -> RUNNING',
    );
  });

  it('defines a recoverable snapshot boundary', () => {
    const snapshot: RunSnapshot = {
      runId: 'run-1',
      agentId: 'investment-agent',
      input: { task: 'screen' },
      state: RunState.WAITING,
      version: 3,
      turns: [],
      metadata: {},
    };

    expect(snapshot.version).toBe(3);
    expect(snapshot.state).toBe(RunState.WAITING);
    expect(snapshot.agentId).toBe('investment-agent');
  });

  it('defines a framework-neutral tool call contract', () => {
    const toolCall: ToolCall = {
      toolCallId: 'tool-call-1',
      name: 'screen_company',
      input: { companyId: 'company-1' },
      status: 'PENDING',
      idempotencyKey: 'run-1:tool-call-1',
    };

    expect(toolCall.status).toBe('PENDING');
  });
});
