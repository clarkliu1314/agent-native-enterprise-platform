import type { RunView } from '@agent-native/runtime-contract/durable';

/**
 * Investment domain depends only on durable admission, resume and observation.
 * Execution, leasing and fencing are intentionally absent from this port.
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
