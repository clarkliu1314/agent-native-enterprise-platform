import type { AuditQuery, AuditQueryResult, AuditRepository, AuditOutcome } from './auditability';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_LIMIT = 100;

export interface AuditQueryAuthorization {
  authorize(actorId: string, tenantId: string): Promise<boolean> | boolean;
}

export interface AuditQueryRequest {
  actorId: string;
  tenantId: string;
  from: string;
  to: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  outcome?: AuditOutcome;
  limit: number;
  cursor?: string;
}

export class AuditQueryService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly authorization: AuditQueryAuthorization,
  ) {}

  async query(request: AuditQueryRequest): Promise<AuditQueryResult> {
    if (!request.actorId || !request.tenantId) throw new Error('AUTHORIZATION_DENIED');
    if (!(await this.authorization.authorize(request.actorId, request.tenantId))) throw new Error('AUTHORIZATION_DENIED');

    const fromMs = Date.parse(request.from);
    const toMs = Date.parse(request.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > MAX_WINDOW_MS) {
      throw new Error('INVALID_AUDIT_QUERY_WINDOW');
    }
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_LIMIT) {
      throw new Error('INVALID_AUDIT_QUERY_LIMIT');
    }

    const query: AuditQuery = {
      tenantId: request.tenantId,
      from: request.from,
      to: request.to,
      ...(request.resourceType ? { resourceType: request.resourceType } : {}),
      ...(request.resourceId ? { resourceId: request.resourceId } : {}),
      ...(request.action ? { action: request.action } : {}),
      ...(request.outcome ? { outcome: request.outcome } : {}),
      limit: request.limit,
      ...(request.cursor ? { cursor: request.cursor } : {}),
    };
    return this.repository.query(query);
  }
}
