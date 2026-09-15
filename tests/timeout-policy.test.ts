import { describe, expect, it } from 'vitest';
import {
  TimeoutKind,
  createTimeoutSignal,
  isTimeoutRetryable,
} from '../packages/runtime/src/timeout-policy';

describe('timeout policy contract', () => {
  it('distinguishes API handoff, worker, tool, and recovery boundaries', () => {
    expect(createTimeoutSignal(TimeoutKind.API_HANDOFF)).toMatchObject({ kind: TimeoutKind.API_HANDOFF, durableAccepted: false });
    expect(createTimeoutSignal(TimeoutKind.WORKER_EXECUTION)).toMatchObject({ kind: TimeoutKind.WORKER_EXECUTION, durableAccepted: true });
    expect(createTimeoutSignal(TimeoutKind.TOOL)).toMatchObject({ kind: TimeoutKind.TOOL, effectUncertain: true });
    expect(createTimeoutSignal(TimeoutKind.RECOVERY)).toMatchObject({ kind: TimeoutKind.RECOVERY, durableAccepted: true });
  });

  it('does not treat an API timeout after durable acceptance as command failure', () => {
    const signal = createTimeoutSignal(TimeoutKind.API_HANDOFF, { durableAccepted: true });
    expect(signal.commandOutcome).toBe('ACCEPTED');
    expect(isTimeoutRetryable(signal)).toBe(false);
  });

  it('requires durable idempotency before retrying an effect-uncertain tool timeout', () => {
    const uncertain = createTimeoutSignal(TimeoutKind.TOOL, { effectUncertain: true });
    expect(isTimeoutRetryable(uncertain)).toBe(false);
    expect(isTimeoutRetryable({ ...uncertain, idempotencyKey: 'idem-tool-1' })).toBe(true);
  });

  it('keeps timeout policy outside the existing Run FSM', () => {
    expect(TimeoutKind).toEqual({ API_HANDOFF: 'API_HANDOFF', WORKER_EXECUTION: 'WORKER_EXECUTION', TOOL: 'TOOL', RECOVERY: 'RECOVERY' });
  });
});
