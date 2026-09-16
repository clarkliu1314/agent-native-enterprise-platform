import { platformBenchmarkCases } from './cases/platform';
import { createBenchmarkRunner } from './framework/scenario-runner';
import { executeBenchmarkScenario } from './scenario-executor';

export const benchmarkRunner = createBenchmarkRunner(platformBenchmarkCases, executeBenchmarkScenario);
