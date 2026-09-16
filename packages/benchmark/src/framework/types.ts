export const benchmarkAdapters = ['agentscope', 'langgraph', 'eino', 'mastra'] as const;
export type BenchmarkAdapter = (typeof benchmarkAdapters)[number];
export const benchmarkInvariants = ['permission', 'idempotency', 'outbox'] as const;
export type BenchmarkInvariant = (typeof benchmarkInvariants)[number];
export const benchmarkCaseIds = [
  'B01','B02','B03','B04','B05','B06','B07','B08','B09','B10','B11','B12','B13','B14','B15','B16','B17','B18','B19','B20',
] as const;
export type BenchmarkCaseId = (typeof benchmarkCaseIds)[number];
export interface BenchmarkInitialState { runState: string; recoveryState: string; toolExecutionState: string; outboxState: string; }
export interface BenchmarkMock { llm: string; tool: string; externalEffect?: string; }
export interface BenchmarkCase {
  id: BenchmarkCaseId;
  fixture: string;
  initialState: BenchmarkInitialState;
  mock: BenchmarkMock;
  steps: readonly string[];
  sqlAssertions: readonly string[];
  expectedResult: string;
  failureCriteria: readonly string[];
  invariants: readonly BenchmarkInvariant[];
  adapters: readonly BenchmarkAdapter[];
}
export interface BenchmarkRunResult { caseId: BenchmarkCase['id']; adapter: BenchmarkAdapter; passed: boolean; invariantViolations: readonly BenchmarkInvariant[]; details: string; }
export interface BenchmarkRunner { run(testCase: BenchmarkCase, adapter: BenchmarkAdapter): Promise<BenchmarkRunResult>; runAll(): Promise<BenchmarkRunResult[]>; }
