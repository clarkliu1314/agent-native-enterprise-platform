import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresOutboxRepository } from './postgres-outbox-repository';
import { PostgresToolExecutionStore } from '@agent-native/tool-runtime';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/agent_native';

describe('PostgresOutboxRepository', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresOutboxRepository(pool);
  const store = new PostgresToolExecutionStore(pool);

  beforeAll(async () => {
    await store.migrate();
    await pool.query('TRUNCATE TABLE tool_execution_idempotency, outbox_events');
  });

  afterAll(async () => pool.end());

  it('atomically claims an available event with a worker lease', async () => {
    await store.commit({
      idempotencyKey: 'repo-claim',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-1' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'repo-claim',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-1' },
      },
    });

    const claimed = await repository.claim(1, 'worker-a');
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ eventType: 'tool.execution.completed' });
  });

  it('rejects acknowledgement from a worker that does not own the lease', async () => {
    await store.commit({
      idempotencyKey: 'repo-owner',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-2' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'repo-owner',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-2' },
      },
    });

    const [claimed] = await repository.claim(1, 'worker-a');
    await expect(repository.markPublished(claimed!.eventId, 'worker-b')).rejects.toThrow(/lease/i);
  });

  it('reclaims an expired lease and increments attempts', async () => {
    await store.commit({
      idempotencyKey: 'repo-expired',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-3' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'repo-expired',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-3' },
      },
    });

    const [first] = await repository.claim(1, 'worker-a');
    await pool.query("UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1", [first!.eventId]);
    const [second] = await repository.claim(1, 'worker-b');

    expect(second!.eventId).toBe(first!.eventId);
    const row = await pool.query('SELECT attempts, locked_by FROM outbox_events WHERE event_id = $1', [first!.eventId]);
    expect(row.rows[0]).toMatchObject({ attempts: 2, locked_by: 'worker-b' });
  });

  it('uses exponential retry backoff and dead-letters after the configured limit', async () => {
    await store.commit({
      idempotencyKey: 'repo-retry',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-4' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'repo-retry',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-4' },
      },
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [claimed] = await repository.claim(1, 'worker-a');
      await repository.release(claimed!.eventId, 'worker-a', new Error(`failure-${attempt}`));
      await pool.query('UPDATE outbox_events SET available_at = NOW() WHERE event_id = $1', [claimed!.eventId]);
    }

    const row = await pool.query('SELECT status, attempts, last_error FROM outbox_events WHERE idempotency_key = $1', ['repo-retry']);
    expect(row.rows[0]).toMatchObject({ status: 'DEAD', attempts: 3, last_error: 'failure-3' });
  });
});
