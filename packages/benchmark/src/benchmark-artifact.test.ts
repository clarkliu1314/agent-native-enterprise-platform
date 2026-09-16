import { describe, expect, it } from 'vitest';
import { benchmarkAdapters, benchmarkCases, type BenchmarkRunResult } from './index';
import { serializeBenchmarkReport } from './framework/artifact';

describe('benchmark report artifact', () => {
  it('serializes the complete 64-scenario matrix deterministically', () => {
    const results: BenchmarkRunResult[] = benchmarkCases.flatMap((testCase) =>
      benchmarkAdapters.map((adapter) => ({
        caseId: testCase.id,
        adapter,
        passed: true,
        invariantViolations: [],
        details: `${testCase.id}:${adapter}`,
      })),
    );

    const artifact = serializeBenchmarkReport(results, benchmarkCases.map((testCase) => testCase.id));

    expect(artifact).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          summary: { total: 64, passed: 64, failed: 0 },
          results,
        },
        null,
        2,
      )}\n`,
    );
  });

  it('rejects an incomplete or duplicated matrix', () => {
    const result: BenchmarkRunResult = {
      caseId: 'B01',
      adapter: 'agentscope',
      passed: true,
      invariantViolations: [],
      details: 'only one scenario',
    };

    expect(() => serializeBenchmarkReport([result], benchmarkCases.map((testCase) => testCase.id))).toThrow(
      'Benchmark report must contain exactly one result for every case-adapter pair',
    );
  });
});
