import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowStartResult {
  runId: string;
  status: 'STARTED';
}

export class InvestmentWorkflow {
  constructor(private readonly runtime: InvestmentWorkflowRuntime) {}

  async start(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<InvestmentWorkflowStartResult> {
    const run = await this.runtime.startRun(input);
    await this.runtime.executeTurn({ runId: run.runId, input: { opportunityId: input.opportunityId, step: 'research' } });
    return { runId: run.runId, status: 'STARTED' };
  }

  async resume(input: { runId: string; approval: 'APPROVE' | 'REJECT' }): Promise<{ status: 'CONTINUE' | 'WAITING' | 'COMPLETED' }> {
    return this.runtime.resumeRun({ runId: input.runId, input: { step: 'approval', approval: input.approval } });
  }
}
