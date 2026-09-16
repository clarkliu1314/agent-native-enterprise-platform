import type { InvestmentDecision } from '../domain/investment-decision';
import type { InvestmentOpportunity } from '../domain/opportunity';

export interface InvestmentOpportunityRepository {
  get(tenantId: string, opportunityId: string): Promise<InvestmentOpportunity | null>;
  create(opportunity: InvestmentOpportunity): Promise<InvestmentOpportunity>;
  save(opportunity: InvestmentOpportunity, expectedVersion: number): Promise<void>;
}

export interface InvestmentDecisionRepository {
  getByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<InvestmentDecision | null>;
  create(decision: InvestmentDecision, idempotencyKey: string): Promise<InvestmentDecision>;
}
