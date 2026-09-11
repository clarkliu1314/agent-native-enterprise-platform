import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresToolExecutionStore } from './postgres-tool-execution-store';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/agent_native';

describe('PostgresToolExecutionStore', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresToolExecutionStore(pool);

  beforeAll(async () => {
    await store.migrate();
    await pool.query('TRUNCATE TABLE tool_execution_idempotency, outbox_events');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('durably reloads an idempotent result after a new store instance is created', async () => {
    await store.commit({
      idempotencyKey: 'pg-idem-1',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-1' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-idem-1',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-1' },
      },
    });

    const reloadedStore = new PostgresToolExecutionStore(pool);
    expect(await reloadedStore.get({
      idempotencyKey: 'pg-idem-1',
      tenantId: 'fund-1',
      toolName: 'crm.create_company',
    })).toEqual({ companyId: 'company-1' });
  });

  it('commits exactly one idempotency row and one outbox event for repeated commits', async () => {
    const commit = {
      idempotencyKey: 'pg-idem-duplicate',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-2' },
      outboxEvent: {
        type: 'tool.execution.completed' as const,
        idempotencyKey: 'pg-idem-duplicate',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-2' },
      },
    };

    await store.commit(commit);
    await store.commit(commit);

    const rows = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tool_execution_idempotency WHERE idempotency_key = $1) AS idempotency_count,
         (SELECT COUNT(*) FROM outbox_events WHERE idempotency_key = $1) AS outbox_count`,
      [commit.idempotencyKey],
    );

    expect(Number(rows.rows[0].idempotency_count)).toBe(1);
    expect(Number(rows.rows[0].outbox_count)).toBe(1);
  });

  it('does not allow one tenant to read another tenant\'s idempotency result', async () => {
    await store.commit({
      idempotencyKey: 'pg-tenant-isolation',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-secret' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-tenant-isolation',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-secret' },
      },
    });

    expect(await store.get({
      idempotencyKey: 'pg-tenant-isolation',
      tenantId: 'fund-2',
      toolName: 'crm.create_company',
    })).toBeNull();
  });

  it('claims an unpublished event with a worker lease and increments attempts', async () => {
    await store.commit({
      idempotencyKey: 'pg-outbox-claim',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-claim' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-outbox-claim',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-claim' },
      },
    });

    const claimed = await store.claim(10, 'worker-a');
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.eventId).toBeTruthy();

    const row = await pool.query(
      'SELECT attempts, locked_by, locked_at, published_at FROM outbox_events WHERE idempotency_key = $1',
      ['pg-outbox-claim'],
    );
    expect(row.rows[0].attempts).toBe(1);
    expect(row.rows[0].locked_by).toBe('worker-a');
    expect(row.rows[0].locked_at).toBeTruthy();
    expect(row.rows[0].published_at).toBeNull();
  });

  it('does not let a different worker acknowledge an active lease', async () => {
    await store.commit({
      idempotencyKey: 'pg-outbox-owner',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-owner' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-outbox-owner',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-owner' },
      },
    });

    const [claimed] = await store.claim(10, 'worker-a');
    await expect(store.markPublished(claimed!.eventId, 'worker-b')).rejects.toThrow(/lease/i);

    const row = await pool.query(
      'SELECT published_at FROM outbox_events WHERE event_id = $1',
      [claimed!.eventId],
    );
    expect(row.rows[0].published_at).toBeNull();
  });

  it('reclaims an expired lease instead of leaving the event stuck', async () => {
    await store.commit({
      idempotencyKey: 'pg-outbox-expired',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-expired' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-outbox-expired',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-expired' },
      },
    });

    const [first] = await store.claim(10, 'worker-a');
    await pool.query(
      "UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1",
      [first!.eventId],
    );

    const [reclaimed] = await store.claim(10, 'worker-b');
    expect(reclaimed!.eventId).toBe(first!.eventId);
    expect((await pool.query('SELECT locked_by, attempts FROM outbox_events WHERE event_id = $1', [first!.eventId])).rows[0])
      .toMatchObject({ locked_by: 'worker-b', attempts: 2 });
  });

  it('backs off a failed event and moves it to terminal state at the retry limit', async () => {
    await store.commit({
      idempotencyKey: 'pg-outbox-retry',
      toolName: 'crm.create_company',
      tenantId: 'fund-1',
      actorId: 'user-1',
      output: { companyId: 'company-retry' },
      outboxEvent: {
        type: 'tool.execution.completed',
        idempotencyKey: 'pg-outbox-retry',
        toolName: 'crm.create_company',
        tenantId: 'fund-1',
        actorId: 'user-1',
        output: { companyId: 'company-retry' },
      },
    });

    const [claimed] = await store.claim(10, 'worker-a');
    await store.release(claimed!.eventId, 'worker-a', new Error('broker down'));
    let row = await pool.query('SELECT status, attempts, available_at, last_error FROM outbox_events WHERE event_id = $1', [claimed!.eventId]);
    expect(row.rows[0].status).toBe('PENDING');
    expect(row.rows[0].attempts).toBe(1);
    expect(new Date(row.rows[0].available_at).getTime()).toBeGreaterThan(Date.now());
    expect(row.rows[0].last_error).toContain('broker down');

    await pool.query("UPDATE outbox_events SET available_at = NOW() WHERE event_id = $1", [claimed!.eventId]);
    const [second] = await store.claim(10, 'worker-a');
    await store.release(second!.eventId, 'worker-a', new Error('broker down'));
    await pool.query("UPDATE outbox_events SET available_at = NOW() WHERE event_id = $1", [claimed!.eventId]);
    const [third] = await store.claim(10, 'worker-a');
    await store.release(third!.eventId, 'worker-a', new Error('broker down'));

    row = await pool.query('SELECT status, attempts FROM outbox_events WHERE event_id = $1', [claimed!.eventId]);
    expect(row.rows[0]).toMatchObject({ status: 'DEAD', attempts: 3 });
  });
});
