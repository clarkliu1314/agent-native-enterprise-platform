import { describe, expect, it } from 'vitest';
import { executePostgresTailScenario } from './postgres-tail-scenarios';

describe('PostgreSQL benchmark tail scenarios', () => {
  it('executes B14 retryable backoff with durable retry state', async () => {
    if (!process.env.DATABASE_URL) return;
    const result = await executePostgresTailScenario('B14', 'agentscope', process.env.DATABASE_URL);
    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('postgresql: true');
    expect(result.details).toContain('backoff: 1000,2000');
  });

  it('executes B15 terminal failure without scheduling another retry', async () => {
    if (!process.env.DATABASE_URL) return;
    const result = await executePostgresTailScenario('B15', 'langgraph', process.env.DATABASE_URL);
    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('postgresql: true');
    expect(result.details).toContain('state: FAILED_FINAL');
    expect(result.details).toContain('retry scheduled: false');
  });

  it('executes B16 with exactly one PostgreSQL claim winner', async () => {
    if (!process.env.DATABASE_URL) return;
    const result = await executePostgresTailScenario('B16', 'eino', process.env.DATABASE_URL);
    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('postgresql: true');
    expect(result.details).toContain('claim winners: 1');
    expect(result.details).toContain('logical effects: 1');
  });
});
