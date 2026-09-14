import { describe, expect, it } from 'vitest';

describe('auditability production composition RED gate', () => {
  it('exposes auditability through the production durable composition', async () => {
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    expect(PostgresAuditRepository).toBeDefined();
  });
});