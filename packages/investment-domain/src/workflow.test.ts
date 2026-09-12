import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '@agent-native/runtime-contract/durable';
import { InvestmentWorkflow } from './workflow';
import type { InvestmentWorkflowRuntime } from './runtime-port';

const run = (overrides: Partial<RunView> = {}): RunView => ({
  runId: 'run-1', agentId: 'equity-investment', state: 'QUEUED',
  input: { tenantId: 'tenant-1', opportunityId: 'opp-1' },
  metadata: { tenantId: 'tenant-1', opportunityId: 'opp-1' }, fencingToken: 0n,
  attempt: 0, createdAt: new Date(0).toISOString(), ...overrides,
});

describe('InvestmentWorkflow durable admission boundary', () => {
  it('admits the run without executing workflow steps or accepting a caller fencing token', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      createRun: vi.fn().mockResolvedValue({ run: run(), replayed: false }), approveRun: vi.fn(), getRun: vi.fn(),
    };
    const workflow = new InvestmentWorkflow(runtime);
    await expect(workflow.start({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' }))
      .resolves.toEqual({ runId: 'run-1', opportunityId: 'opp-1' });
    expect(runtime.createRun).toHaveBeenCalledWith({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });
    expect(runtime.approveRun).not.toHaveBeenCalled();
  });

  it('resumes by durably transitioning WAITING to QUEUED and never executes from the API path', async () => {
    const runtime: InvestmentWorkflowRuntime = {
      createRun: vi.fn(), approveRun: vi.fn().mockResolvedValue(run({ state: 'QUEUED' })), getRun: vi.fn(),
    };
    const workflow = new InvestmentWorkflow(runtime);
    await expect(workflow.resume({ runId: 'run-1', approval: 'APPROVE' })).resolves.toBeUndefined();
    expect(runtime.approveRun).toHaveBeenCalledWith('run-1', 'investment-approval:run-1');
  });

  it('does not allow REJECT to masquerade as a durable approval resume', async () => {
    const runtime: InvestmentWorkflowRuntime = { createRun: vi.fn(), approveRun: vi.fn(), getRun: vi.fn() };
    const workflow = new InvestmentWorkflow(runtime);
    await expect(workflow.resume({ runId: 'run-1', approval: 'REJECT' })).rejects.toThrow('Unsupported investment workflow resume');
    expect(runtime.approveRun).not.toHaveBeenCalled();
  });
});
