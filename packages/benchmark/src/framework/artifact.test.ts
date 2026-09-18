import { describe, expect, it } from 'vitest';
import { benchmarkAdapters, benchmarkCaseIds, type BenchmarkRunResult } from './types';
import { serializeBenchmarkReport } from './artifact';

describe('benchmark report artifact', () => {
  it('serializes the complete framework matrix deterministically', () => {
    const results: BenchmarkRunResult[] = benchmarkCaseIds.flatMap((caseId) =>
      benchmarkAdapters.map((adapter) => ({
        caseId,
        adapter,
        passed: true,
        invariantViolations: [],
        details: `${caseId}:${adapter}`,
      })),
    );

    const artifact = serializeBenchmarkReport(results, [...benchmarkCaseIds]);

    expect(artifact).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          summary: { total: 80, passed: 80, failed: 0 },
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

    expect(() => serializeBenchmarkReport([result], [...benchmarkCaseIds])).toThrow(
      'Benchmark report must contain exactly one result for every case-adapter pair',
    );
  });
});
