import type { InvestmentCase } from '../domain/investment-case';
export interface InvestmentCaseQueryService {
  getCase(tenantId: string, caseId: string): Promise<InvestmentCase | null>;
  getCaseByOpportunity(tenantId: string, opportunityId: string): Promise<InvestmentCase | null>;
}
