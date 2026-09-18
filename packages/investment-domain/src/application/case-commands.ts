export interface CreateInvestmentCaseCommand {
  tenantId: string; caseId: string; opportunityId: string; name: string; description: string;
  actorId: string; idempotencyKey: string; now?: string;
}
export interface StartResearchCommand {
  tenantId: string; caseId: string; taskId: string; expectedVersion: number;
  actorId: string; idempotencyKey: string; now?: string;
}
export interface CompleteResearchCommand {
  tenantId: string; caseId: string; taskId: string; expectedVersion: number;
  actorId: string; idempotencyKey: string; now?: string;
}
export interface StartAnalysisCommand {
  tenantId: string; caseId: string; taskId: string; expectedVersion: number;
  actorId: string; idempotencyKey: string; now?: string;
}
export interface CompleteAnalysisCommand {
  tenantId: string; caseId: string; taskId: string; expectedVersion: number;
  actorId: string; idempotencyKey: string; now?: string;
}
export interface PutCaseOnHoldCommand {
  tenantId: string; caseId: string; expectedVersion: number; actorId: string; idempotencyKey: string; now?: string;
}
export interface ResumeCaseCommand {
  tenantId: string; caseId: string; expectedVersion: number; actorId: string; idempotencyKey: string; now?: string;
}
export interface AttachInvestmentDecisionCommand {
  tenantId: string; caseId: string; decisionId: string; expectedVersion: number; actorId: string; idempotencyKey: string; now?: string;
}
