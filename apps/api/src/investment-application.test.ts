import { describe, expect, it, vi } from 'vitest';
import type { InvestmentApplicationService } from '../../../packages/investment-domain/src/application/application-service';
import type { InvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/application/runtime-port';
import type { RunView } from '@agent-native/runtime-contract/durable';
import { InvestmentApiApplicationAdapter } from './investment-application';

function runView(overrides: Partial<RunView> = {}): RunView {
  return { runId: 'run-1', state: 'QUEUED', version: 0, attempt: 0, fencingToken: 0n, metadata: { tenantId: 'tenant-a', opportunityId: 'opp-1', nextStep: 0 }, ...overrides } as RunView;
}

describe('investment API application adapter', () => {
  it('delegates opportunity commands to the durable investment service', async () => {
    const database = { query: vi.fn(), transaction: vi.fn() };
    const service = { createOpportunity: vi.fn().mockResolvedValue({ opportunityId: 'opp-1' }), advanceStage: vi.fn().mockResolvedValue({ opportunityId: 'opp-1', stage: 'SCREENING' }), approve: vi.fn().mockResolvedValue({ decisionId: 'decision-1' }), reject: vi.fn().mockResolvedValue({ decisionId: 'decision-2' }) } as unknown as InvestmentApplicationService;
    const workflow: InvestmentWorkflowRuntime = { createRun: vi.fn(), approveRun: vi.fn(), getRun: vi.fn() };
    const adapter = new InvestmentApiApplicationAdapter(database as never, service, workflow);
    await adapter.createOpportunity({ tenantId: 'tenant-a', opportunityId: 'opp-1' });
    await adapter.advanceStage({ tenantId: 'tenant-a', opportunityId: 'opp-1', nextStage: 'SCREENING', expectedVersion: 1 });
    await adapter.submitDecision({ tenantId: 'tenant-a', opportunityId: 'opp-1', recommendation: 'APPROVE', decisionCycle: 1, rationale: 'ok' });
    expect(service.createOpportunity).toHaveBeenCalledOnce();
    expect(service.advanceStage).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }));
    expect(service.approve).toHaveBeenCalledOnce();
  });
  it('admits workflow work and resumes only through the durable runtime contract', async () => {
    const database = { query: vi.fn(), transaction: vi.fn() };
    const workflow: InvestmentWorkflowRuntime = { createRun: vi.fn().mockResolvedValue({ run: runView(), replayed: false }), approveRun: vi.fn().mockResolvedValue(runView({ state: 'QUEUED' })), getRun: vi.fn().mockResolvedValue(runView({ state: 'WAITING', metadata: { tenantId: 'tenant-a', opportunityId: 'opp-1', nextStep: 4 } })) };
    const adapter = new InvestmentApiApplicationAdapter(database as never, undefined, workflow);
    await expect(adapter.startWorkflow({ tenantId: 'tenant-a', opportunityId: 'opp-1', idempotencyKey: 'workflow-1' })).resolves.toEqual({ runId: 'run-1', opportunityId: 'opp-1' });
    await expect(adapter.getWorkflow('run-1', 'tenant-a')).resolves.toEqual({ runId: 'run-1', state: 'WAITING', nextStep: 4 });
    await adapter.resumeWorkflow({ runId: 'run-1', tenantId: 'tenant-a', approval: 'APPROVE' });
    expect(workflow.createRun).toHaveBeenCalledWith({ tenantId: 'tenant-a', opportunityId: 'opp-1', idempotencyKey: 'workflow-1' });
    expect(workflow.approveRun).toHaveBeenCalledWith('run-1', 'investment-approval:run-1');
  });
  it('fails closed when workflow status belongs to another tenant', async () => {
    const workflow: InvestmentWorkflowRuntime = { createRun: vi.fn(), approveRun: vi.fn(), getRun: vi.fn().mockResolvedValue(runView({ metadata: { tenantId: 'tenant-a', opportunityId: 'opp-1', nextStep: 0 } })) };
    const adapter = new InvestmentApiApplicationAdapter({ query: vi.fn(), transaction: vi.fn() } as never, undefined, workflow);
    await expect(adapter.getWorkflow('run-1', 'tenant-b')).rejects.toThrow('Investment workflow not found');
  });
});
