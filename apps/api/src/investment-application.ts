import { InvestmentApplicationService, PostgresInvestmentUnitOfWork, type InvestmentDatabase } from '../../../packages/investment-domain/src/application-service';
import type { AdvanceOpportunityStageCommand, ApproveInvestmentCommand, CreateOpportunityCommand, InvestmentDecisionCommand, RejectInvestmentCommand } from '../../../packages/investment-domain/src/commands';
import { InvestmentWorkflow } from '../../../packages/investment-domain/src/workflow';
import { PostgresInvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/postgres-workflow-runtime';
import type { InvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/runtime-port';
import { PostgresDatabase } from '@agent-native/runtime';
import type { InvestmentApiApplication } from './investment-handler';

type WorkflowDatabase = InvestmentDatabase & {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};

export class InvestmentApiApplicationAdapter implements InvestmentApiApplication {
  private readonly service: InvestmentApplicationService;
  private readonly workflowRuntime: InvestmentWorkflowRuntime;
  private readonly workflow: InvestmentWorkflow;

  constructor(
    database: WorkflowDatabase = new PostgresDatabase(),
    service: InvestmentApplicationService = new InvestmentApplicationService(new PostgresInvestmentUnitOfWork(database)),
    workflowRuntime: InvestmentWorkflowRuntime = new PostgresInvestmentWorkflowRuntime(database),
  ) {
    this.service = service;
    this.workflowRuntime = workflowRuntime;
    this.workflow = new InvestmentWorkflow(workflowRuntime);
  }

  createOpportunity(command: Record<string, unknown>): Promise<unknown> { return this.service.createOpportunity(command as unknown as CreateOpportunityCommand); }
  advanceStage(command: Record<string, unknown>): Promise<unknown> { return this.service.advanceStage(command as unknown as AdvanceOpportunityStageCommand); }
  submitDecision(command: Record<string, unknown>): Promise<unknown> {
    const decision = command as unknown as InvestmentDecisionCommand;
    if (decision.recommendation === 'APPROVE') return this.service.approve(decision as ApproveInvestmentCommand);
    if (decision.recommendation === 'REJECT') return this.service.reject(decision as RejectInvestmentCommand);
    return Promise.reject(new Error(`Unsupported investment recommendation: ${String(decision.recommendation)}`));
  }

  /** Admission only: no worker claim, long-running step, or caller fencing token crosses the API boundary. */
  startWorkflow(command: Record<string, unknown>): Promise<unknown> {
    return this.workflow.start({ tenantId: String(command.tenantId), opportunityId: String(command.opportunityId), idempotencyKey: String(command.idempotencyKey) });
  }

  async getWorkflow(runId: string, tenantId: string): Promise<unknown> {
    const run = await this.workflowRuntime.getRun(runId);
    if (String(run.metadata.tenantId ?? '') !== tenantId) throw new Error(`Investment workflow not found: ${runId}`);
    return { runId: run.runId, state: run.state, nextStep: Number(run.metadata.nextStep ?? 0) };
  }

  async resumeWorkflow(command: Record<string, unknown>): Promise<unknown> {
    const runId = String(command.runId);
    const tenantId = String(command.tenantId);
    const run = await this.workflowRuntime.getRun(runId);
    if (String(run.metadata.tenantId ?? '') !== tenantId) throw new Error(`Investment workflow not found: ${runId}`);
    await this.workflow.resume({ runId, approval: String(command.approval) as 'APPROVE' | 'REJECT' });
    return undefined;
  }
}
