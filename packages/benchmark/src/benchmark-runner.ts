import { platformBenchmarkCases } from './cases/platform';
import { createBenchmarkRunner } from './framework/scenario-runner';
import { executeBenchmarkScenario } from './cases/platform/scenario-executor';

export const benchmarkRunner = createBenchmarkRunner(platformBenchmarkCases, executeBenchmarkScenario);
