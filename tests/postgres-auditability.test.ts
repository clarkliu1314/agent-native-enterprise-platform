import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../packages/runtime/src/auditability';
import type { SqlResult, TransactionClient } from '../packages/runtime/src/ports';

const record: AuditRecord = { auditId: 'audit-1', tenantId: 'tenant-a', occurredAt: '2026-09-14T10:00:00.000Z', actorId: 'actor-1', actorType: 'USER', action: 'PAUSE', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED', reasonClass: 'NONE', correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1' }, version: 2, metadata: { resultingState: 'PAUSED' } };
function result<T extends Record<string, unknown>>(rows: T[] = []): SqlResult<T> { return { rows, rowCount: rows.length }; }
describe('postgres auditability', () => {
  it('appends using a parameterized INSERT and never exposes update/delete operations', async () => {
    const queries: string[] = [];
    const db = { query: async <T extends Record<string, unknown>>(sql: string): Promise<SqlResult<T>> => { queries.push(sql); return result<T>(); }, transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>) => fn({ query: async <R extends Record<string, unknown>>(sql: string) => { queries.push(sql); return result<R>([{} as R]); }, commit: async () => undefined, rollback: async () => undefined }) };
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    await new PostgresAuditRepository(db).append(record);
    expect(queries.some((sql) => /^INSERT INTO audit_records/i.test(sql))).toBe(true);
    expect(queries.some((sql) => /\b(UPDATE|DELETE)\s+audit_records\b/i.test(sql))).toBe(false);
  });
  it('queries only within the authenticated tenant and returns deterministic cursor pagination', async () => {
    const queries: string[] = [];
    const db = { query: async <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) => { queries.push(`${sql} :: ${JSON.stringify(params ?? [])}`); return result<T>([{ audit_id: 'audit-1', tenant_id: 'tenant-a', occurred_at: '2026-09-14T10:00:00.000Z', actor_id: 'actor-1', actor_type: 'USER', action: 'PAUSE', resource_type: 'RUN', resource_id: 'run-1', outcome: 'SUCCEEDED', reason_class: 'NONE', request_id: 'req-1', trace_id: 'trace-1', run_id: 'run-1', workflow_id: null, agent_id: null, version: 2, metadata: { resultingState: 'PAUSED' } } as unknown as T]); }, transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>) => fn({ query: async <R extends Record<string, unknown>>() => result<R>(), commit: async () => undefined, rollback: async () => undefined }) };
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    const page = await new PostgresAuditRepository(db).query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 10, cursor: Buffer.from(JSON.stringify({ occurredAt: '2026-09-14T09:00:00.000Z', auditId: 'audit-0' })).toString('base64url') });
    expect(page.items).toHaveLength(1); expect(queries[0]).toMatch(/tenant_id\s*=\s*\$1/i); expect(queries[0]).toMatch(/ORDER BY\s+occurred_at\s+ASC\s*,\s*audit_id\s+ASC/i); expect(queries[0]).toMatch(/LIMIT\s+\$\d+/i);
  });
  it('rejects an unbounded time window or page size before touching the database', async () => { let touched = false; const db = { query: async <T extends Record<string, unknown>>() => { touched = true; return result<T>(); }, transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>) => fn({ query: async <R extends Record<string, unknown>>() => result<R>(), commit: async () => undefined, rollback: async () => undefined }) }; const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository'); await expect(new PostgresAuditRepository(db).query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z', limit: 101 })).rejects.toThrow(); expect(touched).toBe(false); });
  it('uses a database append-only boundary in the durable schema', async () => { const { readFile } = await import('node:fs/promises'); const schema = await readFile('packages/durability/src/durable-schema.sql', 'utf8'); expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS audit_records/i); expect(schema).toMatch(/CREATE (OR REPLACE )?FUNCTION .*audit.*immutable/i); expect(schema).toMatch(/CREATE TRIGGER .*audit.*immutable/i); expect(schema).toMatch(/BEFORE (UPDATE OR DELETE|DELETE OR UPDATE).*ON audit_records/i); });
});
