import { describe, expect, it } from 'vitest';
import { SLO_TARGETS, calculateErrorBudget, classifyBurnRate } from '../packages/observability/src/slo-policy';

describe('SLO and error-budget contract', () => {
  it('defines the Stage 12.4 rolling SLO baseline', () => {
    expect(SLO_TARGETS).toEqual({
      apiHandoffSuccess: 0.999,
      durableCommandCompletion: 0.99,
      workerRecoveryWithin60s: 0.99,
      outboxDeliveryWithin60s: 0.99,
      auditCompleteness: 1,
    });
  });

  it('calculates availability error budget as one minus the SLO target', () => {
    expect(calculateErrorBudget(0.999)).toBeCloseTo(0.001);
    expect(calculateErrorBudget(0.99)).toBeCloseTo(0.01);
    expect(calculateErrorBudget(1)).toBe(0);
  });

  it('classifies fast and slow burn without introducing metric labels', () => {
    expect(classifyBurnRate(1)).toBe('NORMAL');
    expect(classifyBurnRate(2)).toBe('SLOW_BURN');
    expect(classifyBurnRate(14.5)).toBe('FAST_BURN');
    expect(classifyBurnRate(15)).toBe('FAST_BURN');
  });

  it('rejects invalid SLO targets and burn rates', () => {
    expect(() => calculateErrorBudget(-0.1)).toThrow(RangeError);
    expect(() => calculateErrorBudget(1.1)).toThrow(RangeError);
    expect(() => classifyBurnRate(-1)).toThrow(RangeError);
    expect(() => classifyBurnRate(Number.NaN)).toThrow(RangeError);
  });
});
