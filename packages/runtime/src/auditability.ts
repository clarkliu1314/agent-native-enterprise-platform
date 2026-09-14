import type { RunView } from '@agent-native/runtime-contract/durable';
import type { SqlClient } from './ports';

export type AuditActorType = 'USER' | 'SERVICE' | 'SYSTEM';
export type AuditOutcome = 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'REPLAYED';
export type AuditReasonClass = 'NONE' | 'PROVIDED' | 'SYSTEM';
export type AuditScalar = string | number | boolean | null;

export interface AuditCorrelation { requestId: string; traceId: string; runId?: string; workflowId?: string; agentId?: string; }
export interface AuditRecord { auditId: string; tenantId: string; occurredAt: string; actorId: string; actorType: AuditActorType; action: string; resourceType: string; resourceId: string; outcome: AuditOutcome; reasonClass: AuditReasonClass; correlation: AuditCorrelation; version?: number; metadata: Record<string, AuditScalar>; }
export interface AuditQuery { tenantId: string; from: string; to: string; resourceType?: string; resourceId?: string; actorId?: string; action?: string; outcome?: AuditOutcome; limit: number; cursor?: string; }
export interface AuditQueryResult { items: AuditRecord[]; nextCursor?: string; }
export interface AuditRepository { append(record: AuditRecord): Promise<void>; query(query: AuditQuery): Promise<AuditQueryResult>; }
export interface TransactionalAuditRepository extends AuditRepository { appendInTransaction(tx: SqlClient, record: AuditRecord): Promise<void>; }

export function buildRunAuditRecord(input: { run: RunView; tenantId: string; version: number; from: RunView['state']; action: string; actorId: string; occurredAt: string; correlation: Pick<AuditCorrelation, 'requestId' | 'traceId'> }): AuditRecord {
  const workflowId = typeof input.run.metadata?.workflowId === 'string' ? input.run.metadata.workflowId : undefined;
  const agentId = input.run.agentId;
  return {
    auditId: `audit:${input.run.runId}:${input.action}:${input.version}`,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    actorType: 'SYSTEM',
    action: input.action,
    resourceType: 'RUN',
    resourceId: input.run.runId,
    outcome: input.run.state === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    reasonClass: 'NONE',
    correlation: { ...input.correlation, runId: input.run.runId, ...(workflowId ? { workflowId } : {}), ...(agentId ? { agentId } : {}) },
    version: input.version,
    metadata: { fromState: input.from, resultingState: input.run.state },
  };
}

export function buildRunLifecycleAuditRecord(input: { run: RunView; tenantId: string; version: number; action: string; actorId?: string; occurredAt: string; correlation: Pick<AuditCorrelation, 'requestId' | 'traceId'>; fromState?: RunView['state'] }): AuditRecord {
  const workflowId = typeof input.run.metadata?.workflowId === 'string' ? input.run.metadata.workflowId : undefined;
  return {
    auditId: `audit:${input.run.runId}:${input.action}:${input.version}`,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    actorId: input.actorId ?? 'system',
    actorType: 'SYSTEM',
    action: input.action,
    resourceType: 'RUN',
    resourceId: input.run.runId,
    outcome: input.run.state === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    reasonClass: 'NONE',
    correlation: { ...input.correlation, runId: input.run.runId, ...(workflowId ? { workflowId } : {}), ...(input.run.agentId ? { agentId: input.run.agentId } : {}) },
    version: input.version,
    metadata: { ...(input.fromState ? { fromState: input.fromState } : {}), resultingState: input.run.state },
  };
}

const FORBIDDEN_KEYS = /^(prompt|completion|password|token|secret|apiKey|authorization|cookie|input|output|body|privateKey|credential|credentials)$/i;
const MAX_LIMIT = 100;
export function validateAuditRecord(record: AuditRecord): void {
  if (!record.auditId || !record.tenantId || !record.actorId || !record.action || !record.resourceType || !record.resourceId) throw new Error('INVALID_AUDIT_RECORD');
  if (!['USER', 'SERVICE', 'SYSTEM'].includes(record.actorType)) throw new Error('INVALID_AUDIT_ACTOR');
  if (!['SUCCEEDED', 'REJECTED', 'FAILED', 'REPLAYED'].includes(record.outcome)) throw new Error('INVALID_AUDIT_OUTCOME');
  if (!['NONE', 'PROVIDED', 'SYSTEM'].includes(record.reasonClass)) throw new Error('INVALID_AUDIT_REASON_CLASS');
  if (!record.correlation.requestId || !record.correlation.traceId) throw new Error('INVALID_AUDIT_CORRELATION');
  if (!Number.isInteger(record.version ?? 0) || (record.version ?? 0) < 0) throw new Error('INVALID_AUDIT_VERSION');
  if (!Number.isFinite(Date.parse(record.occurredAt))) throw new Error('INVALID_AUDIT_TIMESTAMP');
  for (const [key, value] of Object.entries(record.metadata)) { if (FORBIDDEN_KEYS.test(key)) throw new Error('SENSITIVE_AUDIT_DATA'); if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new Error('INVALID_AUDIT_METADATA'); }
}
export class InMemoryAuditRepository implements AuditRepository, TransactionalAuditRepository {
  private readonly records: AuditRecord[] = [];
  async append(record: AuditRecord): Promise<void> { validateAuditRecord(record); if (this.records.some((existing) => existing.auditId === record.auditId)) throw new Error('AUDIT_DUPLICATE'); this.records.push(structuredClone(record)); }
  async appendInTransaction(_tx: SqlClient, record: AuditRecord): Promise<void> { await this.append(record); }
  async query(query: AuditQuery): Promise<AuditQueryResult> { const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT); const filtered = this.records.filter((r) => r.tenantId === query.tenantId && r.occurredAt >= query.from && r.occurredAt < query.to).filter((r) => !query.resourceType || r.resourceType === query.resourceType).filter((r) => !query.resourceId || r.resourceId === query.resourceId).filter((r) => !query.actorId || r.actorId === query.actorId).filter((r) => !query.action || r.action === query.action).filter((r) => !query.outcome || r.outcome === query.outcome).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.auditId.localeCompare(b.auditId)); return { items: filtered.slice(0, limit) }; }
}
