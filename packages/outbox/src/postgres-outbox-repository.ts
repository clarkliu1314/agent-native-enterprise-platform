import type { Pool, PoolClient } from 'pg';
import type { OutboxMessage, OutboxRepository } from './publisher';

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 3;

/** PostgreSQL durable outbox repository using worker-owned leases and SKIP LOCKED. */
export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async claim(limit: number, workerId: string): Promise<OutboxMessage[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `WITH candidates AS (
           SELECT event_id
             FROM outbox_events
            WHERE published_at IS NULL
              AND status = 'PENDING'
              AND available_at <= NOW()
              AND (locked_at IS NULL OR locked_at < NOW() - ($2::integer * INTERVAL '1 second'))
            ORDER BY created_at, event_id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE outbox_events e
            SET locked_at = NOW(), locked_by = $3, attempts = e.attempts + 1
           FROM candidates c
          WHERE e.event_id = c.event_id
       RETURNING e.event_id, e.event_type, e.payload`,
        [limit, LEASE_SECONDS, workerId],
      );
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        eventId: String(row.event_id),
        eventType: row.event_type,
        payload: row.payload,
      }));
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markPublished(eventId: string, workerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox_events
          SET published_at = NOW(), status = 'PUBLISHED',
              locked_at = NULL, locked_by = NULL, last_error = NULL
        WHERE event_id = $1
          AND published_at IS NULL
          AND status = 'PENDING'
          AND locked_by = $2
          AND locked_at >= NOW() - ($3::integer * INTERVAL '1 second')`,
      [eventId, workerId, LEASE_SECONDS],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Outbox acknowledgement rejected: lease lost for event ${eventId}`);
    }
  }

  async release(eventId: string, workerId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.pool.query(
      `UPDATE outbox_events
          SET status = CASE WHEN attempts >= $3 THEN 'DEAD' ELSE 'PENDING' END,
              available_at = CASE
                WHEN attempts >= $3 THEN NOW()
                ELSE NOW() + (LEAST(60, POWER(2, GREATEST(attempts - 1, 0))) * INTERVAL '1 second')
              END,
              locked_at = NULL, locked_by = NULL, last_error = $4
        WHERE event_id = $1
          AND status = 'PENDING'
          AND locked_by = $2`,
      [eventId, workerId, MAX_ATTEMPTS, message],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Outbox release rejected: lease lost for event ${eventId}`);
    }
  }
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original error; PostgreSQL discards the transaction on connection close.
  }
}
