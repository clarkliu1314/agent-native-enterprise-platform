import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { IdempotencyReservation, ToolExecutionCommit, ToolExecutionLookup, ToolExecutionStore } from './tool-execution';

const RESERVATION_LEASE_SECONDS = 300;

/** PostgreSQL implementation of the durable idempotency state machine + transactional outbox boundary. */
export class PostgresToolExecutionStore implements ToolExecutionStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tool_execution_idempotency (
        idempotency_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        input_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'SUCCEEDED',
        lease_expires_at TIMESTAMPTZ NULL,
        output JSONB NULL,
        last_error TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, idempotency_key),
        CONSTRAINT tool_execution_idempotency_status_check
          CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'))
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
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ NULL,
        locked_by TEXT NULL,
        last_error TEXT NULL,
        UNIQUE (tenant_id, idempotency_key)
      )
    `);

    // Upgrade databases created by earlier store/outbox implementations.
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ADD COLUMN IF NOT EXISTS input_hash TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SUCCEEDED'`);
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL`);
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ADD COLUMN IF NOT EXISTS last_error TEXT NULL`);
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.pool.query(`ALTER TABLE tool_execution_idempotency ALTER COLUMN output DROP NOT NULL`);
    await this.pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conrelid = 'tool_execution_idempotency'::regclass
            AND conname = 'tool_execution_idempotency_status_check'
        ) THEN
          ALTER TABLE tool_execution_idempotency ADD CONSTRAINT tool_execution_idempotency_status_check
            CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'));
        END IF;
      END $$;
    `);
    await this.pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conrelid = 'tool_execution_idempotency'::regclass
            AND conname = 'tool_execution_idempotency_pkey'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (idempotency_key)'
        ) THEN
          ALTER TABLE tool_execution_idempotency DROP CONSTRAINT tool_execution_idempotency_pkey;
          ALTER TABLE tool_execution_idempotency ADD PRIMARY KEY (tenant_id, idempotency_key);
        END IF;
      END $$;
    `);
    await this.pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conrelid = 'outbox_events'::regclass
            AND conname = 'outbox_events_idempotency_key_key'
        ) THEN
          ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_idempotency_key_key;
          ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_tenant_idempotency_key_key
            UNIQUE (tenant_id, idempotency_key);
        END IF;
      END $$;
    `);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING'`);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL`);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_by TEXT NULL`);
    await this.pool.query(`ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error TEXT NULL`);
    await this.pool.query(`
      UPDATE outbox_events
         SET status = CASE WHEN published_at IS NULL THEN 'PENDING' ELSE 'PUBLISHED' END
       WHERE status IS NULL OR status NOT IN ('PENDING', 'PUBLISHED', 'DEAD')
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
        ON outbox_events (available_at, created_at)
       WHERE published_at IS NULL AND status = 'PENDING'
    `);
  }

  async reserve(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    actorId: string;
    input: unknown;
  }): Promise<IdempotencyReservation> {
    const client = await this.pool.connect();
    const inputHash = hashInput(input);
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO tool_execution_idempotency
          (idempotency_key, tool_name, tenant_id, actor_id, input_hash, status, lease_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', NOW() + ($6::integer * INTERVAL '1 second'))
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING status`,
        [input.idempotencyKey, input.toolName, input.tenantId, input.actorId, inputHash, RESERVATION_LEASE_SECONDS],
      );
      if (inserted.rowCount === 1) {
        await client.query('COMMIT');
        return { kind: 'RESERVED', state: 'IN_PROGRESS' };
      }

      const existing = await client.query(
        `SELECT status, output, input_hash, lease_expires_at
           FROM tool_execution_idempotency
          WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.tenantId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.input_hash !== inputHash) {
        await client.query('COMMIT');
        return { kind: 'CONFLICT', state: row?.status ?? 'FAILED_FINAL' };
      }
      if (row.status === 'SUCCEEDED') {
        await client.query('COMMIT');
        return { kind: 'REPLAY', state: 'SUCCEEDED', output: row.output };
      }
      if (row.status === 'FAILED_FINAL') {
        await client.query('COMMIT');
        return { kind: 'CONFLICT', state: 'FAILED_FINAL' };
      }
      if (row.status === 'IN_PROGRESS' && row.lease_expires_at && new Date(row.lease_expires_at) > new Date()) {
        await client.query('COMMIT');
        return { kind: 'CONFLICT', state: 'IN_PROGRESS' };
      }

      await client.query(
        `UPDATE tool_execution_idempotency
            SET status = 'IN_PROGRESS', lease_expires_at = NOW() + ($3::integer * INTERVAL '1 second'),
                actor_id = $4, updated_at = NOW()
          WHERE tenant_id = $1 AND idempotency_key = $2`,
        [input.tenantId, input.idempotencyKey, RESERVATION_LEASE_SECONDS, input.actorId],
      );
      await client.query('COMMIT');
      return { kind: 'RETRY', state: 'FAILED_RETRYABLE' };
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(lookup: ToolExecutionLookup): Promise<unknown | null> {
    const result = await this.pool.query(
      `SELECT output FROM tool_execution_idempotency
        WHERE tenant_id = $1 AND idempotency_key = $2 AND tool_name = $3 AND status = 'SUCCEEDED'`,
      [lookup.tenantId, lookup.idempotencyKey, lookup.toolName],
    );
    return result.rows[0]?.output ?? null;
  }

  async commit(commit: ToolExecutionCommit): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE tool_execution_idempotency
            SET status = 'SUCCEEDED', output = $5::jsonb, last_error = NULL,
                lease_expires_at = NULL, updated_at = NOW(), actor_id = $4
          WHERE tenant_id = $1 AND idempotency_key = $2 AND tool_name = $3 AND status = 'IN_PROGRESS'`,
        [commit.tenantId, commit.idempotencyKey, commit.toolName, commit.actorId, JSON.stringify(commit.output)],
      );
      if (result.rowCount !== 1) throw new Error(`Idempotency commit rejected for ${commit.idempotencyKey}`);

      await client.query(
        `INSERT INTO outbox_events
          (idempotency_key, event_type, tool_name, tenant_id, actor_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
        [commit.idempotencyKey, commit.outboxEvent.type, commit.toolName, commit.tenantId, commit.actorId, JSON.stringify(commit.outboxEvent)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    error: unknown;
    retryable: boolean;
  }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const result = await this.pool.query(
      `UPDATE tool_execution_idempotency
          SET status = $5, last_error = $4, lease_expires_at = NULL, updated_at = NOW()
        WHERE tenant_id = $1 AND idempotency_key = $2 AND tool_name = $3 AND status = 'IN_PROGRESS'`,
      [input.tenantId, input.idempotencyKey, input.toolName, message, input.retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL'],
    );
    if (result.rowCount !== 1) throw new Error(`Idempotency failure transition rejected for ${input.idempotencyKey}`);
  }
}

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortObject(input))).digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortObject(entry)]),
    );
  }
  return value;
}

async function safeRollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
}
