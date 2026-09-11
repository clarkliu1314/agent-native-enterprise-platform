import type { Pool, PoolClient } from 'pg';
import type { ToolExecutionCommit } from './tool-execution';

/**
 * Durable storage contract used by ToolExecutionService.
 *
 * `get` is deliberately keyed only by the idempotency key because that key represents
 * one logical command. The PostgreSQL schema adds tenant/tool metadata for auditing and
 * uniqueness checks, while the runtime can remain independent of SQL details.
 */
export interface ToolExecutionStore {
  get(idempotencyKey: string): Promise<unknown | null>;
  commit(commit: ToolExecutionCommit): Promise<void>;
}

/**
 * PostgreSQL implementation of the idempotency + outbox boundary.
 *
 * The important reliability property is the transaction in `commit()`:
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

      // The unique primary key makes the commit idempotent across processes and hosts.
      // `DO NOTHING` is important: a retry must not create a second outbox event.
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

      // Only the transaction that creates the idempotency record creates the outbox row.
      // This keeps the two records one-to-one even when several workers race on a retry.
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
      // Roll back both writes together. Never leave a durable result without its outbox
      // event, or an outbox event without the corresponding idempotency record.
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Rollback itself can fail when the connection has already been terminated. We preserve
 * the original database error because it is the actionable failure for the caller.
 */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Connection-level failures make rollback impossible; the database will discard the
    // open transaction when the connection is closed/recycled.
  }
}
