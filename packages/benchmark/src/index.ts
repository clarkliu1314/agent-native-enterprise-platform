export * from './framework/types';
export { platformBenchmarkCases } from './cases/platform';
export { investmentBenchmarkCaseIds, investmentBenchmarkCases } from './cases/investment';
import { fullBenchmarkSuite } from './suites/full-suite';
export const benchmarkCases = fullBenchmarkSuite;
