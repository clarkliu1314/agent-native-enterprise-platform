import type { InvestmentRecommendation } from '../domain/investment-decision';
import type { OpportunityStage } from '../domain/opportunity';

export interface CreateOpportunityCommand {
  tenantId: string;
  opportunityId: string;
  companyId: string;
  companyName: string;
  ownerId: string;
  actorId: string;
  idempotencyKey: string;
  now?: string;
}

export interface AdvanceOpportunityStageCommand {
  tenantId: string;
  opportunityId: string;
  nextStage: OpportunityStage;
  expectedVersion: number;
  actorId: string;
  idempotencyKey: string;
  now?: string;
}

export interface RequestIcApprovalCommand {
  tenantId: string;
  opportunityId: string;
  actorId: string;
  idempotencyKey: string;
  now?: string;
}

export interface InvestmentDecisionCommand {
  tenantId: string;
  opportunityId: string;
  decisionCycle: number;
  recommendation: InvestmentRecommendation;
  rationale: string;
  actorId: string;
  idempotencyKey: string;
  now?: string;
}

export type ApproveInvestmentCommand = InvestmentDecisionCommand & { recommendation: 'APPROVE' };
export type RejectInvestmentCommand = InvestmentDecisionCommand & { recommendation: 'REJECT' };
