import { describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresRuntimeRepositories } from './index';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Stage 12.4 PostgreSQL failure injection', () => {
  it('rolls back command transaction when a post-write failure is injected before commit', async () => {
    const db = new PostgresDatabase(databaseUrl!);
    const repos = new PostgresRuntimeRepositories(db);
    const runId = `run:failure-injection:${Date.now()}`;

    try {
      await expect(
        repos.transaction(async (tx) => {
          await tx.createRun({ runId, status: 'QUEUED' });
          await tx.appendEvent({ runId, eventType: 'RUN_ACCEPTED', payload: { runId } });
          throw new Error('injected postgres failure before commit');
        }),
      ).rejects.toThrow('injected postgres failure before commit');

      const run = await repos.getRun(runId);
      const events = await repos.listEvents(runId);
      expect(run).toBeNull();
      expect(events).toHaveLength(0);
    } finally {
      await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
      await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
      await db.pool.end();
    }
  });
});
