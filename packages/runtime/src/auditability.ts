export type AuditActorType = 'USER' | 'SERVICE' | 'SYSTEM';
export type AuditOutcome = 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'REPLAYED';

export interface AuditCorrelation {
  requestId: string;
  traceId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
}

export interface AuditRecord {
  auditId: string;
  tenantId: string;
  occurredAt: string;
  actorId: string;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: AuditOutcome;
  reasonClass: 'NONE' | 'PROVIDED' | 'SYSTEM';
  correlation: AuditCorrelation;
  version?: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AuditQuery {
  tenantId: string;
  from: string;
  to: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  action?: string;
  outcome?: AuditOutcome;
  limit: number;
  cursor?: string;
}

export interface AuditQueryResult {
  items: AuditRecord[];
  nextCursor?: string;
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  query(query: AuditQuery): Promise<AuditQueryResult>;
}

const FORBIDDEN_KEYS = /^(prompt|completion|password|token|secret|apiKey|authorization|cookie|input|output|body|privateKey|credential|credentials)$/i;

export function validateAuditRecord(record: AuditRecord): void {
  if (!record.auditId || !record.tenantId || !record.actorId || !record.action || !record.resourceType || !record.resourceId) {
    throw new Error('INVALID_AUDIT_RECORD');
  }
  for (const key of Object.keys(record.metadata)) {
    if (FORBIDDEN_KEYS.test(key)) throw new Error('SENSITIVE_AUDIT_DATA');
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    validateAuditRecord(record);
    if (this.records.some((existing) => existing.auditId === record.auditId)) throw new Error('AUDIT_DUPLICATE');
    this.records.push(structuredClone(record));
  }

  async query(query: AuditQuery): Promise<AuditQueryResult> {
    const filtered = this.records
      .filter((r) => r.tenantId === query.tenantId && r.occurredAt >= query.from && r.occurredAt < query.to)
      .filter((r) => !query.resourceType || r.resourceType === query.resourceType)
      .filter((r) => !query.resourceId || r.resourceId === query.resourceId)
      .filter((r) => !query.actorId || r.actorId === query.actorId)
      .filter((r) => !query.action || r.action === query.action)
      .filter((r) => !query.outcome || r.outcome === query.outcome)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.auditId.localeCompare(b.auditId));
    return { items: filtered.slice(0, Math.min(Math.max(query.limit, 1), 100)) };
  }
}
