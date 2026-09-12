import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowStartResult {
  runId: string;
  opportunityId: string;
}

export class InvestmentWorkflow {
  constructor(private readonly runtime: InvestmentWorkflowRuntime) {}

  async start(input: {
    tenantId: string;
    opportunityId: string;
    idempotencyKey: string;
  }): Promise<InvestmentWorkflowStartResult> {
    const result = await this.runtime.createRun(input);

    // Admission is intentionally bounded: this method must never claim a run
    // or execute a workflow step. DurableWorker owns execution and receives the
    // authoritative fencing token from the durable runtime claim.
    return { runId: result.run.runId, opportunityId: input.opportunityId };
  }

  async resume(input: { runId: string; approval: 'APPROVE' | 'REJECT' }): Promise<void> {
    if (input.approval !== 'APPROVE') {
      throw new Error(`Unsupported investment workflow resume: ${input.runId}`);
    }
    await this.runtime.approveRun(input.runId, `investment-approval:${input.runId}`);
  }
}
