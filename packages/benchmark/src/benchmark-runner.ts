import { createBenchmarkRunner } from './scenario-runner';
import { executeBenchmarkScenario } from './scenario-executor';

export const benchmarkRunner = createBenchmarkRunner(executeBenchmarkScenario);
