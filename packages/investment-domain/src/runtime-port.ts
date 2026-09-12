export interface InvestmentWorkflowRuntime {
  startRun(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<{
    runId: string;
    nextStep?: number;
  }>;
  executeTurn(input: { runId: string; input: unknown }): Promise<{ status: 'CONTINUE' | 'WAITING' | 'COMPLETED' }>;
  resumeRun(input: { runId: string; input: unknown }): Promise<void>;
}
