import type { Pool } from 'pg';
import type { AgentRun } from '@agent-native/runtime-contract';

export type StoredRun = AgentRun;

export class PostgresRunStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        state TEXT NOT NULL,
        input JSONB NOT NULL,
        version INTEGER NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
  }

  async saveRun(run: StoredRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
      [run.runId, run.agentId, run.state, JSON.stringify(run.input), run.version, JSON.stringify(run.metadata)],
    );
  }

  async getRun(runId: string): Promise<StoredRun | null> {
    const result = await this.pool.query(
      `SELECT run_id, agent_id, state, input, version, metadata
       FROM agent_runs WHERE run_id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      agentId: row.agent_id,
      state: row.state,
      input: row.input,
      version: row.version,
      metadata: row.metadata,
    };
  }

  async updateRun(run: StoredRun, expectedVersion: number): Promise<void> {
    const result = await this.pool.query(
      `UPDATE agent_runs
       SET agent_id = $2, state = $3, input = $4::jsonb, version = $5, metadata = $6::jsonb
       WHERE run_id = $1 AND version = $7`,
      [run.runId, run.agentId, run.state, JSON.stringify(run.input), run.version, JSON.stringify(run.metadata), expectedVersion],
    );
    if (result.rowCount !== 1) {
      const current = await this.pool.query(`SELECT version FROM agent_runs WHERE run_id = $1`, [run.runId]);
      const actual = current.rows[0]?.version;
      if (actual === undefined) throw new Error(`Run not found: ${run.runId}`);
      throw new Error(`Run version conflict: expected ${expectedVersion}, actual ${actual}`);
    }
  }
}
