import type { InvestmentApplicationService } from './application-service';
import type { InvestmentRecommendation } from './investment-decision';
import { requireToolPermission, type ToolAuthorization } from './policies';

export interface CompanySnapshot { companyId: string; companyName: string }
export interface FinancialSnapshot { companyId: string; revenue: number; ebitda: number; currency: string }
export interface DueDiligenceReport { companyId: string; status: 'PASS' | 'FAIL'; findings: string[] }
export interface InvestmentAnalysis { companyId: string; recommendation: InvestmentRecommendation; rationale: string }
export interface IcRecommendation { companyId: string; recommendation: InvestmentRecommendation; rationale: string }

export interface InvestmentTools {
  companyLookup(input: { companyId: string }): Promise<CompanySnapshot>;
  companyFinancials(input: { companyId: string }): Promise<FinancialSnapshot>;
  dueDiligenceRun(input: { companyId: string }): Promise<DueDiligenceReport>;
  investmentAnalysisGenerate(input: { companyId: string }): Promise<InvestmentAnalysis>;
  icRecommend(input: { companyId: string }): Promise<IcRecommendation>;
  advanceOpportunityStage(input: { tenantId: string; opportunityId: string; actorId: string; nextStage: Parameters<InvestmentApplicationService['advanceStage']>[0]['nextStage']; idempotencyKey: string }): ReturnType<InvestmentApplicationService['advanceStage']>;
  createInvestmentDecision(input: { tenantId: string; opportunityId: string; actorId: string; decisionCycle: number; recommendation: InvestmentRecommendation; rationale: string; idempotencyKey: string }): ReturnType<InvestmentApplicationService['approve']>;
}

export function createInvestmentTools(
  applicationService?: InvestmentApplicationService,
  authorization?: ToolAuthorization,
): InvestmentTools {
  return {
    async companyLookup({ companyId }) {
      return { companyId, companyName: 'Acme' };
    },
    async companyFinancials({ companyId }) {
      return { companyId, revenue: 100, ebitda: 20, currency: 'USD' };
    },
    async dueDiligenceRun({ companyId }) {
      return { companyId, status: 'PASS', findings: ['No blocking findings'] };
    },
    async investmentAnalysisGenerate({ companyId }) {
      return { companyId, recommendation: 'APPROVE', rationale: 'Deterministic analysis fixture' };
    },
    async icRecommend({ companyId }) {
      return { companyId, recommendation: 'APPROVE', rationale: 'Deterministic IC fixture' };
    },
    async advanceOpportunityStage(input) {
      await requireToolPermission('opportunity.advance_stage', input, authorization);
      if (!applicationService) throw new Error('Investment application service is required');
      return applicationService.advanceStage(input);
    },
    async createInvestmentDecision(input) {
      await requireToolPermission('investment_decision.create', input, authorization);
      if (!applicationService) throw new Error('Investment application service is required');
      return input.recommendation === 'APPROVE'
        ? applicationService.approve(input)
        : applicationService.reject(input);
    },
  };
}
