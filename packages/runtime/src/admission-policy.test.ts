import { describe, expect, it } from 'vitest';
import {
  AdmissionDecision,
  decideWorkerAdmission,
} from './admission-policy';

describe('worker admission policy contract', () => {
  it('accepts work while process-local concurrency has capacity', () => {
    expect(decideWorkerAdmission({ activeCount: 1, maxConcurrency: 2 })).toBe(AdmissionDecision.ACCEPT);
  });

  it('deterministically defers work when process-local concurrency is saturated', () => {
    expect(decideWorkerAdmission({ activeCount: 2, maxConcurrency: 2 })).toBe(AdmissionDecision.DEFER);
    expect(decideWorkerAdmission({ activeCount: 3, maxConcurrency: 2 })).toBe(AdmissionDecision.DEFER);
  });

  it('rejects invalid admission bounds rather than silently changing capacity', () => {
    expect(() => decideWorkerAdmission({ activeCount: -1, maxConcurrency: 2 })).toThrow(RangeError);
    expect(() => decideWorkerAdmission({ activeCount: 0, maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => decideWorkerAdmission({ activeCount: 1.5, maxConcurrency: 2 })).toThrow(RangeError);
  });

  it('does not introduce a second authoritative queue state', () => {
    expect(AdmissionDecision).toEqual({ ACCEPT: 'ACCEPT', DEFER: 'DEFER' });
  });
});
