import { describe, expect, it, vi } from 'vitest';
import { InvestmentWorkflow } from './workflow';
import type { InvestmentWorkflowRuntime } from './runtime-port';

describe('InvestmentWorkflow', () => {
  it('starts through the framework-neutral durable runtime boundary', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      startRun: vi.fn().mockResolvedValue({ runId: 'run-1' }),
      executeTurn: vi.fn().mockResolvedValue({ status: 'CONTINUE' }),
      resumeRun: vi.fn(),
    };
    const workflow = new InvestmentWorkflow(runtime);

    await expect(workflow.start({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' }))
      .resolves.toEqual({ runId: 'run-1', status: 'STARTED' });

    expect(runtime.startRun).toHaveBeenCalledWith({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });
    expect(runtime.executeTurn).toHaveBeenCalledWith({ runId: 'run-1', input: { opportunityId: 'opp-1', step: 'research' } });
  });

  it('resumes a durable approval wait without owning the business aggregate', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      startRun: vi.fn(),
      executeTurn: vi.fn(),
      resumeRun: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
    };
    const workflow = new InvestmentWorkflow(runtime);

    await expect(workflow.resume({ runId: 'run-1', approval: 'APPROVE' })).resolves.toEqual({ status: 'COMPLETED' });
    expect(runtime.resumeRun).toHaveBeenCalledWith({ runId: 'run-1', input: { step: 'approval', approval: 'APPROVE' } });
  });
});
