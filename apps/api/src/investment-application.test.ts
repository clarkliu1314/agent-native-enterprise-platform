import { describe, expect, it, vi } from 'vitest';
import { InvestmentApiApplicationAdapter } from './investment-application';

function db() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ run_id: 'run-1', state: 'WAITING', metadata: { tenantId: 'tenant-a', nextStep: 4 } }], rowCount: 1 }),
    transaction: vi.fn(),
  };
}

describe('investment API application adapter', () => {
  it('delegates opportunity commands to the durable investment service', async () => {
    const database = db();
    const service = {
      createOpportunity: vi.fn().mockResolvedValue({ opportunityId: 'opp-1' }),
      advanceStage: vi.fn().mockResolvedValue({ opportunityId: 'opp-1', stage: 'SCREENING' }),
      approve: vi.fn().mockResolvedValue({ decisionId: 'decision-1' }),
      reject: vi.fn().mockResolvedValue({ decisionId: 'decision-2' }),
    } as never;
    const workflow = { startRun: vi.fn(), executeTurn: vi.fn(), resumeRun: vi.fn() } as never;
    const adapter = new InvestmentApiApplicationAdapter(database as never, service, workflow);

    await adapter.createOpportunity({ tenantId: 'tenant-a', opportunityId: 'opp-1' });
    await adapter.advanceStage({ tenantId: 'tenant-a', opportunityId: 'opp-1', nextStage: 'SCREENING', expectedVersion: 1 });
    await adapter.submitDecision({ tenantId: 'tenant-a', opportunityId: 'opp-1', recommendation: 'APPROVE', decisionCycle: 1, rationale: 'ok' });

    expect(service.createOpportunity).toHaveBeenCalledOnce();
    expect(service.advanceStage).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }));
    expect(service.approve).toHaveBeenCalledOnce();
  });

  it('uses durable workflow runtime and enforces tenant ownership for status and resume', async () => {
    const database = db();
    const workflow = { startRun: vi.fn().mockResolvedValue({ runId: 'run-1', nextStep: 0 }), executeTurn: vi.fn(), resumeRun: vi.fn().mockResolvedValue(undefined) } as never;
    const adapter = new InvestmentApiApplicationAdapter(database as never, undefined, workflow);

    await expect(adapter.startWorkflow({ tenantId: 'tenant-a', opportunityId: 'opp-1', idempotencyKey: 'workflow-1' })).resolves.toEqual({ runId: 'run-1', nextStep: 0 });
    await expect(adapter.getWorkflow('run-1', 'tenant-a')).resolves.toEqual({ runId: 'run-1', state: 'WAITING', nextStep: 4 });
    await adapter.resumeWorkflow({ runId: 'run-1', tenantId: 'tenant-a', approval: 'APPROVE' });

    expect(workflow.startRun).toHaveBeenCalledWith({ tenantId: 'tenant-a', opportunityId: 'opp-1', idempotencyKey: 'workflow-1' });
    expect(workflow.resumeRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
  });

  it('fails closed when workflow status belongs to another tenant', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      transaction: vi.fn(),
    };
    const adapter = new InvestmentApiApplicationAdapter(database as never, undefined, { startRun: vi.fn(), executeTurn: vi.fn(), resumeRun: vi.fn() } as never);
    await expect(adapter.getWorkflow('run-1', 'tenant-b')).rejects.toThrow('Investment workflow not found');
  });
});
