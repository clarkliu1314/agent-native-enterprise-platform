import { describe, expect, it } from 'vitest';
import {
  AuditRecord,
  AuditRepository,
  AuditQuery,
  InMemoryAuditRepository,
  validateAuditRecord,
} from '../packages/runtime/src/auditability';

describe('auditability contract', () => {
  it('requires an immutable append-only audit record contract', async () => {
    const repository: AuditRepository = new InMemoryAuditRepository();
    const record: AuditRecord = {
      auditId: 'audit-1', tenantId: 'tenant-a', occurredAt: '2026-09-14T10:00:00.000Z',
      actorId: 'user-1', actorType: 'USER', action: 'RUN_PAUSED', resourceType: 'RUN', resourceId: 'run-1',
      outcome: 'SUCCEEDED', reasonClass: 'NONE',
      correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1' },
      version: 8, metadata: { state: 'RUNNING' },
    };
    await repository.append(record);
    const query: AuditQuery = { tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 20 };
    expect((await repository.query(query)).items).toEqual([record]);
    expect('update' in repository).toBe(false);
    expect('delete' in repository).toBe(false);
  });

  it('rejects forbidden sensitive metadata', () => {
    expect(() => validateAuditRecord({
      auditId: 'audit-2', tenantId: 'tenant-a', occurredAt: '2026-09-14T10:00:00.000Z',
      actorId: 'user-1', actorType: 'USER', action: 'RUN_STARTED', resourceType: 'RUN', resourceId: 'run-1',
      outcome: 'SUCCEEDED', reasonClass: 'NONE', correlation: { requestId: 'req-1', traceId: 'trace-1' },
      metadata: { prompt: 'do not persist this' },
    })).toThrow();
  });
});