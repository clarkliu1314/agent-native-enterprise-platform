import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowStartResult {
  runId: string;
  opportunityId: string;
}

const WORKFLOW_STEPS = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;

export class InvestmentWorkflow {
  constructor(private readonly runtime: InvestmentWorkflowRuntime) {}

  async start(input: {
    tenantId: string;
    opportunityId: string;
    idempotencyKey: string;
    fencingToken: bigint;
  }): Promise<InvestmentWorkflowStartResult> {
    const { fencingToken, ...admission } = input;
    const run = await this.runtime.startRun(admission);
    const startAt = Math.max(0, Math.min(run.nextStep ?? 0, WORKFLOW_STEPS.length));

    for (let index = startAt; index < WORKFLOW_STEPS.length; index += 1) {
      const step = WORKFLOW_STEPS[index];
      const result = await this.runtime.executeTurn({
        runId: run.runId,
        fencingToken,
        input: { opportunityId: input.opportunityId, step },
      });
      if (result.status === 'WAITING' || result.status === 'COMPLETED') break;
    }

    return { runId: run.runId, opportunityId: input.opportunityId };
  }

  async resume(input: { runId: string; approval: 'APPROVE' | 'REJECT' }): Promise<void> {
    await this.runtime.resumeRun({ runId: input.runId, input: { step: 'approval', approval: input.approval } });
  }
}
