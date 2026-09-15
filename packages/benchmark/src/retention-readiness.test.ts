import { describe, expect, it } from 'vitest';

describe('retention and purge readiness', () => {
  it('requires retention policy decisions for operational records', () => {
    const policy = createRetentionPolicy({ operationalDays: 30, auditDays: 365, dryRun: true });
    expect(policy.operationalDays).toBe(30);
    expect(policy.auditDays).toBe(365);
    expect(policy.dryRun).toBe(true);
  });
  it('selects only expired records and preserves active records', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    const policy = createRetentionPolicy({ operationalDays: 30, auditDays: 365, dryRun: false });
    const records = [
      { id: 'run-old', kind: 'operational' as const, occurredAt: new Date('2026-08-01T00:00:00.000Z') },
      { id: 'run-active', kind: 'operational' as const, occurredAt: new Date('2026-09-01T00:00:00.000Z') },
      { id: 'audit-old', kind: 'audit' as const, occurredAt: new Date('2025-08-01T00:00:00.000Z') },
    ];
    expect(selectExpiredRecords(records, policy, now).map(({ id }) => id)).toEqual(['run-old', 'audit-old']);
  });
  it('makes purge idempotent and supports dry-run without mutation', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    const policy = createRetentionPolicy({ operationalDays: 30, auditDays: 365, dryRun: true });
    const records = [{ id: 'run-old', kind: 'operational' as const, occurredAt: new Date('2026-08-01T00:00:00.000Z') }];
    const dryRun = purgeExpiredRecords(records, policy, now);
    expect(dryRun.deletedIds).toEqual(['run-old']);
    expect(dryRun.remainingRecords).toHaveLength(1);
    const livePolicy = { ...policy, dryRun: false };
    const first = purgeExpiredRecords(records, livePolicy, now);
    const second = purgeExpiredRecords(first.remainingRecords, livePolicy, now);
    expect(first.deletedIds).toEqual(['run-old']);
    expect(second.deletedIds).toEqual([]);
  });
});
