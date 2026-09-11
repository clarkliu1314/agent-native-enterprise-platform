import type { Pool, PoolClient } from 'pg';
import type { ToolExecutionCommit, ToolExecutionStore } from './tool-execution';

/**
 * PostgreSQL implementation of the idempotency + outbox boundary.
 *
 * The critical reliability property is the transaction in `commit()`:
 * the idempotency result and its outbox event are inserted in the SAME transaction.
 * If the process crashes before COMMIT, neither row becomes visible. If COMMIT succeeds,
 * a retry finds the durable idempotency result and does not execute the external tool again.
 */
export class PostgresToolExecutionStore implements ToolExecutionStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tool_execution_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        output JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        event_id BIGSERIAL PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ NULL
      )
    `);
  }

  async get(idempotencyKey: string): Promise<unknown | null> {
    const result = await this.pool.query(
      `SELECT output
         FROM tool_execution_idempotency
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0]?.output ?? null;
  }

  async commit(commit: ToolExecutionCommit): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // The primary key makes the operation idempotent across processes and hosts.
      // A retry that races with another worker simply observes no inserted row here.
      const result = await client.query(
        `INSERT INTO tool_execution_idempotency
          (idempotency_key, tool_name, tenant_id, actor_id, output)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          commit.idempotencyKey,
          commit.toolName,
          commit.tenantId,
          commit.actorId,
          JSON.stringify(commit.output),
        ],
      );

      // Only the transaction that owns the first insert creates the event. Because both
      // inserts share this transaction, a crash cannot commit one without the other.
      if (result.rowCount === 1) {
        await client.query(
          `INSERT INTO outbox_events
            (idempotency_key, event_type, tool_name, tenant_id, actor_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            commit.idempotencyKey,
            commit.outboxEvent.type,
            commit.toolName,
            commit.tenantId,
            commit.actorId,
            JSON.stringify(commit.outboxEvent),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      // Preserve the all-or-nothing boundary. The caller must retry the whole commit after
      // an error rather than attempting to publish an event independently.
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Rollback can fail if the connection was already lost; the original error is more useful. */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The database will discard an uncommitted transaction when the broken connection ends.
  }
}
