import { describe, expect, it } from 'vitest';
import { PostgresInvestmentWorkflowRuntime, type InvestmentWorkflowDatabase } from './postgres-workflow-runtime';

class FakeDatabase implements InvestmentWorkflowDatabase {
  runs = new Map<string, { state: string; version: number; metadata: unknown; fencingToken: bigint }>();
  idempotency = new Map<string, string>();
  checkpoints: Array<{ runId: string; sequence: bigint; fencingToken: bigint; payload: Buffer }> = [];
  private nextRunId = 0;

  private execute<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): { rows: T[]; rowCount: number } {
    if (sql.includes('FROM idempotency_keys')) {
      const runId = this.idempotency.get(String(params[0]));
      if (!runId) return { rows: [], rowCount: 0 };
      const run = this.runs.get(runId)!;
      return { rows: [{ run_id: runId, metadata: run.metadata }] as T[], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO agent_runs')) {
      const runId = String(params[0]);
      this.runs.set(runId, { state: 'QUEUED', version: 0, fencingToken: 0n, metadata: JSON.parse(String(params[2])) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO idempotency_keys')) {
      this.idempotency.set(String(params[0]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT metadata, state, version, fencing_token')) {
      const run = this.runs.get(String(params[0]));
      return run
        ? { rows: [{ metadata: run.metadata, state: run.state, version: run.version, fencing_token: run.fencingToken }] as T[], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO checkpoints')) {
      this.checkpoints.push({ runId: String(params[1]), sequence: BigInt(params[2] as bigint), fencingToken: BigInt(params[3] as bigint), payload: Buffer.from(params[4] as Buffer) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE agent_runs') && sql.includes("state='RUNNING'") && sql.includes('fencing_token')) {
      const run = this.runs.get(String(params[0]));
      if (!run || run.state !== 'RUNNING' || run.fencingToken !== BigInt(params[2] as string)) return { rows: [], rowCount: 0 };
      run.metadata = JSON.parse(String(params[1]));
      run.version += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("state='COMPLETED'")) {
      const run = this.runs.get(String(params[0]));
      if (!run || run.state !== 'WAITING') return { rows: [], rowCount: 0 };
      run.state = 'COMPLETED';
      run.version += 1;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    return this.execute<T>(sql, params);
  }

  async transaction<T>(work: (tx: { query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> }) => Promise<T>): Promise<T> {
    return work({ query: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => this.query<T>(sql, params) });
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
    await expect(runtime.approveRun(admitted.run.runId, 'approval-1')).rejects.toThrow();
  });
});
