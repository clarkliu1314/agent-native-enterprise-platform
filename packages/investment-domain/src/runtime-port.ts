import type { RunView } from '@agent-native/runtime-contract/durable';

/**
 * Investment domain depends only on the durable runtime admission/resume
 * contract. Execution, leasing and fencing remain owned by the runtime worker.
 */
export interface InvestmentWorkflowRuntime {
  createRun(input: {
    tenantId: string;
    opportunityId: string;
    idempotencyKey: string;
  }): Promise<{
    run: RunView;
    replayed: boolean;
  }>;
  approveRun(runId: string, approvalId: string): Promise<RunView>;
  getRun(runId: string): Promise<RunView>;
}
