import type { Pool } from 'pg';
import type { AgentRun } from '@agent-native/runtime-contract';

/** Database representation of the application-facing AgentRun contract. */
export type StoredRun = AgentRun;

/**
 * PostgreSQL persistence for AgentRun lifecycle state.
 *
 * This store deliberately stays below AgentRuntime: it knows how to durably persist a run,
 * but it does not decide orchestration, model calls, or framework-specific state. That
 * separation is what allows Crash Recovery and framework adapters to share one persistence
 * contract.
 */
export class PostgresRunStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Create the minimum schema required by the current runtime contract.
   *
   * `CREATE TABLE IF NOT EXISTS` keeps local integration tests repeatable. A later migration
   * system can take ownership of schema versioning without changing the store's API.
   */
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

  /** Persist a brand-new run. The primary key prevents accidental duplicate run creation. */
  async saveRun(run: StoredRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
      [run.runId, run.agentId, run.state, JSON.stringify(run.input), run.version, JSON.stringify(run.metadata)],
    );
  }

  /** Reload a run from durable storage; null means the run ID has never been persisted. */
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

  /**
   * Optimistic-concurrency update.
   *
   * The caller supplies the version it read. PostgreSQL updates the row only when that
   * version is still current, preventing two workers from silently overwriting each other.
   */
  async updateRun(run: StoredRun, expectedVersion: number): Promise<void> {
    const result = await this.pool.query(
      `UPDATE agent_runs
       SET agent_id = $2, state = $3, input = $4::jsonb, version = $5, metadata = $6::jsonb
       WHERE run_id = $1 AND version = $7`,
      [run.runId, run.agentId, run.state, JSON.stringify(run.input), run.version, JSON.stringify(run.metadata), expectedVersion],
    );
    if (result.rowCount !== 1) {
      // Distinguish a missing run from a genuine optimistic-lock conflict so callers can
      // choose recovery vs retry behavior deterministically.
      const current = await this.pool.query(`SELECT version FROM agent_runs WHERE run_id = $1`, [run.runId]);
      const actual = current.rows[0]?.version;
      if (actual === undefined) throw new Error(`Run not found: ${run.runId}`);
      throw new Error(`Run version conflict: expected ${expectedVersion}, actual ${actual}`);
    }
  }
}
