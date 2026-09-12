import { describe, expect, it, vi } from 'vitest';
import { InvestmentWorkflow } from './workflow';
import type { InvestmentWorkflowRuntime } from './runtime-port';

describe('InvestmentWorkflow', () => {
  it('starts one durable run through research, diligence, analysis, recommendation and approval wait', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      startRun: vi.fn().mockResolvedValue({ runId: 'run-1' }),
      executeTurn: vi.fn()
        .mockResolvedValueOnce({ status: 'CONTINUE' })
        .mockResolvedValueOnce({ status: 'CONTINUE' })
        .mockResolvedValueOnce({ status: 'CONTINUE' })
        .mockResolvedValueOnce({ status: 'WAITING' }),
      resumeRun: vi.fn(),
    };
    const workflow = new InvestmentWorkflow(runtime);

    await expect(workflow.start({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1', fencingToken: 17n }))
      .resolves.toEqual({ runId: 'run-1', opportunityId: 'opp-1' });

    expect(runtime.startRun).toHaveBeenCalledWith({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });
    expect(runtime.executeTurn).toHaveBeenNthCalledWith(1, { runId: 'run-1', fencingToken: 17n, input: { opportunityId: 'opp-1', step: 'research' } });
    expect(runtime.executeTurn).toHaveBeenNthCalledWith(2, { runId: 'run-1', fencingToken: 17n, input: { opportunityId: 'opp-1', step: 'due_diligence' } });
    expect(runtime.executeTurn).toHaveBeenNthCalledWith(3, { runId: 'run-1', fencingToken: 17n, input: { opportunityId: 'opp-1', step: 'analysis' } });
    expect(runtime.executeTurn).toHaveBeenNthCalledWith(4, { runId: 'run-1', fencingToken: 17n, input: { opportunityId: 'opp-1', step: 'recommendation' } });
    expect(runtime.executeTurn).toHaveBeenCalledTimes(4);
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
