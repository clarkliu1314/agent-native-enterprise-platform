import type { RunView } from '@agent-native/runtime-contract/durable';
import { DurableRuntimeService, PostgresRuntimeRepositories, type RuntimeAdapter } from '@agent-native/runtime';
import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowDatabase {
  transaction<T>(work: (tx: { query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<{ rows: T[]; rowCount: number }> }) => Promise<T>): Promise<T>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

/** Investment facade over the authoritative durable runtime service. */
export class PostgresInvestmentWorkflowRuntime implements InvestmentWorkflowRuntime {
  private readonly runtime: DurableRuntimeService;

  constructor(database: InvestmentWorkflowDatabase, adapter: RuntimeAdapter) {
    this.runtime = new DurableRuntimeService(new PostgresRuntimeRepositories(database), { adapter });
  }

  async createRun(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<{ run: RunView; replayed: boolean }> {
    return this.runtime.createRun({
      agentId: 'equity-investment',
      input: { tenantId: input.tenantId, opportunityId: input.opportunityId },
      metadata: { tenantId: input.tenantId, opportunityId: input.opportunityId, nextStep: 0 },
      executionMode: 'async',
      idempotencyKey: input.idempotencyKey,
    });
  }

  approveRun(runId: string, approvalId: string): Promise<RunView> {
    return this.runtime.approveRun(runId, approvalId);
  }

  getRun(runId: string): Promise<RunView> {
    return this.runtime.getRun(runId);
  }
}
