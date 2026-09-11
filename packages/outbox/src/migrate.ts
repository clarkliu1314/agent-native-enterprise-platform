import type { Pool } from 'pg';

/**
 * Adds the durable delivery lifecycle to the outbox table created by the tool runtime.
 * Safe to run repeatedly during application startup/deployment.
 */
export async function migrateOutbox(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE outbox_events
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS locked_by TEXT NULL,
      ADD COLUMN IF NOT EXISTS last_error TEXT NULL
  `);

  await pool.query(`
    UPDATE outbox_events
       SET status = CASE WHEN published_at IS NULL THEN 'PENDING' ELSE 'PUBLISHED' END
     WHERE status IS NULL OR status NOT IN ('PENDING', 'PUBLISHED', 'DEAD')
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
      ON outbox_events (available_at, created_at)
     WHERE published_at IS NULL AND status = 'PENDING'
  `);
}
