import type { InvestmentRecommendation } from './investment-decision';
import type { OpportunityStage } from './opportunity';

export interface CreateOpportunityCommand {
  tenantId: string;
  opportunityId: string;
  companyId: string;
  companyName: string;
  ownerId: string;
  idempotencyKey: string;
}

export interface AdvanceOpportunityStageCommand {
  tenantId: string;
  opportunityId: string;
  nextStage: OpportunityStage;
  idempotencyKey: string;
}

export interface RequestIcApprovalCommand {
  tenantId: string;
  opportunityId: string;
  idempotencyKey: string;
}

export interface InvestmentDecisionCommand {
  tenantId: string;
  opportunityId: string;
  decisionCycle: number;
  recommendation: InvestmentRecommendation;
  rationale: string;
  idempotencyKey: string;
}

export type ApproveInvestmentCommand = InvestmentDecisionCommand & { recommendation: 'APPROVE' };
export type RejectInvestmentCommand = InvestmentDecisionCommand & { recommendation: 'REJECT' };
