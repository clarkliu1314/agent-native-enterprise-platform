import { describe, expect, it, vi } from 'vitest';
import { InvestmentWorkflow } from './workflow';
import type { InvestmentWorkflowRuntime } from './runtime-port';

describe('InvestmentWorkflow durable admission boundary', () => {
  it('admits the run without executing workflow steps or accepting a caller fencing token', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      startRun: vi.fn().mockResolvedValue({ runId: 'run-1', nextStep: 0 }),
      executeTurn: vi.fn(),
      resumeRun: vi.fn(),
    };
    const workflow = new InvestmentWorkflow(runtime);

    await expect(workflow.start({
      tenantId: 'tenant-1',
      opportunityId: 'opp-1',
      idempotencyKey: 'workflow:opp-1',
    })).resolves.toEqual({ runId: 'run-1', opportunityId: 'opp-1' });

    expect(runtime.startRun).toHaveBeenCalledWith({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });
    expect(runtime.executeTurn).not.toHaveBeenCalled();
  });

  it('resumes the same durable approval wait without owning the business aggregate', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      startRun: vi.fn(),
      executeTurn: vi.fn(),
      resumeRun: vi.fn().mockResolvedValue(undefined),
    };
    const workflow = new InvestmentWorkflow(runtime);

    await expect(workflow.resume({ runId: 'run-1', approval: 'APPROVE' })).resolves.toBeUndefined();
    expect(runtime.resumeRun).toHaveBeenCalledWith({ runId: 'run-1', input: { step: 'approval', approval: 'APPROVE' } });
  });
});
