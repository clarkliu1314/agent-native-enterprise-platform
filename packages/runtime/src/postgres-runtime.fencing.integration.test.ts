import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresRuntimeRepositories } from './index';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('PostgresRuntimeRepositories stale worker fencing', () => {
  const db = new PostgresDatabase(databaseUrl);
  const repos = new PostgresRuntimeRepositories(db);
  const runId = `fencing-run-${randomUUID()}`;
  const idempotencyKey = `fencing-idem-${randomUUID()}`;

  beforeAll(async () => {
    await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    await db.pool.end();
  });

  it('rejects stale worker progress after a newer worker fences it out', async () => {
    await repos.admitRun({
      command: { agentId: 'integration', input: {}, idempotencyKey },
      commandHash: 'fencing-hash',
      runId,
      eventId: `event-${runId}`,
    });

    const first = await repos.claimRun(runId, 'worker-a', 1);
    expect(first?.fencingToken).toBe(1n);

    await db.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1", [runId]);
    const second = await repos.reclaimExpiredRun(runId, 'worker-b', 30_000);
    expect(second?.fencingToken).toBe(2n);

    const staleCheckpoint = {
      checkpointId: `checkpoint-stale-${runId}`,
      runId,
      sequence: 1n,
      fencingToken: first!.fencingToken,
      createdAt: new Date().toISOString(),
      adapter: 'test',
      adapterVersion: '1',
      schemaVersion: 1,
      payload: new Uint8Array([1]),
    };

    await expect(repos.saveCheckpoint(staleCheckpoint)).rejects.toThrow('Fenced checkpoint write rejected');
    await expect(repos.saveRunProgress({
      runId,
      fencingToken: first!.fencingToken,
      metadata: { stale: true },
      checkpoint: staleCheckpoint,
    })).rejects.toThrow('Fenced run progress write rejected');

    const current = await repos.getRun(runId);
    expect(current?.fencingToken).toBe(2n);
    expect(current?.metadata).not.toMatchObject({ stale: true });
  });
});
