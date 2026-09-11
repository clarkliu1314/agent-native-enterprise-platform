import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresToolExecutionStore } from './postgres-tool-execution-store';
import { ToolExecutionService } from './tool-execution';

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

  it('reserves a new key as IN_PROGRESS and replays after success', async () => {
    const first = await store.reserve({ idempotencyKey: 'state-1', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Acme' } });
    expect(first).toEqual({ kind: 'RESERVED', state: 'IN_PROGRESS' });
    await store.commit({ idempotencyKey: 'state-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-1' }, outboxEvent: { type: 'tool.execution.completed', idempotencyKey: 'state-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-1' } } });
    expect(await store.reserve({ idempotencyKey: 'state-1', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Acme' } })).toEqual({ kind: 'REPLAY', state: 'SUCCEEDED', output: { companyId: 'company-1' } });
  });

  it('reconciles a succeeded result whose outbox event was missing after a crash', async () => {
    const request = {
      tool: { name: 'crm.create_company', description: 'create company', sideEffect: true },
      input: { name: 'Acme' },
      context: { actorId: 'user-1', tenantId: 'fund-1', permissions: ['crm:write'] },
      idempotencyKey: 'state-reconcile',
    };
    await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input });
    await store.commit({ idempotencyKey: request.idempotencyKey, toolName: request.tool.name, tenantId: request.context.tenantId, actorId: request.context.actorId, output: { companyId: 'company-reconcile' }, outboxEvent: { type: 'tool.execution.completed', idempotencyKey: request.idempotencyKey, toolName: request.tool.name, tenantId: request.context.tenantId, actorId: request.context.actorId, output: { companyId: 'company-reconcile' } } });
    await pool.query('DELETE FROM outbox_events WHERE idempotency_key = $1', [request.idempotencyKey]);

    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => ({ companyId: 'must-not-execute-again' }),
      store,
    });
    const result = await service.execute(request);
    const rows = await pool.query('SELECT event_id, event_type, payload FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]);

    expect(result).toEqual({ output: { companyId: 'company-reconcile' }, replayed: true });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ event_type: 'tool.execution.completed', payload: { companyId: 'company-reconcile' } });
  });

  it('rejects the same key with a different payload as an explicit conflict', async () => {
    await store.reserve({ idempotencyKey: 'state-conflict', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Acme' } });
    expect(await store.reserve({ idempotencyKey: 'state-conflict', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Beta' } })).toEqual({ kind: 'CONFLICT', state: 'IN_PROGRESS' });
  });

  it('allows a retryable failure to be reserved again after the failure transition', async () => {
    await store.reserve({ idempotencyKey: 'state-retry', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Retry me' } });
    await store.fail({ idempotencyKey: 'state-retry', tenantId: 'fund-1', toolName: 'crm.create_company', error: new Error('temporary'), retryable: true });
    expect(await store.reserve({ idempotencyKey: 'state-retry', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Retry me' } })).toEqual({ kind: 'RETRY', state: 'FAILED_RETRYABLE' });
  });

  it('does not allow a final failure to execute again', async () => {
    await store.reserve({ idempotencyKey: 'state-final', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Never retry' } });
    await store.fail({ idempotencyKey: 'state-final', tenantId: 'fund-1', toolName: 'crm.create_company', error: new Error('validation failed'), retryable: false });
    expect(await store.reserve({ idempotencyKey: 'state-final', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Never retry' } })).toEqual({ kind: 'CONFLICT', state: 'FAILED_FINAL' });
  });

  it('coordinates two workers so only one gets the reservation', async () => {
    const results = await Promise.all([
      store.reserve({ idempotencyKey: 'state-race', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'worker-1', input: { name: 'Race' } }),
      store.reserve({ idempotencyKey: 'state-race', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'worker-2', input: { name: 'Race' } }),
    ]);
    expect(results.filter((result) => result.kind === 'RESERVED')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'CONFLICT' && result.state === 'IN_PROGRESS')).toHaveLength(1);
  });

  it('durably reloads an idempotent result after a new store instance is created', async () => {
    await store.reserve({ idempotencyKey: 'pg-idem-1', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Acme Capital' } });
    await store.commit({ idempotencyKey: 'pg-idem-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-1' }, outboxEvent: { type: 'tool.execution.completed', idempotencyKey: 'pg-idem-1', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-1' } } });
    const reloadedStore = new PostgresToolExecutionStore(pool);
    expect(await reloadedStore.get({ idempotencyKey: 'pg-idem-1', tenantId: 'fund-1', toolName: 'crm.create_company' })).toEqual({ companyId: 'company-1' });
  });

  it('commits exactly one idempotency row and one outbox event for a reserved key', async () => {
    const commit = { idempotencyKey: 'pg-idem-duplicate', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-2' }, outboxEvent: { type: 'tool.execution.completed' as const, idempotencyKey: 'pg-idem-duplicate', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-2' } } };
    await store.reserve({ idempotencyKey: commit.idempotencyKey, tenantId: commit.tenantId, toolName: commit.toolName, actorId: commit.actorId, input: { name: 'Duplicate' } });
    await store.commit(commit);
    const rows = await pool.query(`SELECT (SELECT COUNT(*) FROM tool_execution_idempotency WHERE idempotency_key = $1) AS idempotency_count, (SELECT COUNT(*) FROM outbox_events WHERE idempotency_key = $1) AS outbox_count`, [commit.idempotencyKey]);
    expect(Number(rows.rows[0].idempotency_count)).toBe(1);
    expect(Number(rows.rows[0].outbox_count)).toBe(1);
  });

  it('does not allow one tenant to read another tenant\'s idempotency result', async () => {
    await store.reserve({ idempotencyKey: 'pg-tenant-isolation', tenantId: 'fund-1', toolName: 'crm.create_company', actorId: 'user-1', input: { name: 'Secret' } });
    await store.commit({ idempotencyKey: 'pg-tenant-isolation', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-secret' }, outboxEvent: { type: 'tool.execution.completed', idempotencyKey: 'pg-tenant-isolation', toolName: 'crm.create_company', tenantId: 'fund-1', actorId: 'user-1', output: { companyId: 'company-secret' } } });
    expect(await store.get({ idempotencyKey: 'pg-tenant-isolation', tenantId: 'fund-2', toolName: 'crm.create_company' })).toBeNull();
  });
});
