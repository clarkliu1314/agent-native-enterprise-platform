import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  FailureClass,
  isRetryableFailure,
  nextRetryDelayMs,
} from '../packages/runtime/src/failure-policy';

describe('failure policy contract', () => {
  it('classifies validation, authorization, and conflict failures as terminal', () => {
    expect(classifyFailure({ code: 'VALIDATION_ERROR' })).toBe(FailureClass.VALIDATION);
    expect(classifyFailure({ code: 'AUTHORIZATION_DENIED' })).toBe(FailureClass.AUTHORIZATION);
    expect(classifyFailure({ code: 'IDEMPOTENCY_CONFLICT' })).toBe(FailureClass.CONFLICT);
    expect(isRetryableFailure({ code: 'VALIDATION_ERROR' })).toBe(false);
    expect(isRetryableFailure({ code: 'AUTHORIZATION_DENIED' })).toBe(false);
    expect(isRetryableFailure({ code: 'IDEMPOTENCY_CONFLICT' })).toBe(false);
  });

  it('classifies transient dependencies and worker crashes as retryable', () => {
    expect(classifyFailure({ code: 'DEPENDENCY_UNAVAILABLE' })).toBe(FailureClass.DEPENDENCY_TRANSIENT);
    expect(classifyFailure({ code: 'WORKER_CRASH' })).toBe(FailureClass.WORKER_CRASH);
    expect(isRetryableFailure({ code: 'DEPENDENCY_UNAVAILABLE' })).toBe(true);
    expect(isRetryableFailure({ code: 'WORKER_CRASH' })).toBe(true);
  });

  it('keeps effect uncertainty explicit and retryable only when durable idempotency is present', () => {
    expect(classifyFailure({ code: 'TOOL_TIMEOUT', effectUncertain: true })).toBe(FailureClass.EFFECT_UNCERTAIN);
    expect(isRetryableFailure({ code: 'TOOL_TIMEOUT', effectUncertain: true, idempotencyKey: 'idem-1' })).toBe(true);
    expect(isRetryableFailure({ code: 'TOOL_TIMEOUT', effectUncertain: true })).toBe(false);
  });

  it('uses bounded exponential backoff without exceeding the policy cap', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(10)).toBe(30000);
    expect(nextRetryDelayMs(99)).toBe(30000);
  });

  it('does not introduce a new run lifecycle state', () => {
    expect(Object.values(FailureClass)).toEqual([
      'VALIDATION',
      'AUTHORIZATION',
      'CONFLICT',
      'DEPENDENCY_TRANSIENT',
      'WORKER_CRASH',
      'EFFECT_UNCERTAIN',
      'TERMINAL',
      'OVERLOAD',
      'TELEMETRY_ONLY',
    ]);
  });
});
