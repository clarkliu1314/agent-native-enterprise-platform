import { describe, expect, it } from 'vitest';
import { benchmarkAdapters } from '../../framework/types';
import { failureSloBenchmarkCases, runFailureSloBenchmark } from './failure-slo-benchmark';

describe('Stage 12.4 failure/SLO benchmark matrix', () => {
  it('defines four deterministic failure cases across the existing adapter surface', () => {
    expect(failureSloBenchmarkCases.map((testCase) => testCase.id)).toEqual(['F01', 'F02', 'F03', 'F04']);
    expect(failureSloBenchmarkCases).toHaveLength(4);
    for (const testCase of failureSloBenchmarkCases) {
      expect(testCase.adapters).toEqual(benchmarkAdapters);
      expect(testCase.initialDbState).toBeTruthy();
      expect(testCase.injectedFault).toBeTruthy();
      expect(testCase.expectedDurableState).toBeTruthy();
      expect(testCase.auditAssertion).toBeTruthy();
      expect(testCase.telemetryAssertion).toBeTruthy();
      expect(testCase.replayAssertion).toBeTruthy();
    }
  });

  it('executes every failure/SLO case through every existing benchmark adapter', async () => {
    const results = await runFailureSloBenchmark();
    expect(results).toHaveLength(16);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.every((result) => result.invariantViolations.length === 0)).toBe(true);
    expect(new Set(results.map((result) => result.adapter))).toEqual(new Set(benchmarkAdapters));
    expect(new Set(results.map((result) => result.caseId))).toEqual(new Set(['F01', 'F02', 'F03', 'F04']));
  });
});
