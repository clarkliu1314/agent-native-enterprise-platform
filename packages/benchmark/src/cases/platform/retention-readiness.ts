export type RetentionKind = 'operational' | 'audit';

export interface RetentionPolicy {
  operationalDays: number;
  auditDays: number;
  dryRun: boolean;
}

export interface RetentionRecord {
  id: string;
  kind: RetentionKind;
  occurredAt: Date;
}

export interface PurgeResult {
  deletedIds: string[];
  remainingRecords: RetentionRecord[];
}

export function createRetentionPolicy(input: RetentionPolicy): RetentionPolicy {
  if (!Number.isInteger(input.operationalDays) || input.operationalDays < 0) {
    throw new Error('operational retention must be a non-negative integer');
  }
  if (!Number.isInteger(input.auditDays) || input.auditDays < 0) {
    throw new Error('audit retention must be a non-negative integer');
  }
  return { ...input };
}

export function selectExpiredRecords(
  records: readonly RetentionRecord[],
  policy: RetentionPolicy,
  now: Date,
): RetentionRecord[] {
  return records.filter((record) => {
    const ageDays = (now.getTime() - record.occurredAt.getTime()) / 86_400_000;
    const retentionDays = record.kind === 'audit' ? policy.auditDays : policy.operationalDays;
    return ageDays >= retentionDays;
  });
}

export function purgeExpiredRecords(
  records: readonly RetentionRecord[],
  policy: RetentionPolicy,
  now: Date,
): PurgeResult {
  const expired = selectExpiredRecords(records, policy, now);
  const deletedIds = expired.map(({ id }) => id);
  return {
    deletedIds,
    remainingRecords: policy.dryRun
      ? [...records]
      : records.filter(({ id }) => !new Set(deletedIds).has(id)),
  };
}
