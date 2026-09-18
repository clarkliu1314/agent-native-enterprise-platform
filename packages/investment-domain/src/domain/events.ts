import type { InvestmentRecommendation } from './investment-decision';
import type { OpportunityStage } from './opportunity';

export interface InvestmentEventContext {
  eventId: string;
  tenantId: string;
  opportunityId: string;
  actorId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface OpportunityCreatedEvent extends InvestmentEventContext {
  type: 'OpportunityCreated';
  companyId: string;
}

export interface OpportunityStageAdvancedEvent extends InvestmentEventContext {
  type: 'OpportunityStageAdvanced';
  from: OpportunityStage;
  to: OpportunityStage;
}

export interface IcApprovalRequestedEvent extends InvestmentEventContext {
  type: 'IcApprovalRequested';
}

export interface InvestmentDecisionCreatedEvent extends InvestmentEventContext {
  type: 'InvestmentDecisionCreated';
  decisionId: string;
  decisionCycle: number;
  recommendation: InvestmentRecommendation;
}

export interface InvestmentApprovedEvent extends InvestmentEventContext {
  type: 'InvestmentApproved';
  decisionId: string;
}

export interface InvestmentRejectedEvent extends InvestmentEventContext {
  type: 'InvestmentRejected';
  decisionId: string;
}

export type InvestmentDomainEvent =
  | OpportunityCreatedEvent
  | OpportunityStageAdvancedEvent
  | IcApprovalRequestedEvent
  | InvestmentDecisionCreatedEvent
  | InvestmentApprovedEvent
  | InvestmentRejectedEvent;
