import { describe, expect, it, vi } from 'vitest';
import { benchmarkCases, type BenchmarkScenarioExecutor, createBenchmarkRunner } from './scenario-runner';

describe('benchmark scenario runner', () => {
  it('executes the supplied scenario instead of returning a contract-only result', async () => {
    const execute = vi.fn<BenchmarkScenarioExecutor>(async (testCase, adapter) => ({
      invariantViolations: [],
      details: `${testCase.id}:${adapter}`,
    }));
    const runner = createBenchmarkRunner(execute);

    const result = await runner.run(benchmarkCases[0], 'agentscope');

    expect(execute).toHaveBeenCalledWith(benchmarkCases[0], 'agentscope');
    expect(result).toEqual({
      caseId: 'B01',
      adapter: 'agentscope',
      passed: true,
      invariantViolations: [],
      details: 'B01:agentscope',
    });
  });

  it('hard-fails a result when any safety invariant is violated', async () => {
    const runner = createBenchmarkRunner(async () => ({
      invariantViolations: ['permission'],
      details: 'permission bypassed',
    }));

    const result = await runner.run(benchmarkCases[1], 'langgraph');

    expect(result.passed).toBe(false);
    expect(result.invariantViolations).toEqual(['permission']);
  });

  it('rejects an executor that reports an invariant outside the benchmark safety set', async () => {
    const runner = createBenchmarkRunner(async () => ({
      invariantViolations: ['unknown-invariant' as never],
      details: 'invalid result',
    }));

    await expect(runner.run(benchmarkCases[0], 'agentscope')).rejects.toThrow(
      'Unknown benchmark invariant',
    );
  });
});
