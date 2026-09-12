import { describe, expect, it } from 'vitest';
import type { TransactionClient } from '@agent-native/runtime';
import { PostgresInvestmentWorkflowRuntime, type InvestmentWorkflowDatabase } from './postgres-workflow-runtime';

class FakeDatabase implements InvestmentWorkflowDatabase {
  runs = new Map<string, { runId: string; agentId: string; state: string; attempt: number; createdAt: string; metadata: unknown; fencingToken: bigint }>();
  idempotency = new Map<string, string>();
  private sequence = 0;

  private execute<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): { rows: T[]; rowCount: number } {
    if (sql.includes('FROM idempotency_keys')) {
      const runId = this.idempotency.get(String(params[0]));
      return runId ? { rows: [{ run_id: runId, command_hash: 'hash' }] as T[], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO idempotency_keys')) {
      this.idempotency.set(String(params[0]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO agent_runs')) {
      const runId = String(params[0]);
      const agentId = String(params[1]);
      const metadata = JSON.parse(String(params[3]));
      const createdAt = new Date().toISOString();
      this.runs.set(runId, { runId, agentId, state: 'QUEUED', attempt: 0, createdAt, metadata, fencingToken: 0n });
      return {
        rows: [{ run_id: runId, agent_id: agentId, state: 'QUEUED', input: JSON.parse(String(params[2])), metadata, fencing_token: 0n, attempt: 0, created_at: createdAt }] as T[],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT * FROM agent_runs')) {
      const run = this.runs.get(String(params[0]));
      return run
        ? { rows: [{ run_id: run.runId, agent_id: run.agentId, state: run.state, input: {}, metadata: run.metadata, fencing_token: run.fencingToken, attempt: run.attempt, created_at: run.createdAt }] as T[], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO agent_events')) return { rows: [{ event_id: String(params[0]), run_id: String(params[1]), sequence: 1n, type: 'RUN_CREATED', payload: {}, created_at: new Date().toISOString() }] as T[], rowCount: 1 };
    if (sql.includes('INSERT INTO outbox_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled SQL: ${sql}`);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    return this.execute<T>(sql, params);
  }

  async transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const tx: TransactionClient = {
      query: <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => this.query<T>(sql, params),
      commit: async () => undefined,
      rollback: async () => undefined,
    };
    return work(tx);
  }
}

describe('PostgresInvestmentWorkflowRuntime', () => {
  it('admits a workflow as QUEUED and never executes it during admission', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);

    const result = await runtime.createRun({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });

    expect(result.replayed).toBe(false);
    expect(result.run.state).toBe('QUEUED');
    expect(result.run.fencingToken).toBe(0n);
    expect(result.run.metadata).toMatchObject({ tenantId: 'tenant-1', opportunityId: 'opp-1', nextStep: 0 });
  });

  it('replays the same durable run for an idempotent admission', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const input = { tenantId: 'tenant-1', opportunityId: 'opp-2', idempotencyKey: 'workflow:opp-2' };

    const first = await runtime.createRun(input);
    const second = await runtime.createRun(input);

    expect(second.replayed).toBe(true);
    expect(second.run.runId).toBe(first.run.runId);
  });

  it('exposes durable status and approval without accepting a caller fencing token', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const admitted = await runtime.createRun({ tenantId: 'tenant-1', opportunityId: 'opp-3', idempotencyKey: 'workflow:opp-3' });

    await expect(runtime.getRun(admitted.run.runId)).resolves.toMatchObject({ runId: admitted.run.runId, state: 'QUEUED' });
    await expect(runtime.approveRun(admitted.run.runId, 'approval-1')).rejects.toThrow('Run is not waiting for approval');
  });
});
