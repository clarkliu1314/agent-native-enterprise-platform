import type { Pool, PoolClient } from 'pg';
import type {
  ToolExecutionCommit,
  ToolExecutionLookup,
  ToolExecutionStore,
} from './tool-execution';

/**
 * PostgreSQL implementation of the idempotency + outbox boundary.
 *
 * IMPORTANT RELIABILITY PROPERTY
 * --------------------------------
 * `commit()` writes the durable execution result and its Outbox event in ONE
 * PostgreSQL transaction. A successful COMMIT makes both visible; a rollback
 * makes neither visible. This is the transactional boundary consumed by the
 * framework-neutral ToolExecutionService.
 *
 * PostgreSQL uniqueness is also part of the correctness model: process-local Maps
 * can prevent duplicate work inside one worker, but only the database can coordinate
 * retries arriving concurrently at different workers/containers.
 */
export class PostgresToolExecutionStore implements ToolExecutionStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tool_execution_idempotency (
        idempotency_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        output JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, idempotency_key)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        event_id BIGSERIAL PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ NULL,
        UNIQUE (tenant_id, idempotency_key)
      )
    `);

    // The repository previously used idempotency_key alone as the primary/unique key.
    // Keep migration backward-compatible for an already initialized development or
    // staging database by replacing those global constraints with tenant-scoped ones.
    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'tool_execution_idempotency'::regclass
            AND conname = 'tool_execution_idempotency_pkey'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (idempotency_key)'
        ) THEN
          ALTER TABLE tool_execution_idempotency
            DROP CONSTRAINT tool_execution_idempotency_pkey;
          ALTER TABLE tool_execution_idempotency
            ADD PRIMARY KEY (tenant_id, idempotency_key);
        END IF;
      END $$;
    `);

    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'outbox_events'::regclass
            AND conname = 'outbox_events_idempotency_key_key'
        ) THEN
          ALTER TABLE outbox_events
            DROP CONSTRAINT outbox_events_idempotency_key_key;
          ALTER TABLE outbox_events
            ADD CONSTRAINT outbox_events_tenant_idempotency_key_key
            UNIQUE (tenant_id, idempotency_key);
        END IF;
      END $$;
    `);
  }

  /**
   * Read a completed result using its full logical identity.
   *
   * The lookup type is defined by the framework-neutral tool execution contract rather
   * than by this adapter. That keeps the PostgreSQL implementation from creating a
   * second, incompatible public type with the same name.
   */
  async get(lookup: ToolExecutionLookup): Promise<unknown | null> {
    const result = await this.pool.query(
      `SELECT output
         FROM tool_execution_idempotency
        WHERE tenant_id = $1
          AND idempotency_key = $2
          AND tool_name = $3`,
      [lookup.tenantId, lookup.idempotencyKey, lookup.toolName],
    );
    return result.rows[0]?.output ?? null;
  }

  async commit(commit: ToolExecutionCommit): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // The composite primary key coordinates retries across all workers in a tenant.
      // A repeated commit therefore cannot create a second durable execution record.
      const result = await client.query(
        `INSERT INTO tool_execution_idempotency
          (idempotency_key, tool_name, tenant_id, actor_id, output)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
        [
          commit.idempotencyKey,
          commit.toolName,
          commit.tenantId,
          commit.actorId,
          JSON.stringify(commit.output),
        ],
      );

      // Only the first successful insert owns publication of the corresponding event.
      // The event is written in the same transaction as the result, so an outbox worker
      // can never observe a success event without the durable idempotency record.
      if (result.rowCount === 1) {
        await client.query(
          `INSERT INTO outbox_events
            (idempotency_key, event_type, tool_name, tenant_id, actor_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
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
      // Never try to publish the event independently after a database failure. The
      // caller must retry the complete transaction so result and event remain atomic.
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Rollback itself may fail when the database connection has already been lost. In that
 * case PostgreSQL will discard the uncommitted transaction when the connection closes;
 * preserving the original error gives the caller the actionable failure instead.
 */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Intentionally ignored; the original database error is more useful to the caller.
  }
}
