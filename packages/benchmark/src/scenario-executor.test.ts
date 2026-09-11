import { describe, expect, it } from 'vitest';
import { benchmarkAdapters, benchmarkCases } from './index';
import { executeBenchmarkScenario } from './scenario-executor';

describe('benchmark scenario executor', () => {
  it.each(benchmarkAdapters)('executes B01 through the %s adapter against the tool runtime', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[0], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('tool execution: SUCCEEDED');
    expect(result.details).toContain('outbox events: 1');
  });

  it.each(benchmarkAdapters)('enforces permission denial for B02 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[1], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('permission denied');
    expect(result.details).toContain('tool executions: 0');
    expect(result.details).toContain('outbox events: 0');
  });

  it.each(benchmarkAdapters)('enforces tenant scope denial for B03 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[2], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('permission denied');
    expect(result.details).toContain('external effects: 0');
  });

  it.each(benchmarkAdapters)('replays a duplicate idempotency request for B04 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[3], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('replayed: true');
    expect(result.details).toContain('external effects: 1');
    expect(result.details).toContain('outbox events: 1');
  });

  it.each(benchmarkAdapters)('rejects conflicting idempotency reuse for B05 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[4], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('conflict rejected');
    expect(result.details).toContain('external effects: 1');
  });

  it.each(benchmarkAdapters)('commits the effect and publication intent atomically for B06 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[5], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('atomic commit: true');
    expect(result.details).toContain('tool executions: 1');
    expect(result.details).toContain('outbox events: 1');
  });
});
