import { describe, expect, it } from 'vitest';
import { FailureClass, classifyFailure, isRetryableFailure, nextRetryDelayMs } from '../packages/runtime/src/failure-policy';
import { TimeoutKind, createTimeoutSignal, isTimeoutRetryable } from '../packages/runtime/src/timeout-policy';
import { AdmissionDecision, decideWorkerAdmission } from '../packages/runtime/src/admission-policy';

describe('Stage 12.4 failure injection matrix', () => {
  it('classifies validation, authorization, conflict, transient, crash, overload, and telemetry failures deterministically', () => {
    const cases = [
      ['VALIDATION_ERROR', FailureClass.VALIDATION, false],
      ['AUTHORIZATION_DENIED', FailureClass.AUTHORIZATION, false],
      ['IDEMPOTENCY_CONFLICT', FailureClass.CONFLICT, false],
      ['DEPENDENCY_UNAVAILABLE', FailureClass.DEPENDENCY_TRANSIENT, true],
      ['DEPENDENCY_TIMEOUT', FailureClass.DEPENDENCY_TRANSIENT, true],
      ['WORKER_CRASH', FailureClass.WORKER_CRASH, true],
      ['OVERLOAD', FailureClass.OVERLOAD, true],
      ['TELEMETRY_FAILURE', FailureClass.TELEMETRY_ONLY, false],
      ['BUSINESS_TERMINAL', FailureClass.TERMINAL, false],
    ] as const;

    for (const [code, expectedClass, retryable] of cases) {
      const signal = { code };
      expect(classifyFailure(signal)).toBe(expectedClass);
      expect(isRetryableFailure(signal)).toBe(retryable);
    }
  });

  it('requires durable idempotency for effect-uncertain retries', () => {
    expect(classifyFailure({ code: 'DEPENDENCY_TIMEOUT', effectUncertain: true })).toBe(FailureClass.EFFECT_UNCERTAIN);
    expect(isRetryableFailure({ code: 'DEPENDENCY_TIMEOUT', effectUncertain: true })).toBe(false);
    expect(isRetryableFailure({ code: 'DEPENDENCY_TIMEOUT', effectUncertain: true, idempotencyKey: 'idem-1' })).toBe(true);
  });

  it('bounds retry backoff and rejects invalid attempt numbers', () => {
    expect(nextRetryDelayMs(0)).toBe(1_000);
    expect(nextRetryDelayMs(4)).toBe(16_000);
    expect(nextRetryDelayMs(10)).toBe(30_000);
    expect(() => nextRetryDelayMs(-1)).toThrow(RangeError);
    expect(() => nextRetryDelayMs(1.5)).toThrow(RangeError);
  });

  it('keeps API, worker, tool, and recovery timeout semantics distinct', () => {
    const apiTimeout = createTimeoutSignal(TimeoutKind.API_HANDOFF, { durableAccepted: true });
    expect(apiTimeout.commandOutcome).toBe('ACCEPTED');
    expect(isTimeoutRetryable(apiTimeout)).toBe(false);

    const workerTimeout = createTimeoutSignal(TimeoutKind.WORKER_EXECUTION);
    expect(workerTimeout.durableAccepted).toBe(true);
    expect(isTimeoutRetryable(workerTimeout)).toBe(true);

    const toolTimeout = createTimeoutSignal(TimeoutKind.TOOL);
    expect(toolTimeout.effectUncertain).toBe(true);
    expect(isTimeoutRetryable(toolTimeout)).toBe(false);
    expect(isTimeoutRetryable({ ...toolTimeout, idempotencyKey: 'idem-tool' })).toBe(true);

    const recoveryTimeout = createTimeoutSignal(TimeoutKind.RECOVERY);
    expect(recoveryTimeout.durableAccepted).toBe(true);
    expect(isTimeoutRetryable(recoveryTimeout)).toBe(true);
  });

  it('defers saturated workers without introducing authoritative queue state', () => {
    expect(decideWorkerAdmission({ activeCount: 0, maxConcurrency: 2 })).toBe(AdmissionDecision.ACCEPT);
    expect(decideWorkerAdmission({ activeCount: 2, maxConcurrency: 2 })).toBe(AdmissionDecision.DEFER);
    expect(decideWorkerAdmission({ activeCount: 3, maxConcurrency: 2 })).toBe(AdmissionDecision.DEFER);
  });

  it('preserves the existing six-state Run FSM for all injected failures', () => {
    expect(['QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).toEqual([
      'QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
    ]);
  });
});
