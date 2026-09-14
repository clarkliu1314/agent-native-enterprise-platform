import { describe, expect, it } from 'vitest';
import type { SqlResult, TransactionClient } from '../packages/runtime/src/ports';
import type { AuditRecord, AuditRepository } from '../packages/runtime/src/auditability';

function result<T extends Record<string, unknown>>(rows: T[] = []): SqlResult<T> {
  return { rows, rowCount: rows.length };
}

describe('material runtime audit RED gate', () => {
  it('audits RUN_CREATED inside the same durable transaction', async () => {
    const auditRecords: AuditRecord[] = [];
    const audit: AuditRepository & { appendInTransaction?: (tx: TransactionClient, record: AuditRecord) => Promise<void> } = {
      append: async (record) => { auditRecords.push(record); },
      appendInTransaction: async (_tx, record) => { auditRecords.push(record); },
      query: async () => ({ items: [] }),
    };
    const runRow = {
      run_id: 'run-1', agent_id: 'agent-1', state: 'QUEUED', input: {}, metadata: {
        tenantId: 'tenant-a', requestId: 'req-1', traceId: 'trace-1', workflowId: 'workflow-1',
      }, fencing_token: 0n, attempt: 0, created_at: '2026-09-14T10:00:00.000Z',
    };
    const eventRow = {
      event_id: 'event-1', run_id: 'run-1', sequence: 1n, type: 'RUN_CREATED',
      payload: {}, created_at: '2026-09-14T10:00:00.000Z',
    };
    const queries: string[] = [];
    const db = {
      query: async <T extends Record<string, unknown>>(sql: string): Promise<SqlResult<T>> => {
        queries.push(sql);
        return result<T>();
      },
      transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => fn({
        query: async <R extends Record<string, unknown>>(sql: string): Promise<SqlResult<R>> => {
          queries.push(sql);
          if (/INSERT INTO agent_runs/i.test(sql)) return result<R>([runRow as unknown as R]);
          if (/INSERT INTO agent_events/i.test(sql)) return result<R>([eventRow as unknown as R]);
          return result<R>();
        },
        commit: async () => undefined,
        rollback: async () => undefined,
      }),
    };

    const { PostgresRuntimeRepositories } = await import('../packages/runtime/src/postgres-runtime-repositories');
    const Repositories = PostgresRuntimeRepositories as unknown as new (db: typeof db, audit: AuditRepository) => InstanceType<typeof PostgresRuntimeRepositories>;
    const repositories = new Repositories(db, audit);

    await repositories.admitRun({
      command: {
        agentId: 'agent-1', input: { safe: true }, metadata: runRow.metadata,
        idempotencyKey: 'idem-1', executionMode: 'async',
      },
      commandHash: 'hash-1', runId: 'run-1', eventId: 'event-1',
    });

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0]).toMatchObject({
      tenantId: 'tenant-a', action: 'RUN_CREATED', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED',
      actorId: 'system', actorType: 'SYSTEM',
      correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1', workflowId: 'workflow-1', agentId: 'agent-1' },
      metadata: { resultingState: 'QUEUED' },
    });
    expect(queries.filter((sql) => /INSERT INTO audit_records/i.test(sql))).toHaveLength(1);
  });
});
