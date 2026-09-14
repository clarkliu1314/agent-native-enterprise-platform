import type { RunView } from '@agent-native/runtime-contract/durable';
import { DurableRuntimeService, PostgresRuntimeRepositories, type AuditRepository, type TransactionalAuditRepository, type RuntimeAdapter, type SqlClient, type TransactionRunner } from '@agent-native/runtime';
import type { InvestmentWorkflowRuntime } from './runtime-port';

export type InvestmentWorkflowDatabase = TransactionRunner & SqlClient;

type WorkflowMetadata = { tenantId: string; opportunityId: string; nextStep: number };
const STEPS = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;

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
      await this.repositories.saveRunProgress({ runId: input.run.runId, fencingToken: input.run.fencingToken, metadata: state, checkpoint: { checkpointId: `${input.run.runId}:checkpoint:${checkpointSequence}`, runId: input.run.runId, sequence: checkpointSequence, fencingToken: input.run.fencingToken, adapter: this.name, adapterVersion: this.version, schemaVersion: 1, createdAt: new Date().toISOString(), payload: this.serializeCheckpoint(state) } });
    }
    return { kind: 'WAITING', output: { opportunityId, nextStep } };
  }
  serializeCheckpoint(state: unknown): Uint8Array { return Buffer.from(JSON.stringify(state)); }
  deserializeCheckpoint(payload: Uint8Array): unknown { return JSON.parse(Buffer.from(payload).toString('utf8')); }
}

export class PostgresInvestmentWorkflowRuntime implements InvestmentWorkflowRuntime {
  private readonly runtime: DurableRuntimeService;
  constructor(database: InvestmentWorkflowDatabase, adapter?: RuntimeAdapter, audit?: AuditRepository) {
    const transactionalAudit = audit && 'appendInTransaction' in audit ? audit as TransactionalAuditRepository : undefined;
    const repositories = new PostgresRuntimeRepositories(database, transactionalAudit);
    this.runtime = new DurableRuntimeService(repositories, { adapter: adapter ?? new InvestmentWorkflowRuntimeAdapter(database, repositories) });
  }
  createRun(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<{ run: RunView; replayed: boolean }> {
    return this.runtime.createRun({ agentId: 'equity-investment', input: { tenantId: input.tenantId, opportunityId: input.opportunityId }, metadata: { tenantId: input.tenantId, opportunityId: input.opportunityId, nextStep: 0 }, executionMode: 'async', idempotencyKey: input.idempotencyKey });
  }
  approveRun(runId: string, approvalId: string): Promise<RunView> { return this.runtime.approveRun(runId, approvalId); }
  getRun(runId: string): Promise<RunView> { return this.runtime.getRun(runId); }
}
