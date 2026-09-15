import type { SecurityContext } from './security-context';
import { requireSecurityContext } from './security-context';

export type RetentionCategory = 'AUDIT' | 'TELEMETRY' | 'DELIVERY' | 'CORRECTNESS';

export interface RetentionRecord {
  id: string;
  tenantId: string;
  category: RetentionCategory;
  occurredAt: string;
}

export interface RetentionEvidence {
  action: 'RETENTION_PURGE';
  tenantId: string;
  actorId: string;
  category: Exclude<RetentionCategory, 'CORRECTNESS'>;
  cutoff: string;
  deletedIds: string[];
  deletedCount: number;
  idempotencyKey: string;
  occurredAt: string;
}

export interface RetentionRepository {
  findExpired(tenantId: string, category: Exclude<RetentionCategory, 'CORRECTNESS'>, cutoff: string): Promise<RetentionRecord[]>;
  deleteExpired(tenantId: string, category: Exclude<RetentionCategory, 'CORRECTNESS'>, ids: readonly string[]): Promise<number>;
  findPurgeEvidence(tenantId: string, idempotencyKey: string): Promise<RetentionEvidence | null>;
  appendPurgeEvidence(evidence: RetentionEvidence): Promise<void>;
}

export interface RetentionPolicy {
  auditDays?: number;
  telemetryDays?: number;
  deliveryDays?: number;
  correctnessDays?: number;
}

export interface PurgeRequest {
  context: SecurityContext | null | undefined;
  tenantId?: string;
  category: RetentionCategory;
  now: string;
  idempotencyKey: string;
}

export interface PurgeResult {
  deletedIds: string[];
  deletedCount: number;
  replayed: boolean;
  evidence: RetentionEvidence;
}

const PERMISSION: Record<Exclude<RetentionCategory, 'CORRECTNESS'>, string> = {
  AUDIT: 'retention:purge:audit',
  TELEMETRY: 'retention:purge:telemetry',
  DELIVERY: 'retention:purge:delivery',
};

export class RetentionPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RetentionPolicyError';
  }
}

export class InMemoryRetentionRepository implements RetentionRepository {
  private readonly records: RetentionRecord[];
  private readonly evidence = new Map<string, RetentionEvidence>();

  constructor(records: RetentionRecord[] = []) {
    this.records = records.map((record) => ({ ...record }));
  }

  async findExpired(tenantId: string, category: Exclude<RetentionCategory, 'CORRECTNESS'>, cutoff: string): Promise<RetentionRecord[]> {
    return this.records
      .filter((record) => record.tenantId === tenantId && record.category === category && record.occurredAt < cutoff)
      .map((record) => ({ ...record }));
  }

  async deleteExpired(tenantId: string, category: Exclude<RetentionCategory, 'CORRECTNESS'>, ids: readonly string[]): Promise<number> {
    const wanted = new Set(ids);
    let deleted = 0;
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];
      if (record.tenantId === tenantId && record.category === category && wanted.has(record.id)) {
        this.records.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  async findPurgeEvidence(tenantId: string, idempotencyKey: string): Promise<RetentionEvidence | null> {
    return this.evidence.get(`${tenantId}:${idempotencyKey}`) ?? null;
  }

  async appendPurgeEvidence(evidence: RetentionEvidence): Promise<void> {
    const key = `${evidence.tenantId}:${evidence.idempotencyKey}`;
    if (this.evidence.has(key)) throw new RetentionPolicyError('RETENTION_DUPLICATE', 'Purge evidence already exists');
    this.evidence.set(key, { ...evidence, deletedIds: [...evidence.deletedIds] });
  }

  async list(tenantId: string, category: RetentionCategory): Promise<RetentionRecord[]> {
    return this.records.filter((record) => record.tenantId === tenantId && record.category === category).map((record) => ({ ...record }));
  }

  async listEvidence(tenantId: string): Promise<RetentionEvidence[]> {
    return [...this.evidence.values()].filter((item) => item.tenantId === tenantId).map((item) => ({ ...item, deletedIds: [...item.deletedIds] }));
  }
}

export class RetentionPurgeService {
  private readonly policy: Required<RetentionPolicy>;

  constructor(private readonly repository: RetentionRepository, policy: RetentionPolicy) {
    this.policy = {
      auditDays: policy.auditDays ?? 365,
      telemetryDays: policy.telemetryDays ?? 90,
      deliveryDays: policy.deliveryDays ?? 30,
      correctnessDays: policy.correctnessDays ?? Number.POSITIVE_INFINITY,
    };
    for (const [key, days] of Object.entries(this.policy)) {
      if (days <= 0) throw new RetentionPolicyError('RETENTION_INVALID_POLICY', `${key} must be positive`);
    }
  }

  async purge(request: PurgeRequest): Promise<PurgeResult> {
    const nowMs = Date.parse(request.now);
    if (!Number.isFinite(nowMs)) throw new RetentionPolicyError('RETENTION_INVALID_TIMESTAMP', 'now must be a valid timestamp');
    if (!request.idempotencyKey?.trim()) throw new RetentionPolicyError('RETENTION_INVALID_IDEMPOTENCY_KEY', 'idempotencyKey is required');

    const context = request.context;
    if (!context) throw new RetentionPolicyError('RETENTION_AUTHORIZATION_DENIED', 'security context is required');
    if (request.tenantId !== undefined && request.tenantId !== context.tenantId) {
      throw new RetentionPolicyError('RETENTION_TENANT_MISMATCH', 'tenant ownership mismatch');
    }
    const tenantId = context.tenantId;
    if (request.category === 'CORRECTNESS') {
      throw new RetentionPolicyError('RETENTION_PROTECTED_DATA', 'correctness state is protected from generic retention purge');
    }
    try {
      requireSecurityContext(context, PERMISSION[request.category]);
    } catch {
      throw new RetentionPolicyError('RETENTION_AUTHORIZATION_DENIED', 'retention purge is not authorized');
    }

    const existing = await this.repository.findPurgeEvidence(tenantId, request.idempotencyKey);
    if (existing) return { deletedIds: [...existing.deletedIds], deletedCount: existing.deletedCount, replayed: true, evidence: existing };

    const retentionDays = this.daysFor(request.category);
    const cutoff = new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const expired = await this.repository.findExpired(tenantId, request.category, cutoff);
    const deletedIds = expired.map((item) => item.id);
    const deletedCount = deletedIds.length === 0 ? 0 : await this.repository.deleteExpired(tenantId, request.category, deletedIds);
    if (deletedCount !== deletedIds.length) throw new RetentionPolicyError('RETENTION_DELETE_CONFLICT', 'retention deletion count changed unexpectedly');

    const evidence: RetentionEvidence = {
      action: 'RETENTION_PURGE',
      tenantId,
      actorId: context.actorId,
      category: request.category,
      cutoff,
      deletedIds: [...deletedIds],
      deletedCount,
      idempotencyKey: request.idempotencyKey,
      occurredAt: request.now,
    };
    await this.repository.appendPurgeEvidence(evidence);
    return { deletedIds, deletedCount, replayed: false, evidence };
  }

  private daysFor(category: Exclude<RetentionCategory, 'CORRECTNESS'>): number {
    if (category === 'AUDIT') return this.policy.auditDays;
    if (category === 'TELEMETRY') return this.policy.telemetryDays;
    return this.policy.deliveryDays;
  }
}
