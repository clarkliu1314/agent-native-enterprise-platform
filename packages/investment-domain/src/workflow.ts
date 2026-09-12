import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowStartResult {
  runId: string;
  opportunityId: string;
}

const WORKFLOW_STEPS = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;

export class InvestmentWorkflow {
  constructor(private readonly runtime: InvestmentWorkflowRuntime) {}

  async start(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<InvestmentWorkflowStartResult> {
    const run = await this.runtime.startRun(input);
    for (const step of WORKFLOW_STEPS) {
      await this.runtime.executeTurn({ runId: run.runId, input: { opportunityId: input.opportunityId, step } });
    }
    return { runId: run.runId, opportunityId: input.opportunityId };
  }

  async resume(input: { runId: string; approval: 'APPROVE' | 'REJECT' }): Promise<void> {
    await this.runtime.resumeRun({ runId: input.runId, input: { step: 'approval', approval: input.approval } });
  }
}
