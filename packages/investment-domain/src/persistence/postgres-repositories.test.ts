import { describe, expect, it } from 'vitest';
import type { InvestmentDecisionRepository, InvestmentOpportunityRepository } from './repositories';
import { OptimisticConcurrencyError, PostgresInvestmentDecisionRepository, PostgresInvestmentOpportunityRepository } from './postgres-repositories';
import type { InvestmentDecision } from './investment-decision';
import type { InvestmentOpportunity } from './opportunity';

const opportunity: InvestmentOpportunity = {
  opportunityId: 'opp-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  companyName: 'Acme',
  stage: 'SCREENING',
  status: 'ACTIVE',
  ownerId: 'owner-1',
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  version: 2,
};

const decision: InvestmentDecision = {
  decisionId: 'decision-1',
  opportunityId: 'opp-1',
  tenantId: 'tenant-1',
  decisionCycle: 1,
  recommendation: 'APPROVE',
  rationale: 'Strong fundamentals',
  createdAt: '2026-09-12T00:00:00.000Z',
  idempotencyKey: 'investment-decision:opp-1:1',
};

function sqlClient(responses: Array<{ rows: Record<string, unknown>[]; rowCount: number }>) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return {
    calls,
    query: async <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      return (responses.shift() ?? { rows: [], rowCount: 0 }) as { rows: T[]; rowCount: number };
    },
  };
}

describe('investment PostgreSQL persistence contract', () => {
  it('loads an opportunity from PostgreSQL', async () => {
    const db = sqlClient([{ rows: [{
      opportunity_id: opportunity.opportunityId,
      tenant_id: opportunity.tenantId,
      company_id: opportunity.companyId,
      company_name: opportunity.companyName,
      stage: opportunity.stage,
      status: opportunity.status,
      owner_id: opportunity.ownerId,
      created_at: opportunity.createdAt,
      updated_at: opportunity.updatedAt,
      version: opportunity.version,
    }], rowCount: 1 }]);
    const repository: InvestmentOpportunityRepository = new PostgresInvestmentOpportunityRepository(db);

    await expect(repository.get('tenant-1', 'opp-1')).resolves.toEqual(opportunity);
    expect(db.calls[0]?.sql).toContain('investment_opportunities');
  });

  it('persists a newly created opportunity and returns it', async () => {
    const db = sqlClient([{ rows: [{
      opportunity_id: opportunity.opportunityId,
      tenant_id: opportunity.tenantId,
      company_id: opportunity.companyId,
      company_name: opportunity.companyName,
      stage: opportunity.stage,
      status: opportunity.status,
      owner_id: opportunity.ownerId,
      created_at: opportunity.createdAt,
      updated_at: opportunity.updatedAt,
      version: opportunity.version,
    }], rowCount: 1 }]);
    const repository: InvestmentOpportunityRepository = new PostgresInvestmentOpportunityRepository(db);

    await expect(repository.create(opportunity)).resolves.toEqual(opportunity);
    expect(db.calls[0]?.sql).toContain('INSERT INTO investment_opportunities');
    expect(db.calls[0]?.sql).toContain('RETURNING');
    expect(db.calls[0]?.params).toEqual([
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
    ]);
  });

  it('uses optimistic version matching when saving an opportunity', async () => {
    const db = sqlClient([{ rows: [], rowCount: 1 }]);
    const repository: InvestmentOpportunityRepository = new PostgresInvestmentOpportunityRepository(db);

    await repository.save(opportunity, 1);

    expect(db.calls[0]?.sql).toContain('WHERE tenant_id=$1 AND opportunity_id=$2 AND version=$10');
    expect(db.calls[0]?.params).toEqual([
      opportunity.tenantId,
      opportunity.opportunityId,
      opportunity.companyId,
      opportunity.companyName,
      opportunity.stage,
      opportunity.status,
      opportunity.ownerId,
      opportunity.createdAt,
      opportunity.updatedAt,
      1,
      opportunity.version,
    ]);
  });

  it('rejects an optimistic version conflict', async () => {
    const db = sqlClient([{ rows: [], rowCount: 0 }]);
    const repository = new PostgresInvestmentOpportunityRepository(db);

    await expect(repository.save(opportunity, 1)).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it('reads a decision by tenant-scoped idempotency key', async () => {
    const db = sqlClient([{ rows: [{
      decision_id: decision.decisionId,
      opportunity_id: decision.opportunityId,
      tenant_id: decision.tenantId,
      decision_cycle: decision.decisionCycle,
      recommendation: decision.recommendation,
      rationale: decision.rationale,
      created_at: decision.createdAt,
      idempotency_key: decision.idempotencyKey,
    }], rowCount: 1 }]);
    const repository: InvestmentDecisionRepository = new PostgresInvestmentDecisionRepository(db);

    await expect(repository.getByIdempotencyKey('tenant-1', decision.idempotencyKey)).resolves.toEqual(decision);
  });

  it('returns the persisted decision from an idempotent insert', async () => {
    const db = sqlClient([{ rows: [{
      decision_id: decision.decisionId,
      opportunity_id: decision.opportunityId,
      tenant_id: decision.tenantId,
      decision_cycle: decision.decisionCycle,
      recommendation: decision.recommendation,
      rationale: decision.rationale,
      created_at: decision.createdAt,
      idempotency_key: decision.idempotencyKey,
    }], rowCount: 1 }]);
    const repository: InvestmentDecisionRepository = new PostgresInvestmentDecisionRepository(db);

    await expect(repository.create(decision, decision.idempotencyKey)).resolves.toEqual(decision);
    expect(db.calls[0]?.sql).toContain('ON CONFLICT');
    expect(db.calls[0]?.sql).toContain('RETURNING');
  });
});
