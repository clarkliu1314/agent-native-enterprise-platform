import { describe, expect, it } from 'vitest';
import { PostgresDatabase } from './postgres-client';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Stage 12.4 PostgreSQL failure injection', () => {
  it('rolls back command transaction when PostgreSQL fails after business writes', async () => {
    const db = new PostgresDatabase(databaseUrl!);
    const runId = `run:failure-injection:${Date.now()}`;
    const eventId = `event:failure-injection:${Date.now()}`;

    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO agent_runs (run_id, agent_id, state, input) VALUES ($1, 'failure-injection', 'QUEUED', '{}'::jsonb)`,
            [runId],
          );
          await tx.query(
            `INSERT INTO agent_events (event_id, run_id, sequence, type, payload) VALUES ($1, $2, 1, 'RUN_ACCEPTED', $3::jsonb)`,
            [eventId, runId, JSON.stringify({ runId })],
          );
          await tx.query('SELECT * FROM stage12_4_injected_postgres_failure');
        }),
      ).rejects.toThrow();

      const run = await db.query('SELECT 1 FROM agent_runs WHERE run_id=$1', [runId]);
      const events = await db.query('SELECT 1 FROM agent_events WHERE run_id=$1', [runId]);
      expect(run.rows).toHaveLength(0);
      expect(events.rows).toHaveLength(0);
    } finally {
      await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
      await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
      await db.pool.end();
    }
  });
});
