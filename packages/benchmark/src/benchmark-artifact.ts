import {
  benchmarkAdapters,
  benchmarkCases,
  type BenchmarkRunResult,
} from './index';

const expectedScenarioCount = benchmarkCases.length * benchmarkAdapters.length;

export interface BenchmarkReport {
  schemaVersion: 1;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: readonly BenchmarkRunResult[];
}

export function serializeBenchmarkReport(results: readonly BenchmarkRunResult[]): string {
  validateMatrix(results);

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

function validateMatrix(results: readonly BenchmarkRunResult[]): void {
  if (results.length !== expectedScenarioCount) {
    throw new Error(
      'Benchmark report must contain exactly one result for every case-adapter pair',
    );
  }

  const seen = new Set<string>();
  for (const result of results) {
    const key = `${result.caseId}:${result.adapter}`;
    if (seen.has(key)) {
      throw new Error(
        'Benchmark report must contain exactly one result for every case-adapter pair',
      );
    }
    seen.add(key);
  }

  for (const testCase of benchmarkCases) {
    for (const adapter of benchmarkAdapters) {
      if (!seen.has(`${testCase.id}:${adapter}`)) {
        throw new Error(
          'Benchmark report must contain exactly one result for every case-adapter pair',
        );
      }
    }
  }
}
