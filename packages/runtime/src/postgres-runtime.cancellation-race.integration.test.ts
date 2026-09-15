import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresRuntimeRepositories } from './index';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('PostgresRuntimeRepositories cancellation race', () => {
  const db = new PostgresDatabase(databaseUrl);
  const repos = new PostgresRuntimeRepositories(db);
  const runId = `cancel-race-${randomUUID()}`;
  const idempotencyKey = `cancel-race-idem-${randomUUID()}`;
  const eventId = `event-${runId}`;

  beforeAll(async () => {
    await db.query('DELETE FROM outbox_events WHERE event_id=$1', [eventId]);
    await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id=$1', [idempotencyKey]);
    await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM outbox_events WHERE event_id=$1', [eventId]);
    await db.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
    await db.query('DELETE FROM idempotency_keys WHERE run_id=$1', [idempotencyKey]);
    await db.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    await db.pool.end();
  });

  it('rejects a stale worker cancellation after a newer worker has fenced it out', async () => {
    await repos.admitRun({
      command: {
        agentId: 'integration',
        input: {},
        idempotencyKey,
        metadata: { tenantId: 'tenant-fencing', requestId: `req-${runId}`, traceId: `trace-${runId}` },
      },
      commandHash: 'cancellation-race-hash',
      runId,
      eventId,
    });

    const first = await repos.claimRun(runId, 'worker-a', 1);
    expect(first?.fencingToken).toBe(1n);

    await db.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1", [runId]);
    const second = await repos.reclaimExpiredRun(runId, 'worker-b', 30_000);
    expect(second?.fencingToken).toBe(2n);

    await expect(repos.transitionRun({
      runId,
      fencingToken: first!.fencingToken,
      from: 'RUNNING',
      to: 'CANCELLED',
      owner: 'worker-a',
    })).rejects.toThrow('Durable run write rejected');

    const current = await repos.getRun(runId);
    expect(current?.state).toBe('RUNNING');
    expect(current?.fencingToken).toBe(2n);
  });
});
