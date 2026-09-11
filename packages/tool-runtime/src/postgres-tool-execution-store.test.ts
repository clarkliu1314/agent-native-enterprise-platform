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
      idempotencyKey: 'pg-idem-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1',
      output: { companyId: 'company-1' },
      outboxEvent: { type: 'tool.execution.completed', idempotencyKey: 'pg-idem-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-1' } },
    });
    const reloadedStore = new PostgresToolExecutionStore(pool);
    expect(await reloadedStore.get({ idempotencyKey: 'pg-idem-1', tenantId: 'fund-1', toolName: 'crm.create_company' })).toEqual({ companyId: 'company-1' });
  });

  it('commits exactly one idempotency row and one outbox event for repeated commits', async () => {
    const commit = {
      idempotencyKey: 'pg-idem-duplicate', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1',
      output: { companyId: 'company-2' },
      outboxEvent: { type: 'tool.execution.completed' as const, idempotencyKey: 'pg-idem-duplicate', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-2' } },
    };
    await store.commit(commit);
    await store.commit(commit);
    const rows = await pool.query(`SELECT (SELECT COUNT(*) FROM tool_execution_idempotency WHERE idempotency_key = $1) AS idempotency_count, (SELECT COUNT(*) FROM outbox_events WHERE idempotency_key = $1) AS outbox_count`, [commit.idempotencyKey]);
    expect(Number(rows.rows[0].idempotency_count)).toBe(1);
    expect(Number(rows.rows[0].outbox_count)).toBe(1);
  });

  it('does not allow one tenant to read another tenant\'s idempotency result', async () => {
    await store.commit({
      idempotencyKey: 'pg-tenant-isolation', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1',
      output: { companyId: 'company-secret' },
      outboxEvent: { type: 'tool.execution.completed', idempotencyKey: 'pg-tenant-isolation', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-secret' } },
    });
    expect(await store.get({ idempotencyKey: 'pg-tenant-isolation', tenantId: 'fund-2', toolName: 'crm.create_company' })).toBeNull();
  });
});
