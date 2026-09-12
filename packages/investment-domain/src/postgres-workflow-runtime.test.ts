import { describe, expect, it } from 'vitest';
import { PostgresInvestmentWorkflowRuntime, type InvestmentWorkflowDatabase } from './postgres-workflow-runtime';

class FakeDatabase implements InvestmentWorkflowDatabase {
  runs = new Map<string, { state: string; version: number; metadata: unknown; fencingToken: bigint }>();
  idempotency = new Map<string, string>();
  checkpoints: Array<{ runId: string; sequence: bigint; fencingToken: bigint; payload: Buffer }> = [];

  async transaction<T>(work: (tx: { query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> }) => Promise<T>): Promise<T> {
    const tx = {
      query: async <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => {
        if (sql.includes('FROM idempotency_keys')) {
          const runId = this.idempotency.get(String(params[0]));
          if (!runId) return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
          const run = this.runs.get(runId)!;
          return { rows: [{ run_id: runId, metadata: run.metadata }] as T[], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO agent_runs')) {
          const runId = String(params[0]);
          this.runs.set(runId, { state: 'QUEUED', version: 0, fencingToken: 0n, metadata: JSON.parse(String(params[2])) });
          return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        if (sql.includes('INSERT INTO idempotency_keys')) {
          this.idempotency.set(String(params[0]), String(params[2]));
          return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        if (sql.includes('SELECT metadata, state, version, fencing_token')) {
          const run = this.runs.get(String(params[0]));
          return run
            ? { rows: [{ metadata: run.metadata, state: run.state, version: run.version, fencing_token: run.fencingToken }] as T[], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO checkpoints')) {
          this.checkpoints.push({ runId: String(params[1]), sequence: BigInt(params[2] as bigint), fencingToken: BigInt(params[3] as bigint), payload: Buffer.from(params[4] as Buffer) });
          return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        if (sql.includes('UPDATE agent_runs') && sql.includes('metadata=$2')) {
          const run = this.runs.get(String(params[0]))!;
          run.metadata = JSON.parse(String(params[1]));
          run.state = String(params[2]);
          run.version = Number(params[3]);
          run.fencingToken = BigInt(params[4] as bigint);
          return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: 1 };
        }
        if (sql.includes("state='COMPLETED'")) {
          const run = this.runs.get(String(params[0]))!;
          if (run.state !== 'WAITING') return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
          run.state = 'COMPLETED';
          run.version += 1;
          return { rows: [], rowCount: 1 } as { rows: [], rowCount: 1 };
        }
        throw new Error(`Unhandled SQL: ${sql}`);
      },
    };
    return work(tx);
  }
}

describe('PostgresInvestmentWorkflowRuntime recovery', () => {
  it('admits a workflow as QUEUED and does not mark it RUNNING during admission', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const run = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-1', idempotencyKey: 'workflow:opp-1' });

    expect(run.nextStep).toBe(0);
    expect(db.runs.get(run.runId)?.state).toBe('QUEUED');
  });

  it('persists the cursor and the claimed fencing token for each completed step', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const first = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-2', idempotencyKey: 'workflow:opp-2' });

    await runtime.executeTurn({ runId: first.runId, fencingToken: 17n, input: { opportunityId: 'opp-2', step: 'research' } });
    const restarted = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-2', idempotencyKey: 'workflow:opp-2' });

    expect(restarted).toEqual({ runId: first.runId, nextStep: 1 });
    expect(db.checkpoints).toHaveLength(1);
    expect(db.checkpoints[0].fencingToken).toBe(17n);
    expect(db.runs.get(first.runId)?.fencingToken).toBe(17n);

    await runtime.executeTurn({ runId: restarted.runId, fencingToken: 17n, input: { opportunityId: 'opp-2', step: 'due_diligence' } });
    expect(db.checkpoints).toHaveLength(2);
    expect(db.checkpoints[1].fencingToken).toBe(17n);
  });

  it('rejects a stale fencing token without advancing the durable cursor', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const run = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-3', idempotencyKey: 'workflow:opp-3' });
    await runtime.executeTurn({ runId: run.runId, fencingToken: 21n, input: { opportunityId: 'opp-3', step: 'research' } });

    await expect(runtime.executeTurn({ runId: run.runId, fencingToken: 20n, input: { opportunityId: 'opp-3', step: 'due_diligence' } })).rejects.toThrow('fencing token mismatch');
    expect(db.checkpoints).toHaveLength(1);
  });

  it('does not advance the durable cursor when the caller retries a completed step', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const run = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-4', idempotencyKey: 'workflow:opp-4' });
    await runtime.executeTurn({ runId: run.runId, fencingToken: 21n, input: { opportunityId: 'opp-4', step: 'research' } });

    await expect(runtime.executeTurn({ runId: run.runId, fencingToken: 21n, input: { opportunityId: 'opp-4', step: 'research' } })).rejects.toThrow('step mismatch');
    expect(db.checkpoints).toHaveLength(1);
  });

  it('persists WAITING and resumes the same run to COMPLETED', async () => {
    const db = new FakeDatabase();
    const runtime = new PostgresInvestmentWorkflowRuntime(db);
    const run = await runtime.startRun({ tenantId: 'tenant-1', opportunityId: 'opp-5', idempotencyKey: 'workflow:opp-5' });
    for (const step of ['research', 'due_diligence', 'analysis', 'recommendation']) {
      await runtime.executeTurn({ runId: run.runId, fencingToken: 31n, input: { opportunityId: 'opp-5', step } });
    }
    expect(db.runs.get(run.runId)?.state).toBe('WAITING');
    await runtime.resumeRun({ runId: run.runId, input: { step: 'approval', approval: 'APPROVE' } });
    expect(db.runs.get(run.runId)?.state).toBe('COMPLETED');
  });
});
