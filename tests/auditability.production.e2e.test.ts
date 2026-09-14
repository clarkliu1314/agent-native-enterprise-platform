import { describe, expect, it } from 'vitest';

describe('auditability production composition RED gate', () => {
  it('exposes auditability through the production durable composition', async () => {
    const { PostgresAuditRepository } = await import('../packages/runtime/src/postgres-audit-repository');
    expect(PostgresAuditRepository).toBeDefined();
  });

  it('wires the bounded audit query handler into the production composition', async () => {
    const { composeApi } = await import('../apps/api/src/composition');
    const { InMemoryAgentRuntime } = await import('../packages/runtime/src/in-memory-runtime');

    const composition = composeApi(new InMemoryAgentRuntime());

    expect(composition).toHaveProperty('auditQueryHandler');
    expect(typeof composition.auditQueryHandler).toBe('function');
  });
});
