import { describe, expect, it } from 'vitest';
import { benchmarkCases, type BenchmarkCase } from './index';

describe('benchmark contract', () => {
  it('defines exactly 16 deterministic cases', () => {
    expect(benchmarkCases).toHaveLength(16);
  });

  it('requires the durable safety contract on every case', () => {
    for (const testCase of benchmarkCases) {
      expect(testCase.id).toMatch(/^B\d{2}$/);
      expect(testCase.fixture).toBeTruthy();
      expect(testCase.initialState).toBeTruthy();
      expect(testCase.mock).toBeTruthy();
      expect(testCase.steps.length).toBeGreaterThan(0);
      expect(testCase.sqlAssertions.length).toBeGreaterThan(0);
      expect(testCase.expectedResult).toBeTruthy();
      expect(testCase.failureCriteria.length).toBeGreaterThan(0);
      expect(testCase.invariants).toEqual(
        expect.arrayContaining(['permission', 'idempotency', 'outbox']),
      );
    }
  });

  it('keeps the adapter matrix identical for all four frameworks', () => {
    const adapters = benchmarkCases[0].adapters;
    expect(adapters).toEqual(['agentscope', 'langgraph', 'eino', 'mastra']);
    for (const testCase of benchmarkCases) {
      expect(testCase.adapters).toEqual(adapters);
    }
  });

  it('exposes a stable case shape for machine-readable runners', () => {
    const sample: BenchmarkCase = benchmarkCases[0];
    expect(Object.keys(sample).sort()).toEqual([
      'adapters',
      'expectedResult',
      'failureCriteria',
      'fixture',
      'id',
      'initialState',
      'invariants',
      'mock',
      'sqlAssertions',
      'steps',
    ]);
  });
});
