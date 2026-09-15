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
    await db.query('DELETE FROM checkpoints WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM agent_events WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
    await db.query('DELETE FROM agent_runs WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM outbox_events WHERE outbox_id LIKE $1 OR outbox_id LIKE $2', [`outbox:${ids.run}%`, `outbox:${ids.blocker}%`]);
    await db.query('DELETE FROM checkpoints WHERE run_id IN ($1,$2)', [ids.run, ids.blocker]);
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

  it('rolls back Run metadata and version when checkpoint persistence fails after the Run update', async () => {
    const runId = `checkpoint-rollback-${randomUUID()}`;
    const idempotencyKey = `checkpoint-rollback-idem-${randomUUID()}`;
    const eventId = `checkpoint-rollback-event-${randomUUID()}`;
    const checkpointId = `checkpoint-rollback-${randomUUID()}`;

    try {
      await repos.admitRun({
        command: { agentId: 'integration', input: {}, idempotencyKey },
        commandHash: 'checkpoint-rollback-hash',
        runId,
        eventId,
      });
      const claim = await repos.claimRun(runId, 'worker-checkpoint', 30_000);
      expect(claim?.fencingToken).toBe(1n);

      const checkpoint = {
        checkpointId,
        runId,
        sequence: 1n,
        fencingToken: claim!.fencingToken,
        createdAt: new Date().toISOString(),
        adapter: 'test',
        adapterVersion: '1',
        schemaVersion: 1,
        payload: new Uint8Array([1]),
      };

      await repos.saveRunProgress({
        runId,
        fencingToken: claim!.fencingToken,
        metadata: { committed: true },
        checkpoint,
      });

      const before = await db.query<{ version: string; metadata: Record<string, unknown> }>(
        'SELECT version, metadata FROM agent_runs WHERE run_id=$1',
        [runId],
      );
      expect(before.rows[0]).toMatchObject({ version: '1', metadata: { committed: true } });

      await expect(repos.saveRunProgress({
        runId,
        fencingToken: claim!.fencingToken,
        metadata: { shouldRollback: true },
        checkpoint,
      })).rejects.toThrow();

      const after = await db.query<{ version: string; metadata: Record<string, unknown> }>(
        'SELECT version, metadata FROM agent_runs WHERE run_id=$1',
        [runId],
      );
      expect(after.rows[0]).toMatchObject({ version: '1', metadata: { committed: true } });
      expect(after.rows[0]?.metadata).not.toMatchObject({ shouldRollback: true });
      await expect(repos.getLatestCheckpoint(runId)).resolves.toMatchObject({ checkpointId, sequence: 1n });
    } finally {
      await db.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
      await db.query('DELETE FROM outbox_events WHERE outbox_id LIKE $1', [`outbox:${eventId}%`]);
      await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
      await db.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
      await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    }
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
