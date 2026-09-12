import type { RunView } from '@agent-native/runtime-contract/durable';
import { DurableRuntimeService, PostgresRuntimeRepositories, type RuntimeAdapter } from '@agent-native/runtime';
import type { InvestmentWorkflowRuntime } from './runtime-port';

export interface InvestmentWorkflowDatabase {
  transaction<T>(work: (tx: { query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<{ rows: T[]; rowCount: number }> }) => Promise<T>): Promise<T>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const STEPS = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;

type WorkflowMetadata = { tenantId: string; opportunityId: string; nextStep: number };

/**
 * Runtime adapter for investment business-step progression. The durable
 * runtime remains the authority for admission, claim, lease and fencing.
 */
export class InvestmentWorkflowRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'investment-workflow';
  readonly version = '1';

  constructor(private readonly database: InvestmentWorkflowDatabase, private readonly repositories: PostgresRuntimeRepositories) {}

  async run(input: { run: RunView; signal?: AbortSignal }): Promise<{ kind: 'SUCCEEDED' | 'WAITING' | 'FAILED'; output?: unknown }> {
    const metadata = input.run.metadata as Partial<WorkflowMetadata>;
    let nextStep = Math.max(0, Math.min(Number(metadata.nextStep ?? 0), STEPS.length));
    const tenantId = String(metadata.tenantId ?? '');
    const opportunityId = String(metadata.opportunityId ?? '');

    if (nextStep >= STEPS.length) return { kind: 'SUCCEEDED', output: { opportunityId, approved: true } };

    while (nextStep < STEPS.length) {
      if (input.signal?.aborted) throw new DOMException('Run execution aborted', 'AbortError');
      nextStep += 1;
      const state = { tenantId, opportunityId, nextStep } satisfies WorkflowMetadata;
      const checkpointSequence = BigInt(input.run.attempt) * 100n + BigInt(nextStep);
      const updated = await this.database.query(
        `UPDATE agent_runs SET metadata=$2::jsonb, version=version+1 WHERE run_id=$1 AND state='RUNNING' AND fencing_token=$3::bigint`,
        [input.run.runId, JSON.stringify(state), input.run.fencingToken.toString()],
      );
      if (updated.rowCount !== 1) throw new Error(`Investment workflow fenced write rejected: ${input.run.runId}`);
      await this.repositories.saveCheckpoint({
        checkpointId: `${input.run.runId}:checkpoint:${checkpointSequence}`,
        runId: input.run.runId,
        sequence: checkpointSequence,
        fencingToken: input.run.fencingToken,
        adapter: this.name,
        adapterVersion: this.version,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        payload: this.serializeCheckpoint(state),
      });
    }

    return { kind: 'WAITING', output: { opportunityId, nextStep } };
  }

  serializeCheckpoint(state: unknown): Uint8Array { return Buffer.from(JSON.stringify(state)); }
  deserializeCheckpoint(payload: Uint8Array): unknown { return JSON.parse(Buffer.from(payload).toString('utf8')); }
}

/** Investment facade over the authoritative durable runtime service. */
export class PostgresInvestmentWorkflowRuntime implements InvestmentWorkflowRuntime {
  private readonly runtime: DurableRuntimeService;

  constructor(database: InvestmentWorkflowDatabase, adapter?: RuntimeAdapter) {
    const repositories = new PostgresRuntimeRepositories(database);
    this.runtime = new DurableRuntimeService(repositories, {
      adapter: adapter ?? new InvestmentWorkflowRuntimeAdapter(database, repositories),
    });
  }

  createRun(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<{ run: RunView; replayed: boolean }> {
    return this.runtime.createRun({
      agentId: 'equity-investment',
      input: { tenantId: input.tenantId, opportunityId: input.opportunityId },
      metadata: { tenantId: input.tenantId, opportunityId: input.opportunityId, nextStep: 0 },
      executionMode: 'async',
      idempotencyKey: input.idempotencyKey,
    });
  }

  approveRun(runId: string, approvalId: string): Promise<RunView> { return this.runtime.approveRun(runId, approvalId); }
  getRun(runId: string): Promise<RunView> { return this.runtime.getRun(runId); }
}
