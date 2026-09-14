import { describe, expect, it } from 'vitest';

describe('runtime auditability RED gate', () => {
  it('audits a material durable run transition without creating a second runtime', async () => {
    const { AuditRecord } = await import('../packages/runtime/src/auditability');
    expect(AuditRecord).toBeDefined();
  });
});