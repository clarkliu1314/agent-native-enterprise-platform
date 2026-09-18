import { describe, expect, it, vi } from 'vitest';
import { benchmarkAdapters } from './types';
import {
  type BenchmarkScenarioExecutor,
  createBenchmarkRunner,
} from './scenario-runner';

const cases = [
  {
    id: 'B01',
    fixture: 'framework-fixture',
    initialState: { runState: 'QUEUED', recoveryState: 'NONE', toolExecutionState: 'NONE', outboxState: 'EMPTY' },
    mock: { llm: 'none', tool: 'none' },
    steps: ['framework-step'],
    sqlAssertions: [],
    expectedResult: 'pass',
    failureCriteria: [],
    invariants: ['permission'],
    adapters: [...benchmarkAdapters],
  },
  {
    id: 'B02',
    fixture: 'framework-fixture-2',
    initialState: { runState: 'QUEUED', recoveryState: 'NONE', toolExecutionState: 'NONE', outboxState: 'EMPTY' },
    mock: { llm: 'none', tool: 'none' },
    steps: ['framework-step-2'],
    sqlAssertions: [],
    expectedResult: 'pass',
    failureCriteria: [],
    invariants: ['idempotency'],
    adapters: [...benchmarkAdapters],
  },
] as const;

describe('benchmark scenario runner', () => {
  it('executes the supplied scenario and validates its invariant result', async () => {
    const execute = vi.fn<BenchmarkScenarioExecutor>(async (testCase, adapter) => ({
      invariantViolations: [],
      details: `${testCase.id}:${adapter}`,
    }));
    const runner = createBenchmarkRunner(cases, execute);

    const result = await runner.run(cases[0], 'agentscope');

    expect(execute).toHaveBeenCalledWith(cases[0], 'agentscope');
    expect(result).toEqual({
      caseId: 'B01',
      adapter: 'agentscope',
      passed: true,
      invariantViolations: [],
      details: 'B01:agentscope',
    });
  });

  it('hard-fails a result when any safety invariant is violated', async () => {
    const runner = createBenchmarkRunner(cases, async () => ({
      invariantViolations: ['permission'],
      details: 'permission bypassed',
    }));

    const result = await runner.run(cases[1], 'langgraph');

    expect(result.passed).toBe(false);
    expect(result.invariantViolations).toEqual(['permission']);
  });

  it('rejects an executor that reports an invariant outside the benchmark safety set', async () => {
    const runner = createBenchmarkRunner(cases, async () => ({
      invariantViolations: ['unknown-invariant' as never],
      details: 'invalid result',
    }));

    await expect(runner.run(cases[0], 'agentscope')).rejects.toThrow('Unknown benchmark invariant');
  });

  it('executes every supplied case against every framework adapter in deterministic order', async () => {
    const calls: string[] = [];
    const runner = createBenchmarkRunner(cases, async (testCase, adapter) => {
      calls.push(`${testCase.id}:${adapter}`);
      return { invariantViolations: [], details: `${testCase.id}:${adapter}` };
    });

    const results = await runner.runAll();

    expect(results).toHaveLength(cases.length * benchmarkAdapters.length);
    expect(calls).toEqual(
      cases.flatMap((testCase) => benchmarkAdapters.map((adapter) => `${testCase.id}:${adapter}`)),
    );
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('rejects a case outside the supplied suite', async () => {
    const runner = createBenchmarkRunner(cases, async () => ({ invariantViolations: [], details: 'unused' }));

    await expect(runner.run({ ...cases[0], id: 'B03' } as never, 'agentscope')).rejects.toThrow(
      'Unknown benchmark case: B03',
    );
  });
});
