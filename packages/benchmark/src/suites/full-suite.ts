import { platformBenchmarkSuite } from './platform-suite';
import { investmentBenchmarkSuite } from './investment-suite';
export const fullBenchmarkSuite = [...platformBenchmarkSuite, ...investmentBenchmarkSuite];
