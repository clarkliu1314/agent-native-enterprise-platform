import { InvestmentApplicationService, PostgresInvestmentUnitOfWork } from '../../../packages/investment-domain/src/application-service';
import type { AdvanceOpportunityStageCommand, CreateOpportunityCommand, InvestmentDecisionCommand } from '../../../packages/investment-domain/src/commands';
import { PostgresInvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/postgres-workflow-runtime';
import type { InvestmentWorkflowRuntime } from '../../../packages/investment-domain/src/runtime-port';
import { PostgresDatabase } from '@agent-native/runtime';
import type { InvestmentApiApplication } from './investment-handler';

type WorkflowDatabase = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};

export class InvestmentApiApplicationAdapter implements InvestmentApiApplication {
  private readonly service: InvestmentApplicationService;
  private readonly workflow: InvestmentWorkflowRuntime;
  private readonly database: WorkflowDatabase;

  constructor(
    database: WorkflowDatabase = new PostgresDatabase(),
    service: InvestmentApplicationService = new InvestmentApplicationService(new PostgresInvestmentUnitOfWork(database)),
    workflow: InvestmentWorkflowRuntime = new PostgresInvestmentWorkflowRuntime(database),
  ) {
    this.database = database;
    this.service = service;
    this.workflow = workflow;
  }

  createOpportunity(command: Record<string, unknown>): Promise<unknown> {
    return this.service.createOpportunity(command as unknown as CreateOpportunityCommand);
  }

  advanceStage(command: Record<string, unknown>): Promise<unknown> {
    return this.service.advanceStage(command as unknown as AdvanceOpportunityStageCommand);
  }

  submitDecision(command: Record<string, unknown>): Promise<unknown> {
    const decision = command as unknown as InvestmentDecisionCommand;
    if (decision.recommendation === 'APPROVE') return this.service.approve(decision);
    if (decision.recommendation === 'REJECT') return this.service.reject(decision);
    return Promise.reject(new Error(`Unsupported investment recommendation: ${String(decision.recommendation)}`));
  }

  startWorkflow(command: Record<string, unknown>): Promise<unknown> {
    return this.workflow.startRun({
      tenantId: String(command.tenantId),
      opportunityId: String(command.opportunityId),
      idempotencyKey: String(command.idempotencyKey),
    });
  }

  async getWorkflow(runId: string, tenantId: string): Promise<unknown> {
    const result = await this.database.query<{ run_id: string; state: string; metadata: Record<string, unknown> }>(
      `SELECT run_id, state, metadata
       FROM agent_runs
       WHERE run_id=$1 AND metadata->>'tenantId'=$2`,
      [runId, tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Investment workflow not found: ${runId}`);
    const metadata = row.metadata ?? {};
    return { runId: row.run_id, state: row.state, nextStep: Number(metadata.nextStep ?? 0) };
  }

  async resumeWorkflow(command: Record<string, unknown>): Promise<unknown> {
    const runId = String(command.runId);
    const tenantId = String(command.tenantId);
    const owned = await this.database.query(
      `SELECT 1 FROM agent_runs WHERE run_id=$1 AND metadata->>'tenantId'=$2`,
      [runId, tenantId],
    );
    if (owned.rowCount !== 1) throw new Error(`Investment workflow not found: ${runId}`);
    await this.workflow.resumeRun({ runId, input: command });
    return undefined;
  }
}
