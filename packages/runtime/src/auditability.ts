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
  return { auditId: `audit:${input.run.runId}:${input.action}:${input.version}`, tenantId: input.tenantId, occurredAt: input.occurredAt, actorId: input.actorId, actorType: 'SYSTEM', action: input.action, resourceType: 'RUN', resourceId: input.run.runId, outcome: input.run.state === 'FAILED' ? 'FAILED' : 'SUCCEEDED', reasonClass: 'NONE', correlation: { ...input.correlation, runId: input.run.runId, ...(workflowId ? { workflowId } : {}), ...(agentId ? { agentId } : {}) }, version: input.version, metadata: { fromState: input.from, resultingState: input.run.state } };
}

export function buildRunLifecycleAuditRecord(input: { run: RunView; tenantId: string; version: number; action: string; actorId?: string; occurredAt: string; correlation: Pick<AuditCorrelation, 'requestId' | 'traceId'>; fromState?: RunView['state'] }): AuditRecord {
  const workflowId = typeof input.run.metadata?.workflowId === 'string' ? input.run.metadata.workflowId : undefined;
  return { auditId: `audit:${input.run.runId}:${input.action}:${input.version}`, tenantId: input.tenantId, occurredAt: input.occurredAt, actorId: input.actorId ?? 'system', actorType: 'SYSTEM', action: input.action, resourceType: 'RUN', resourceId: input.run.runId, outcome: input.run.state === 'FAILED' ? 'FAILED' : 'SUCCEEDED', reasonClass: 'NONE', correlation: { ...input.correlation, runId: input.run.runId, ...(workflowId ? { workflowId } : {}), ...(input.run.agentId ? { agentId: input.run.agentId } : {}) }, version: input.version, metadata: { ...(input.fromState ? { fromState: input.fromState } : {}), resultingState: input.run.state } };
}

const FORBIDDEN_KEY_PARTS = ['prompt', 'completion', 'password', 'token', 'secret', 'apikey', 'authorization', 'cookie', 'input', 'output', 'body', 'privatekey', 'credential'];
const MAX_LIMIT = 100;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
function isForbiddenKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
}
export function validateAuditRecord(record: AuditRecord): void {
  if (!record.auditId || !record.tenantId || !record.actorId || !record.action || !record.resourceType || !record.resourceId) throw new Error('INVALID_AUDIT_RECORD');
  if (!['USER', 'SERVICE', 'SYSTEM'].includes(record.actorType)) throw new Error('INVALID_AUDIT_ACTOR');
  if (!['SUCCEEDED', 'REJECTED', 'FAILED', 'REPLAYED'].includes(record.outcome)) throw new Error('INVALID_AUDIT_OUTCOME');
  if (!['NONE', 'PROVIDED', 'SYSTEM'].includes(record.reasonClass)) throw new Error('INVALID_AUDIT_REASON_CLASS');
  if (!record.correlation.requestId || !record.correlation.traceId) throw new Error('INVALID_AUDIT_CORRELATION');
  if (!Number.isInteger(record.version ?? 0) || (record.version ?? 0) < 0) throw new Error('INVALID_AUDIT_VERSION');
  if (!Number.isFinite(Date.parse(record.occurredAt))) throw new Error('INVALID_AUDIT_TIMESTAMP');
  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) throw new Error('INVALID_AUDIT_METADATA');
  for (const [key, value] of Object.entries(record.metadata)) { if (isForbiddenKey(key)) throw new Error('SENSITIVE_AUDIT_DATA'); if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new Error('INVALID_AUDIT_METADATA'); }
}
export class InMemoryAuditRepository implements AuditRepository, TransactionalAuditRepository {
  private readonly records: AuditRecord[] = [];
  async append(record: AuditRecord): Promise<void> { validateAuditRecord(record); if (this.records.some((existing) => existing.auditId === record.auditId)) throw new Error('AUDIT_DUPLICATE'); this.records.push(structuredClone(record)); }
  async appendInTransaction(_tx: SqlClient, record: AuditRecord): Promise<void> { await this.append(record); }
  async query(query: AuditQuery): Promise<AuditQueryResult> {
    if (!query.tenantId) throw new Error('INVALID_AUDIT_QUERY_TENANT');
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_LIMIT) throw new Error('INVALID_AUDIT_QUERY_LIMIT');
    const fromMs = Date.parse(query.from); const toMs = Date.parse(query.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > MAX_WINDOW_MS) throw new Error('INVALID_AUDIT_QUERY_WINDOW');
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const filtered = this.records
      .filter((r) => r.tenantId === query.tenantId && r.occurredAt >= query.from && r.occurredAt < query.to)
      .filter((r) => !query.resourceType || r.resourceType === query.resourceType)
      .filter((r) => !query.resourceId || r.resourceId === query.resourceId)
      .filter((r) => !query.actorId || r.actorId === query.actorId)
      .filter((r) => !query.action || r.action === query.action)
      .filter((r) => !query.outcome || r.outcome === query.outcome)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.auditId.localeCompare(b.auditId))
      .filter((r) => !cursor || r.occurredAt > cursor.occurredAt || (r.occurredAt === cursor.occurredAt && r.auditId > cursor.auditId));
    const page = filtered.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const items = hasMore ? page.slice(0, query.limit) : page;
    return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : undefined };
  }
}

function encodeCursor(record: AuditRecord): string { return Buffer.from(JSON.stringify({ occurredAt: record.occurredAt, auditId: record.auditId })).toString('base64url'); }
function decodeCursor(cursor: string): { occurredAt: string; auditId: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof value.occurredAt !== 'string' || typeof value.auditId !== 'string' || !value.auditId || !Number.isFinite(Date.parse(value.occurredAt))) throw new Error('INVALID_AUDIT_CURSOR');
    return { occurredAt: value.occurredAt, auditId: value.auditId };
  } catch { throw new Error('INVALID_AUDIT_CURSOR'); }
}
