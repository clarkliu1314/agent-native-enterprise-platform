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

  it.each(benchmarkAdapters)('retries an unpublished outbox message for B07 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[6], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('publish attempts: 2');
    expect(result.details).toContain('published: 1');
    expect(result.details).toContain('ack before transport: false');
  });

  it.each(benchmarkAdapters)('tolerates duplicate outbox delivery for B08 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[7], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('deliveries: 2');
    expect(result.details).toContain('logical effects: 1');
    expect(result.details).toContain('published: 1');
  });

  it.each(benchmarkAdapters)('recovers a claimed operation after B09 worker crash through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[8], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('lease reclaimed: true');
    expect(result.details).toContain('recovered: 1');
    expect(result.details).toContain('external effects: 1');
  });

  it.each(benchmarkAdapters)('deduplicates B10 crash-during-tool recovery through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[9], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('recovered: 1');
    expect(result.details).toContain('external effects: 1');
    expect(result.details).toContain('tool executions: 1');
  });

  it.each(benchmarkAdapters)('preserves the publication intent for B11 crash-after-result through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[10], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('recovered: 1');
    expect(result.details).toContain('outbox events: 1');
    expect(result.details).toContain('external effects: 1');
  });

  it.each(benchmarkAdapters)('does not duplicate the logical effect for B12 crash-after-outbox through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[11], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('deliveries: 2');
    expect(result.details).toContain('logical effects: 1');
    expect(result.details).toContain('recovered: 1');
  });

  it.each(benchmarkAdapters)('reclaims an expired recovery lease in B13 through the %s adapter', async (adapter) => {
    const result = await executeBenchmarkScenario(benchmarkCases[12], adapter);

    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('expired lease reclaimed: true');
    expect(result.details).toContain('recovered: 1');
    expect(result.details).toContain('external effects: 1');
  });
});
