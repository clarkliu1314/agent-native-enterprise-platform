import type { SqlClient, TransactionRunner } from './ports';
import type { OutboxRecord, OutboxRepository } from './repositories';

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly db: TransactionRunner & SqlClient, private readonly claimLeaseMs = 30_000) {}

  async claim(limit: number): Promise<OutboxRecord[]> {
    const result = await this.db.transaction(async (tx) => tx.query<Record<string, unknown>>(
      `WITH candidates AS (
         SELECT outbox_id FROM outbox_events
         WHERE published_at IS NULL
           AND next_attempt_at <= now()
           AND (claimed_at IS NULL OR claimed_at < now() - ($2 * interval '1 millisecond'))
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE outbox_events o
       SET claimed_by = 'publisher', claimed_at = now(), attempts = attempts + 1
       FROM candidates c WHERE o.outbox_id = c.outbox_id
       RETURNING o.outbox_id, o.event_id, o.topic, o.payload, o.attempts`,
      [limit, this.claimLeaseMs],
    ));
    return result.rows.map((row) => ({ outboxId: String(row.outbox_id), eventId: String(row.event_id), topic: String(row.topic), payload: row.payload, attempts: Number(row.attempts) }));
  }

  async markPublished(outboxId: string): Promise<void> {
    await this.db.query(
      `UPDATE outbox_events SET published_at = now(), claimed_by = NULL, claimed_at = NULL WHERE outbox_id = $1 AND published_at IS NULL`,
      [outboxId],
    );
  }

  async scheduleRetry(outboxId: string, nextAttemptAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE outbox_events SET next_attempt_at = $2, claimed_by = NULL, claimed_at = NULL WHERE outbox_id = $1 AND published_at IS NULL`,
      [outboxId, nextAttemptAt.toISOString()],
    );
  }
}
