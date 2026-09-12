import { describe, expect, it } from 'vitest';
import { benchmarkAdapters, investmentBenchmarkCases } from './investment-benchmark';

describe('investment durability benchmark', () => {
  it('defines the four Stage 10 durability cases', () => {
    expect(investmentBenchmarkCases.map((testCase) => testCase.id)).toEqual([
      'B17',
      'B18',
      'B19',
      'B20',
    ]);
  });

  it('uses the shared benchmark contract and adapter matrix', () => {
    for (const testCase of investmentBenchmarkCases) {
      expect(testCase.fixture).toMatch(/^investment-/);
      expect(testCase.initialState).toBeTruthy();
      expect(testCase.mock).toBeTruthy();
      expect(testCase.steps.length).toBeGreaterThan(0);
      expect(testCase.sqlAssertions.length).toBeGreaterThan(0);
      expect(testCase.expectedResult).toBeTruthy();
      expect(testCase.failureCriteria.length).toBeGreaterThan(0);
      expect(testCase.invariants).toEqual(
        expect.arrayContaining(['permission', 'idempotency', 'outbox']),
      );
      expect(testCase.adapters).toEqual(benchmarkAdapters);
    }
  });
});
