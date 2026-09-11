import { describe, expect, it } from 'vitest';
import { executePostgresRecoveryScenario } from './postgres-recovery-scenarios';
import { benchmarkCases } from './index';

const databaseUrl = process.env.DATABASE_URL;
const recoveryCases = benchmarkCases.filter((testCase) => /^B(09|10|11|12|13)$/.test(testCase.id));

describe.skipIf(!databaseUrl)('PostgreSQL recovery benchmark scenarios', () => {
  it.each(recoveryCases)('$id uses durable PostgreSQL recovery semantics', async (testCase) => {
    const result = await executePostgresRecoveryScenario(testCase.id, 'agentscope', databaseUrl!);
    expect(result.invariantViolations).toEqual([]);
    expect(result.details).toContain('postgresql: true');
  });

  it('does not duplicate the external effect across B10 recovery', async () => {
    const result = await executePostgresRecoveryScenario('B10', 'agentscope', databaseUrl!);
    expect(result.details).toContain('external effects: 1');
    expect(result.details).toContain('tool executions: 1');
  });

  it('claims a recovery candidate exactly once under concurrent workers', async () => {
    const result = await executePostgresRecoveryScenario('B09', 'agentscope', databaseUrl!);
    expect(result.details).toContain('lease reclaimed: true');
    expect(result.details).toContain('recovered: 1');
  });

  it('repairs the result/outbox crash boundary without duplicating the effect', async () => {
    const result = await executePostgresRecoveryScenario('B11', 'agentscope', databaseUrl!);
    expect(result.details).toContain('external effects: 0');
    expect(result.details).toContain('outbox events: 1');
  });
});
