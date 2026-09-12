import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresRuntimeRepositories } from './index';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const ids = {
  run: `integration-run-${randomUUID()}`,
  blocker: `integration-blocker-${randomUUID()}`,
};

describeIfDatabase('PostgresRuntimeRepositories', () => {
  const db = new PostgresDatabase(databaseUrl);
  const repos = new PostgresRuntimeRepositories(db);

  beforeAll(async () => {
    await db.query('DELETE FROM outbox_events WHERE outbox_id LIKE $1 OR outbox_id LIKE $2', [`outbox:${ids.run}%`, `outbox:${ids.blocker}%`]);
    await db.query('DELETE FROM agent_events WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM agent_runs WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM outbox_events WHERE outbox_id LIKE $1 OR outbox_id LIKE $2', [`outbox:${ids.run}%`, `outbox:${ids.blocker}%`]);
    await db.query('DELETE FROM agent_events WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM agent_runs WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.pool.end();
  });

  it('rolls back Run, Event, and Idempotency admission when Event insertion fails', async () => {
    const blockerEventId = `event-blocker-${randomUUID()}`;
    await db.query(
      `INSERT INTO agent_runs (run_id, agent_id, state, input) VALUES ($1,'integration','QUEUED','{}'::jsonb)`,
      [ids.blocker],
    );
    await db.query(
      `INSERT INTO agent_events (event_id, run_id, sequence, type, payload) VALUES ($1,$2,1,'BLOCKER','{}'::jsonb)`,
      [blockerEventId, ids.blocker],
    );
    await db.query(
      `INSERT INTO outbox_events (outbox_id,event_id,topic,payload) VALUES ($1,$2,'agent.run','{}'::jsonb)`,
      [`outbox:${blockerEventId}`, blockerEventId],
    );

    const eventId = blockerEventId;
    await expect(repos.admitRun({
      command: { agentId: 'integration', input: {}, idempotencyKey: `idem-${ids.run}` },
      commandHash: 'hash',
      runId: ids.run,
      eventId,
    })).rejects.toThrow();

    await expect(db.query('SELECT 1 FROM agent_runs WHERE run_id=$1', [ids.run])).resolves.toMatchObject({ rows: [] });
    await expect(db.query('SELECT 1 FROM agent_events WHERE run_id=$1', [ids.run])).resolves.toMatchObject({ rows: [] });
    await expect(db.query('SELECT 1 FROM idempotency_keys WHERE idempotency_key=$1', [`idem-${ids.run}`])).resolves.toMatchObject({ rows: [] });
  });

  it('claims a queued Run exactly once and fences subsequent ownership', async () => {
    const eventId = `event-${ids.run}`;
    await repos.admitRun({
      command: { agentId: 'integration', input: {}, idempotencyKey: `idem-${ids.run}` },
      commandHash: 'hash-2',
      runId: ids.run,
      eventId,
    });

    const first = await repos.claimRun(ids.run, 'worker-a', 30_000);
    expect(first?.fencingToken).toBe(1n);
    expect((await repos.claimRun(ids.run, 'worker-b', 30_000))).toBeNull();
    expect(await repos.renewLease(ids.run, 'worker-a', first!.fencingToken, 30_000)).toBe(true);
    expect(await repos.renewLease(ids.run, 'worker-b', first!.fencingToken, 30_000)).toBe(false);
  });
});
