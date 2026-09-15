import { describe, expect, it } from 'vitest';
import {
  calculateRatio,
  calculateBurnRate,
  calculateErrorBudgetRemaining,
} from '../packages/observability/src/slo-measurements';

describe('SLO measurement contract', () => {
  it('calculates bounded success ratios from durable observations', () => {
    expect(calculateRatio(999, 1000)).toBeCloseTo(0.999);
    expect(calculateRatio(99, 100)).toBeCloseTo(0.99);
    expect(calculateRatio(0, 0)).toBe(1);
  });

  it('calculates burn rate relative to the SLO error budget', () => {
    expect(calculateBurnRate(0.001, 0.001)).toBe(1);
    expect(calculateBurnRate(0.002, 0.001)).toBe(2);
    expect(calculateBurnRate(0.0145, 0.001)).toBe(14.5);
  });

  it('reports remaining error budget without going below zero', () => {
    expect(calculateErrorBudgetRemaining(0.0002, 0.001)).toBeCloseTo(0.8);
    expect(calculateErrorBudgetRemaining(0.001, 0.001)).toBe(0);
    expect(calculateErrorBudgetRemaining(0.002, 0.001)).toBe(0);
  });

  it('rejects invalid counts, rates, and budgets', () => {
    expect(() => calculateRatio(-1, 10)).toThrow(RangeError);
    expect(() => calculateRatio(11, 10)).toThrow(RangeError);
    expect(() => calculateRatio(1, -1)).toThrow(RangeError);
    expect(() => calculateBurnRate(0.1, 0)).toThrow(RangeError);
    expect(() => calculateErrorBudgetRemaining(0.1, -0.1)).toThrow(RangeError);
  });
});
