export type InvestmentCaseStatus =
  | 'DRAFT'
  | 'RESEARCHING'
  | 'ANALYZING'
  | 'DECISION_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'ON_HOLD';

export interface CreateInvestmentCaseInput {
  id: string;
  tenantId: string;
  opportunityId: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface InvestmentCase {
  id: string;
  tenantId: string;
  opportunityId: string;
  name: string;
  description: string;
  status: InvestmentCaseStatus;
  previousStatus: InvestmentCaseStatus | null;
  decisionId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class InvalidInvestmentCaseTransitionError extends Error {
  constructor(from: InvestmentCaseStatus, to: InvestmentCaseStatus) {
    super(`Invalid investment case transition: ${from} -> ${to}`);
    this.name = 'InvalidInvestmentCaseTransitionError';
  }
}

const VALID_TRANSITIONS: Readonly<Record<InvestmentCaseStatus, readonly InvestmentCaseStatus[]>> = {
  DRAFT: ['RESEARCHING'],
  RESEARCHING: ['ANALYZING'],
  ANALYZING: ['DECISION_PENDING'],
  DECISION_PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
  ON_HOLD: [],
};

function assertIdentity(input: { id?: string; tenantId?: string; opportunityId?: string }): void {
  if (!input.id) throw new Error('id is required');
  if (!input.tenantId) throw new Error('tenantId is required');
  if (!input.opportunityId) throw new Error('opportunityId is required');
}

export function createInvestmentCase(input: CreateInvestmentCaseInput): InvestmentCase {
  assertIdentity(input);
  if (!input.name) throw new Error('name is required');
  if (!input.createdAt) throw new Error('createdAt is required');

  return {
    ...input,
    status: 'DRAFT',
    previousStatus: null,
    decisionId: null,
    updatedAt: input.createdAt,
    version: 1,
  };
}

export function transitionInvestmentCase(
  investmentCase: InvestmentCase,
  nextStatus: InvestmentCaseStatus,
  updatedAt: string,
): InvestmentCase {
  if (!VALID_TRANSITIONS[investmentCase.status].includes(nextStatus)) {
    throw new InvalidInvestmentCaseTransitionError(investmentCase.status, nextStatus);
  }

  return {
    ...investmentCase,
    status: nextStatus,
    previousStatus: investmentCase.status,
    updatedAt,
    version: investmentCase.version + 1,
  };
}

export function putInvestmentCaseOnHold(
  investmentCase: InvestmentCase,
  updatedAt: string,
): InvestmentCase {
  if (investmentCase.status === 'APPROVED' || investmentCase.status === 'REJECTED' || investmentCase.status === 'ON_HOLD') {
    throw new InvalidInvestmentCaseTransitionError(investmentCase.status, 'ON_HOLD');
  }

  return {
    ...investmentCase,
    status: 'ON_HOLD',
    previousStatus: investmentCase.status,
    updatedAt,
    version: investmentCase.version + 1,
  };
}

export function resumeInvestmentCase(
  investmentCase: InvestmentCase,
  updatedAt: string,
): InvestmentCase {
  if (investmentCase.status !== 'ON_HOLD' || investmentCase.previousStatus === null || investmentCase.previousStatus === 'ON_HOLD') {
    throw new InvalidInvestmentCaseTransitionError(investmentCase.status, investmentCase.previousStatus ?? 'DRAFT');
  }

  return {
    ...investmentCase,
    status: investmentCase.previousStatus,
    previousStatus: 'ON_HOLD',
    updatedAt,
    version: investmentCase.version + 1,
  };
}
