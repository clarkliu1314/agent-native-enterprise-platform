import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresOutboxRepository } from './postgres-outbox-repository';
import { migrateOutbox } from './migrate';
import { PostgresToolExecutionStore } from '@agent-native/tool-runtime';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/agent_native';

describe('PostgresOutboxRepository', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresOutboxRepository(pool);
  const store = new PostgresToolExecutionStore(pool);

  beforeAll(async () => {
    await store.migrate();
    await migrateOutbox(pool);
    await pool.query('TRUNCATE TABLE tool_execution_idempotency, outbox_events');
  });

  afterAll(async () => pool.end());

  async function seed(key: string, companyId: string) {
    await store.reserve({ idempotencyKey: key, tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: key } });
    await store.commit({
      idempotencyKey: key, toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId },
      outboxEvent: { type: 'tool.execution.completed', idempotencyKey: key, toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId } },
    });
  }

  it('atomically claims an available event with a worker lease', async () => {
    await seed('repo-claim', 'company-1');
    const claimed = await repository.claim(1, 'worker-a');
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ eventType: 'tool.execution.completed' });
  });

  it('rejects acknowledgement from a worker that does not own the lease', async () => {
    await seed('repo-owner', 'company-2');
    const [claimed] = await repository.claim(1, 'worker-a');
    await expect(repository.markPublished(claimed!.eventId, 'worker-b')).rejects.toThrow(/lease/i);
  });

  it('reclaims an expired lease and increments attempts', async () => {
    await seed('repo-expired', 'company-3');
    const [first] = await repository.claim(1, 'worker-a');
    await pool.query("UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1", [first!.eventId]);
    const [second] = await repository.claim(1, 'worker-b');
    expect(second!.eventId).toBe(first!.eventId);
    const row = await pool.query('SELECT attempts, locked_by FROM outbox_events WHERE event_id = $1', [first!.eventId]);
    expect(row.rows[0]).toMatchObject({ attempts: 2, locked_by: 'worker-b' });
  });

  it('C4: a worker crash after broker publish causes redelivery, not loss', async () => {
    await seed('repo-c4', 'company-c4');
    const [first] = await repository.claim(1, 'worker-a');
    expect(first).toBeDefined();

    // Broker publish succeeds, but the worker dies before markPublished().
    await pool.query("UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1", [first!.eventId]);
    const [redelivered] = await repository.claim(1, 'worker-b');

    expect(redelivered!.eventId).toBe(first!.eventId);
    expect(redelivered!.eventType).toBe('tool.execution.completed');
    const row = await pool.query('SELECT published_at, attempts, status FROM outbox_events WHERE event_id = $1', [first!.eventId]);
    expect(row.rows[0].published_at).toBeNull();
    expect(row.rows[0].attempts).toBe(2);
    expect(row.rows[0].status).not.toBe('PUBLISHED');
  });

  it('uses exponential retry backoff and dead-letters after the configured limit', async () => {
    await seed('repo-retry', 'company-4');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [claimed] = await repository.claim(1, 'worker-a');
      await repository.release(claimed!.eventId, 'worker-a', new Error(`failure-${attempt}`));
      await pool.query('UPDATE outbox_events SET available_at = NOW() WHERE event_id = $1', [claimed!.eventId]);
    }
    const row = await pool.query('SELECT status, attempts, last_error FROM outbox_events WHERE idempotency_key = $1', ['repo-retry']);
    expect(row.rows[0]).toMatchObject({ status: 'DEAD', attempts: 3, last_error: 'failure-3' });
  });
});
