import type { AuditQuery, AuditQueryResult, AuditRecord, AuditRepository } from './auditability';
import { validateAuditRecord } from './auditability';
import type { SqlClient, TransactionClient, TransactionRunner } from './ports';

const MAX_LIMIT = 100;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

type Db = SqlClient & TransactionRunner;

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: Db) {}

  async append(record: AuditRecord): Promise<void> {
    validateAuditRecord(record);
    await this.db.transaction(async (tx) => {
      await insertAuditRecord(tx, record);
    });
  }

  async query(query: AuditQuery): Promise<AuditQueryResult> {
    validateQuery(query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const params: unknown[] = [query.tenantId, query.from, query.to];
    const predicates = [
      'tenant_id=$1',
      'occurred_at >= $2::timestamptz',
      'occurred_at < $3::timestamptz',
    ];

    if (cursor) {
      params.push(cursor.occurredAt, cursor.auditId);
      predicates.push(`(occurred_at,audit_id) > ($${params.length - 1}::timestamptz,$${params.length})`);
    }
    addFilter(predicates, params, 'resource_type', query.resourceType);
    addFilter(predicates, params, 'resource_id', query.resourceId);
    addFilter(predicates, params, 'actor_id', query.actorId);
    addFilter(predicates, params, 'action', query.action);
    addFilter(predicates, params, 'outcome', query.outcome);

    params.push(query.limit + 1);
    const result = await this.db.query<AuditRow>(
      `SELECT audit_id,tenant_id,occurred_at,actor_id,actor_type,action,resource_type,resource_id,outcome,reason_class,request_id,trace_id,run_id,workflow_id,agent_id,version,metadata
       FROM audit_records
       WHERE ${predicates.join(' AND ')}
       ORDER BY occurred_at ASC, audit_id ASC
       LIMIT $${params.length}`,
      params,
    );

    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const items = rows.map(toAuditRecord);
    return {
      items,
      nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : undefined,
    };
  }
}

export async function insertAuditRecord(tx: TransactionClient, record: AuditRecord): Promise<void> {
  validateAuditRecord(record);
  const result = await tx.query(
    `INSERT INTO audit_records
      (audit_id,tenant_id,occurred_at,actor_id,actor_type,action,resource_type,resource_id,outcome,reason_class,request_id,trace_id,run_id,workflow_id,agent_id,version,metadata)
     VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      record.auditId,
      record.tenantId,
      record.occurredAt,
      record.actorId,
      record.actorType,
      record.action,
      record.resourceType,
      record.resourceId,
      record.outcome,
      record.reasonClass,
      record.correlation.requestId,
      record.correlation.traceId,
      record.correlation.runId ?? null,
      record.correlation.workflowId ?? null,
      record.correlation.agentId ?? null,
      record.version ?? null,
      JSON.stringify(record.metadata),
    ],
  );
  if (result.rowCount !== 1) throw new Error('AUDIT_INSERT_FAILED');
}

interface AuditRow {
  audit_id: string;
  tenant_id: string;
  occurred_at: string;
  actor_id: string;
  actor_type: AuditRecord['actorType'];
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: AuditRecord['outcome'];
  reason_class: AuditRecord['reasonClass'];
  request_id: string;
  trace_id: string;
  run_id: string | null;
  workflow_id: string | null;
  agent_id: string | null;
  version: number | null;
  metadata: Record<string, string | number | boolean | null>;
}

function toAuditRecord(row: AuditRow): AuditRecord {
  return {
    auditId: row.audit_id,
    tenantId: row.tenant_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    reasonClass: row.reason_class,
    correlation: {
      requestId: row.request_id,
      traceId: row.trace_id,
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
    },
    ...(row.version !== null ? { version: row.version } : {}),
    metadata: row.metadata ?? {},
  };
}

function validateQuery(query: AuditQuery): void {
  if (!query.tenantId) throw new Error('INVALID_AUDIT_QUERY_TENANT');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_LIMIT) {
    throw new Error('INVALID_AUDIT_QUERY_LIMIT');
  }
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_WINDOW_MS) {
    throw new Error('INVALID_AUDIT_QUERY_WINDOW');
  }
  if (query.cursor) decodeCursor(query.cursor);
}

function addFilter(predicates: string[], params: unknown[], column: string, value?: string): void {
  if (value === undefined) return;
  params.push(value);
  predicates.push(`${column}=$${params.length}`);
}

function encodeCursor(record: AuditRecord): string {
  return Buffer.from(JSON.stringify({ occurredAt: record.occurredAt, auditId: record.auditId })).toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: string; auditId: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof value.occurredAt !== 'string' || typeof value.auditId !== 'string' || !value.auditId) {
      throw new Error('INVALID_AUDIT_CURSOR');
    }
    if (!Number.isFinite(Date.parse(value.occurredAt))) throw new Error('INVALID_AUDIT_CURSOR');
    return { occurredAt: value.occurredAt, auditId: value.auditId };
  } catch {
    throw new Error('INVALID_AUDIT_CURSOR');
  }
}
