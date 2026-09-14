import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository, type AuditRecord, validateAuditRecord } from '../packages/runtime/src/auditability';
import schema from '../packages/durability/src/durable-schema.sql?raw';

const baseRecord = (): AuditRecord => ({
  auditId: 'audit-1',
  tenantId: 'tenant-a',
  occurredAt: '2026-09-14T10:00:00.000Z',
  actorId: 'user-1',
  actorType: 'USER',
  action: 'PAUSE',
  resourceType: 'RUN',
  resourceId: 'run-1',
  outcome: 'SUCCEEDED',
  reasonClass: 'NONE',
  correlation: { requestId: 'req-1', traceId: 'trace-1' },
  metadata: {},
});

describe('auditability immutability and sensitive-data boundary', () => {
  it('fails closed for sensitive metadata keys and non-scalar metadata', () => {
    for (const key of ['promptText', 'completionText', 'api_key', 'rawRequestBody', 'authorizationHeader', 'toolInput', 'private_key']) {
      const record = baseRecord() as AuditRecord & { metadata: Record<string, unknown> };
      record.metadata = { [key]: 'secret-value' };
      expect(() => validateAuditRecord(record)).toThrow('SENSITIVE_AUDIT_DATA');
    }

    const record = baseRecord() as AuditRecord & { metadata: Record<string, unknown> };
    record.metadata = { safeClassification: { nested: 'forbidden' } };
    expect(() => validateAuditRecord(record)).toThrow('INVALID_AUDIT_METADATA');
  });

  it('exposes an append/query-only in-memory audit boundary', async () => {
    const repository = new InMemoryAuditRepository();
    await repository.append(baseRecord());
    const result = await repository.query({
      tenantId: 'tenant-a',
      from: '2026-09-14T00:00:00.000Z',
      to: '2026-09-15T00:00:00.000Z',
      limit: 100,
    });
    expect(result.items).toHaveLength(1);
    expect((repository as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((repository as unknown as Record<string, unknown>).delete).toBeUndefined();
  });

  it('defines a database-level append-only boundary for audit records', () => {
    expect(schema).toContain('BEFORE UPDATE OR DELETE ON audit_records');
    expect(schema).toContain("RAISE EXCEPTION 'audit_records are append-only'");
    expect(schema).toContain('audit_records_immutable_trigger');
  });
});
