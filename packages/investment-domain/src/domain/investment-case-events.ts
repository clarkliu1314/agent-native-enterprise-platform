import type { InvestmentCaseStatus } from './investment-case';

export type InvestmentCaseEventType =
  | 'InvestmentCaseCreated'
  | 'InvestmentCaseStatusChanged'
  | 'InvestmentCaseDecisionAttached';

export interface InvestmentCaseEvent {
  id: string;
  tenantId: string;
  caseId: string;
  aggregateVersion: number;
  eventType: InvestmentCaseEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface InvestmentCaseStatusChangedPayload {
  previousStatus: InvestmentCaseStatus;
  status: InvestmentCaseStatus;
}
