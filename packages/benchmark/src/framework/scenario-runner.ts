import {
  benchmarkAdapters,
  benchmarkInvariants,
  type BenchmarkAdapter,
  type BenchmarkCase,
  type BenchmarkInvariant,
  type BenchmarkRunResult,
  type BenchmarkRunner,
} from './types';

export interface BenchmarkScenarioResult {
  invariantViolations: readonly string[];
  details: string;
}

export type BenchmarkScenarioExecutor = (
  testCase: BenchmarkCase,
  adapter: BenchmarkAdapter,
) => Promise<BenchmarkScenarioResult>;

export function createBenchmarkRunner(
  cases: readonly BenchmarkCase[],
  execute: BenchmarkScenarioExecutor,
): BenchmarkRunner {
  return {
    async run(testCase, adapter): Promise<BenchmarkRunResult> {
      validateCaseAndAdapter(cases, testCase, adapter);
      const scenario = await execute(testCase, adapter);
      const violations = validateInvariantViolations(scenario.invariantViolations);

      return {
        caseId: testCase.id,
        adapter,
        passed: violations.length === 0,
        invariantViolations: violations,
        details: scenario.details,
      };
    },

    async runAll(): Promise<BenchmarkRunResult[]> {
      const results: BenchmarkRunResult[] = [];
      for (const testCase of cases) {
        for (const adapter of benchmarkAdapters) {
          results.push(await this.run(testCase, adapter));
        }
      }
      return results;
    },
  };
}

function validateCaseAndAdapter(
  cases: readonly BenchmarkCase[],
  testCase: BenchmarkCase,
  adapter: BenchmarkAdapter,
): void {
  if (!cases.some((candidate) => candidate.id === testCase.id)) {
    throw new Error(`Unknown benchmark case: ${testCase.id}`);
  }
  if (!benchmarkAdapters.includes(adapter)) {
    throw new Error(`Unknown benchmark adapter: ${adapter}`);
  }
  if (!testCase.adapters.includes(adapter)) {
    throw new Error(`Adapter ${adapter} is not enabled for benchmark case ${testCase.id}`);
  }
}

function validateInvariantViolations(violations: readonly string[]): BenchmarkInvariant[] {
  for (const violation of violations) {
    if (!benchmarkInvariants.includes(violation as BenchmarkInvariant)) {
      throw new Error(`Unknown benchmark invariant: ${violation}`);
    }
  }
  return violations as BenchmarkInvariant[];
}
