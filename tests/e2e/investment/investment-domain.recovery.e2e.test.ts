import { describe, expect, it } from 'vitest';
import type { RunView } from '@agent-native/runtime-contract/durable';
import { InvestmentWorkflow } from '../../../packages/investment-domain/src/workflow/workflow';
import type { InvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/workflow/runtime-port';

type DurableState = { runId: string; nextStep: number; waiting: boolean; completed: boolean };

class RestartableRuntime implements InvestmentWorkflowRuntime {
  private readonly state: DurableState = { runId: 'investment-run-1', nextStep: 0, waiting: false, completed: false };
  private readonly steps = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;
  readonly executedSteps: string[] = [];
  crashAtStep: string | undefined;

  async createRun(): Promise<{ run: RunView; replayed: boolean }> {
    return { run: { runId: this.state.runId, agentId: 'equity-investment', state: 'QUEUED', input: { tenantId: 'tenant-1', opportunityId: 'opp-1' }, metadata: { tenantId: 'tenant-1', opportunityId: 'opp-1', nextStep: this.state.nextStep }, fencingToken: 0n, attempt: 0, createdAt: new Date(0).toISOString() }, replayed: false };
  }
  async approveRun(): Promise<RunView> { this.state.waiting = false; this.state.completed = true; return (await this.createRun()).run; }
  async getRun(): Promise<RunView> { return (await this.createRun()).run; }
  async executeTurn(input: { runId: string; input: unknown }): Promise<{ status: 'CONTINUE' | 'WAITING' | 'COMPLETED' }> {
    expect(input.runId).toBe(this.state.runId);
    const step = (input.input as { step?: string }).step;
    if (step && this.steps.includes(step as (typeof this.steps)[number])) {
      this.executedSteps.push(step);
      if (step === this.crashAtStep) throw new Error(`simulated crash: ${step}`);
      this.state.nextStep = this.steps.indexOf(step as (typeof this.steps)[number]) + 1;
    }
    if (this.state.nextStep >= this.steps.length) { this.state.waiting = true; return { status: 'WAITING' }; }
    return { status: 'CONTINUE' };
  }
}

describe('investment domain recovery E2E', () => {
  it('does not duplicate completed work when a process crashes during due diligence', async () => {
    const runtime = new RestartableRuntime();
    const workflow = new InvestmentWorkflow(runtime);
    await workflow.start({ tenantId: 'tenant-1', opportunityId: 'opp-recovery-1', idempotencyKey: 'workflow:opp-recovery-1' });
    runtime.crashAtStep = 'due_diligence';
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'research' } });
    await expect(runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'due_diligence' } })).rejects.toThrow('simulated crash: due_diligence');
    runtime.crashAtStep = undefined;
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'due_diligence' } });
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'analysis' } });
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'recommendation' } });
    expect(runtime.executedSteps.filter((step) => step === 'research')).toHaveLength(1);
    expect(runtime.executedSteps.filter((step) => step === 'due_diligence')).toHaveLength(2);
    expect(runtime.executedSteps.filter((step) => step === 'analysis')).toHaveLength(1);
    expect(runtime.executedSteps.filter((step) => step === 'recommendation')).toHaveLength(1);
  });

  it('keeps approval as a durable wait and resumes the same run', async () => {
    const runtime = new RestartableRuntime();
    const workflow = new InvestmentWorkflow(runtime);
    await workflow.start({ tenantId: 'tenant-1', opportunityId: 'opp-recovery-2', idempotencyKey: 'workflow:opp-recovery-2' });
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'research' } });
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'due_diligence' } });
    await runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'analysis' } });
    await expect(runtime.executeTurn({ runId: 'investment-run-1', input: { step: 'recommendation' } })).resolves.toEqual({ status: 'WAITING' });
    await workflow.resume({ runId: 'investment-run-1', approval: 'APPROVE' });
    expect(runtime.executedSteps).toEqual(['research', 'due_diligence', 'analysis', 'recommendation']);
  });
});
