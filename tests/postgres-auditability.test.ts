import { describe, expect, it } from 'vitest';

describe('postgres auditability RED gate', () => {
  it('provides an immutable postgres audit repository', async () => {
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    expect(PostgresAuditRepository).toBeDefined();
  });
});