import type { InvestmentDecision } from './investment-decision';
import type { InvestmentOpportunity } from './opportunity';
import type { InvestmentDecisionRepository, InvestmentOpportunityRepository } from './repositories';

interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{
    rows: T[];
    rowCount: number;
  }>;
}

function toOpportunity(row: Record<string, unknown>): InvestmentOpportunity {
  return {
    opportunityId: String(row.opportunity_id),
    tenantId: String(row.tenant_id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    stage: row.stage as InvestmentOpportunity['stage'],
    status: row.status as InvestmentOpportunity['status'],
    ownerId: String(row.owner_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    version: Number(row.version),
  };
}

function toDecision(row: Record<string, unknown>): InvestmentDecision {
  return {
    decisionId: String(row.decision_id),
    opportunityId: String(row.opportunity_id),
    tenantId: String(row.tenant_id),
    decisionCycle: Number(row.decision_cycle),
    recommendation: row.recommendation as InvestmentDecision['recommendation'],
    rationale: String(row.rationale),
    createdAt: new Date(String(row.created_at)).toISOString(),
    idempotencyKey: String(row.idempotency_key),
  };
}

export class OptimisticConcurrencyError extends Error {
  constructor(opportunityId: string, expectedVersion: number) {
    super(`Investment opportunity version conflict: ${opportunityId} expected version ${expectedVersion}`);
    this.name = 'OptimisticConcurrencyError';
  }
}

export class PostgresInvestmentOpportunityRepository implements InvestmentOpportunityRepository {
  constructor(private readonly db: SqlClient) {}

  async get(tenantId: string, opportunityId: string): Promise<InvestmentOpportunity | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT opportunity_id, tenant_id, company_id, company_name, stage, status,
              owner_id, created_at, updated_at, version
       FROM investment_opportunities
       WHERE tenant_id=$1 AND opportunity_id=$2`,
      [tenantId, opportunityId],
    );
    return result.rows[0] ? toOpportunity(result.rows[0]) : null;
  }

  async create(opportunity: InvestmentOpportunity): Promise<InvestmentOpportunity> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO investment_opportunities
         (opportunity_id, tenant_id, company_id, company_name, stage, status,
          owner_id, created_at, updated_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING opportunity_id, tenant_id, company_id, company_name, stage, status,
                 owner_id, created_at, updated_at, version`,
      [
        opportunity.opportunityId,
        opportunity.tenantId,
        opportunity.companyId,
        opportunity.companyName,
        opportunity.stage,
        opportunity.status,
        opportunity.ownerId,
        opportunity.createdAt,
        opportunity.updatedAt,
        opportunity.version,
      ],
    );
    if (!result.rows[0]) throw new Error(`Investment opportunity persistence returned no row for ${opportunity.opportunityId}`);
    return toOpportunity(result.rows[0]);
  }

  async save(opportunity: InvestmentOpportunity, expectedVersion: number): Promise<void> {
    const result = await this.db.query(
      `UPDATE investment_opportunities
       SET company_id=$3, company_name=$4, stage=$5, status=$6, owner_id=$7,
           created_at=$8, updated_at=$9, version=$11
       WHERE tenant_id=$1 AND opportunity_id=$2 AND version=$10`,
      [
        opportunity.tenantId,
        opportunity.opportunityId,
        opportunity.companyId,
        opportunity.companyName,
        opportunity.stage,
        opportunity.status,
        opportunity.ownerId,
        opportunity.createdAt,
        opportunity.updatedAt,
        expectedVersion,
        opportunity.version,
      ],
    );
    if (result.rowCount !== 1) {
      throw new OptimisticConcurrencyError(opportunity.opportunityId, expectedVersion);
    }
  }
}

export class PostgresInvestmentDecisionRepository implements InvestmentDecisionRepository {
  constructor(private readonly db: SqlClient) {}

  async getByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<InvestmentDecision | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT decision_id, opportunity_id, tenant_id, decision_cycle,
              recommendation, rationale, created_at, idempotency_key
       FROM investment_decisions
       WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, idempotencyKey],
    );
    return result.rows[0] ? toDecision(result.rows[0]) : null;
  }

  async create(decision: InvestmentDecision, idempotencyKey: string): Promise<InvestmentDecision> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO investment_decisions
         (decision_id, opportunity_id, tenant_id, decision_cycle, recommendation,
          rationale, created_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING decision_id, opportunity_id, tenant_id, decision_cycle,
                 recommendation, rationale, created_at, idempotency_key`,
      [
        decision.decisionId,
        decision.opportunityId,
        decision.tenantId,
        decision.decisionCycle,
        decision.recommendation,
        decision.rationale,
        decision.createdAt,
        idempotencyKey,
      ],
    );
    if (!result.rows[0]) {
      throw new Error(`Investment decision persistence returned no row for ${decision.decisionId}`);
    }
    return toDecision(result.rows[0]);
  }
}
