export interface InvestmentCaseWorkflowPort {
  startResearch(tenantId: string, caseId: string, taskId: string, idempotencyKey: string): Promise<{ runId: string }>;
  startAnalysis(tenantId: string, caseId: string, taskId: string, idempotencyKey: string): Promise<{ runId: string }>;
  resume(tenantId: string, caseId: string, taskId: string, runId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{ runId: string }>;
}
