import { benchmarkAdapters, type BenchmarkAdapter, type BenchmarkRunResult } from './types';

export interface BenchmarkReport {
  schemaVersion: 1;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: readonly BenchmarkRunResult[];
}

export function serializeBenchmarkReport(
  results: readonly BenchmarkRunResult[],
  expectedCaseIds: readonly string[],
): string {
  validateMatrix(results, expectedCaseIds);

  const passed = results.filter((result) => result.passed).length;
  const report: BenchmarkReport = {
    schemaVersion: 1,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };

  return `${JSON.stringify(report, null, 2)}\n`;
}

function validateMatrix(
  results: readonly BenchmarkRunResult[],
  expectedCaseIds: readonly string[],
): void {
  const expectedScenarioCount = expectedCaseIds.length * benchmarkAdapters.length;
  if (results.length !== expectedScenarioCount) {
    throw new Error(
      'Benchmark report must contain exactly one result for every case-adapter pair',
    );
  }

  const seen = new Set<string>();
  for (const result of results) {
    const key = `${result.caseId}:${result.adapter as BenchmarkAdapter}`;
    if (seen.has(key)) {
      throw new Error(
        'Benchmark report must contain exactly one result for every case-adapter pair',
      );
    }
    seen.add(key);
  }

  for (const caseId of expectedCaseIds) {
    for (const adapter of benchmarkAdapters) {
      if (!seen.has(`${caseId}:${adapter}`)) {
        throw new Error(
          'Benchmark report must contain exactly one result for every case-adapter pair',
        );
      }
    }
  }
}
