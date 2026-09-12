export type InvestmentRecommendation = 'APPROVE' | 'REJECT';

export interface CreateInvestmentDecisionInput {
  decisionId: string;
  opportunityId: string;
  tenantId: string;
  decisionCycle: number;
  recommendation: InvestmentRecommendation;
  rationale: string;
  createdAt: string;
}

export interface InvestmentDecision {
  decisionId: string;
  opportunityId: string;
  tenantId: string;
  decisionCycle: number;
  recommendation: InvestmentRecommendation;
  rationale: string;
  createdAt: string;
  idempotencyKey: string;
}

export function decisionIdempotencyKey(opportunityId: string, decisionCycle: number): string {
  if (!opportunityId) throw new Error('opportunityId is required');
  if (!Number.isInteger(decisionCycle) || decisionCycle < 1) {
    throw new Error('decision cycle must be a positive integer');
  }
  return `investment-decision:${opportunityId}:${decisionCycle}`;
}

export function createInvestmentDecision(input: CreateInvestmentDecisionInput): InvestmentDecision {
  if (!input.decisionId) throw new Error('decisionId is required');
  if (!input.opportunityId) throw new Error('opportunityId is required');
  if (!input.tenantId) throw new Error('tenantId is required');
  if (input.recommendation !== 'APPROVE' && input.recommendation !== 'REJECT') {
    throw new Error('recommendation must be APPROVE or REJECT');
  }
  if (!input.rationale) throw new Error('rationale is required');

  return {
    ...input,
    idempotencyKey: decisionIdempotencyKey(input.opportunityId, input.decisionCycle),
  };
}
