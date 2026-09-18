import type { InvestmentCase } from '../domain/investment-case';
export interface InvestmentCaseRepository {
  getById(tenantId: string, caseId: string): Promise<InvestmentCase | null>;
  getByOpportunityId(tenantId: string, opportunityId: string): Promise<InvestmentCase | null>;
  create(investmentCase: InvestmentCase): Promise<InvestmentCase>;
  save(investmentCase: InvestmentCase, expectedVersion: number): Promise<InvestmentCase>;
}
export type InvestmentCaseTaskStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type InvestmentCaseTaskType = 'RESEARCH' | 'ANALYSIS';
export interface InvestmentCaseTask {
  id: string; tenantId: string; caseId: string; taskType: InvestmentCaseTaskType;
  status: InvestmentCaseTaskStatus; runId: string | null; idempotencyKey: string;
  input: Record<string, unknown>; output: Record<string, unknown> | null;
  createdAt: string; updatedAt: string;
}
export interface InvestmentCaseTaskRepository {
  getById(tenantId: string, taskId: string): Promise<InvestmentCaseTask | null>;
  create(task: InvestmentCaseTask): Promise<InvestmentCaseTask>;
  save(task: InvestmentCaseTask): Promise<InvestmentCaseTask>;
}
