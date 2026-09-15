import { describe, expect, it } from 'vitest';
import {
  InMemoryRetentionRepository,
  RetentionPurgeService,
  RetentionPolicyError,
  type RetentionRecord,
} from './retention-policy';

const context = (permissions: string[] = ['retention:purge:telemetry']) => ({
  tenantId: 'tenant-a',
  actorId: 'operator-1',
  permissions,
});

const record = (overrides: Partial<RetentionRecord> = {}): RetentionRecord => ({
  id: 'telemetry-1',
  tenantId: 'tenant-a',
  category: 'TELEMETRY',
  occurredAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('RetentionPurgeService', () => {
  it('purges only tenant-owned records older than the configured cutoff', async () => {
    const repository = new InMemoryRetentionRepository([
      record(),
      record({ id: 'telemetry-2', occurredAt: '2026-02-01T00:00:00.000Z' }),
      record({ id: 'other-tenant', tenantId: 'tenant-b' }),
    ]);
    const service = new RetentionPurgeService(repository, { telemetryDays: 60 });

    const result = await service.purge({
      context: context(),
      category: 'TELEMETRY',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-1',
    });

    expect(result.deletedIds).toEqual(['telemetry-1']);
    expect(await repository.list('tenant-a', 'TELEMETRY')).toHaveLength(1);
    expect(await repository.list('tenant-b', 'TELEMETRY')).toHaveLength(1);
  });

  it('fails closed for missing or cross-tenant authorization', async () => {
    const repository = new InMemoryRetentionRepository([record()]);
    const service = new RetentionPurgeService(repository, { telemetryDays: 1 });

    await expect(service.purge({
      context: undefined,
      category: 'TELEMETRY',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-2',
    })).rejects.toThrow('RETENTION_AUTHORIZATION_DENIED');

    await expect(service.purge({
      context: context(),
      tenantId: 'tenant-b',
      category: 'TELEMETRY',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-3',
    })).rejects.toThrow('RETENTION_TENANT_MISMATCH');
  });

  it('never allows generic purge of correctness state', async () => {
    const repository = new InMemoryRetentionRepository([
      record({ id: 'run-1', category: 'CORRECTNESS' }),
    ]);
    const service = new RetentionPurgeService(repository, { correctnessDays: 1 });

    await expect(service.purge({
      context: context(['retention:purge:correctness']),
      category: 'CORRECTNESS',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-4',
    })).rejects.toThrow('RETENTION_PROTECTED_DATA');
    expect(await repository.list('tenant-a', 'CORRECTNESS')).toHaveLength(1);
  });

  it('requires a dedicated permission for audit retention and records an evidence event', async () => {
    const repository = new InMemoryRetentionRepository([
      record({ id: 'audit-1', category: 'AUDIT' }),
    ]);
    const service = new RetentionPurgeService(repository, { auditDays: 30 });

    await expect(service.purge({
      context: context(),
      category: 'AUDIT',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-5',
    })).rejects.toThrow('RETENTION_AUTHORIZATION_DENIED');

    const result = await service.purge({
      context: context(['retention:purge:audit']),
      category: 'AUDIT',
      now: '2026-03-15T00:00:00.000Z',
      idempotencyKey: 'purge-6',
    });
    expect(result.deletedIds).toEqual(['audit-1']);
    expect(result.evidence.action).toBe('RETENTION_PURGE');
    expect(result.evidence.deletedCount).toBe(1);
    expect(result.evidence.tenantId).toBe('tenant-a');
  });

  it('is idempotent for a repeated authorized purge request', async () => {
    const repository = new InMemoryRetentionRepository([record()]);
    const service = new RetentionPurgeService(repository, { telemetryDays: 1 });
    const request = {
      context: context(), category: 'TELEMETRY' as const,
      now: '2026-03-15T00:00:00.000Z', idempotencyKey: 'purge-7',
    };

    const first = await service.purge(request);
    const second = await service.purge(request);

    expect(first.deletedIds).toEqual(['telemetry-1']);
    expect(second.replayed).toBe(true);
    expect(second.deletedIds).toEqual(first.deletedIds);
    expect(second.deletedCount).toBe(first.deletedCount);
    expect(second.evidence).toEqual(first.evidence);
    expect(await repository.listEvidence('tenant-a')).toHaveLength(1);
  });

  it('rejects invalid retention configuration and invalid timestamps', () => {
    expect(() => new RetentionPurgeService(new InMemoryRetentionRepository(), { telemetryDays: 0 }))
      .toThrow(RetentionPolicyError);
  });
});
