import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresRunStore, type StoredRun } from './postgres-run-store';
import { RunState } from '@agent-native/runtime-contract';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/agent_native';

describe('PostgresRunStore', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresRunStore(pool);

  beforeAll(() => store.migrate());

  afterAll(async () => {
    await pool.query(`DELETE FROM agent_runs WHERE run_id IN ('run-durable-1', 'run-durable-version')`);
    await pool.end();
  });

  it('persists and reloads a run durably', async () => {
    const run: StoredRun = {
      runId: 'run-durable-1',
      agentId: 'investment-agent',
      state: RunState.RUNNING,
      input: { task: 'screen' },
      version: 2,
      metadata: { source: 'benchmark' },
    };

    await pool.query('DELETE FROM agent_runs WHERE run_id = $1', [run.runId]);
    await store.saveRun(run);
    const loaded = await store.getRun(run.runId);

    expect(loaded).toEqual(run);
  });

  it('enforces optimistic version checks on updates', async () => {
    const run: StoredRun = {
      runId: 'run-durable-version',
      agentId: 'investment-agent',
      state: RunState.CREATED,
      input: {},
      version: 0,
      metadata: {},
    };

    await pool.query('DELETE FROM agent_runs WHERE run_id = $1', [run.runId]);
    await store.saveRun(run);
    const updated = { ...run, state: RunState.RUNNING, version: 1 };
    await store.updateRun(updated, 0);

    await expect(store.updateRun({ ...updated, version: 2 }, 0)).rejects.toThrow(
      'Run version conflict: expected 0, actual 1',
    );
  });
});
