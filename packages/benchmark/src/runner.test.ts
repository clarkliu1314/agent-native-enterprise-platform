import { describe, expect, it } from 'vitest';
import { benchmarkAdapters, benchmarkCases, type BenchmarkRunner } from './index';

describe('benchmark adapter matrix', () => {
  it('runs every case against every adapter through one runner contract', async () => {
    const runner: BenchmarkRunner = {
      async run(testCase, adapter) {
        return {
          caseId: testCase.id,
          adapter,
          passed: true,
          invariantViolations: [],
          details: 'contract-only runner',
        };
      },
    };

    const results = await Promise.all(
      benchmarkCases.flatMap((testCase) =>
        benchmarkAdapters.map((adapter) => runner.run(testCase, adapter)),
      ),
    );

    expect(benchmarkCases).toHaveLength(16);
    expect(results).toHaveLength(64);
    expect(new Set(results.map((result) => result.caseId))).toHaveProperty('size', 16);
    expect(new Set(results.map((result) => result.adapter))).toEqual(new Set(benchmarkAdapters));
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
