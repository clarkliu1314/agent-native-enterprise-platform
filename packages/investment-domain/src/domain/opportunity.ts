export type OpportunityStage =
  | 'DRAFT'
  | 'SCREENING'
  | 'DUE_DILIGENCE'
  | 'IC_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type OpportunityStatus = 'ACTIVE' | 'CLOSED';

export interface InvestmentOpportunity {
  opportunityId: string;
  tenantId: string;
  companyId: string;
  companyName: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class InvalidOpportunityStageTransitionError extends Error {
  constructor(from: OpportunityStage, to: OpportunityStage) {
    super(`Invalid opportunity stage transition: ${from} -> ${to}`);
    this.name = 'InvalidOpportunityStageTransitionError';
  }
}

const VALID_STAGE_TRANSITIONS: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  DRAFT: ['SCREENING'],
  SCREENING: ['DUE_DILIGENCE'],
  DUE_DILIGENCE: ['IC_REVIEW'],
  IC_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export function advanceOpportunityStage(
  opportunity: InvestmentOpportunity,
  nextStage: OpportunityStage,
): InvestmentOpportunity {
  if (!VALID_STAGE_TRANSITIONS[opportunity.stage].includes(nextStage)) {
    throw new InvalidOpportunityStageTransitionError(opportunity.stage, nextStage);
  }

  return {
    ...opportunity,
    stage: nextStage,
    status: nextStage === 'APPROVED' || nextStage === 'REJECTED' ? 'CLOSED' : opportunity.status,
    updatedAt: new Date().toISOString(),
    version: opportunity.version + 1,
  };
}
