import { randomUUID } from 'node:crypto';
import type { InvestmentWorkflowRuntime } from './runtime-port';

interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{
    rows: T[];
    rowCount: number;
  }>;
}

export interface InvestmentWorkflowDatabase {
  transaction<T>(work: (tx: SqlClient) => Promise<T>): Promise<T>;
}

type WorkflowState = {
  nextStep: number;
  tenantId: string;
  opportunityId: string;
};

const STEPS = ['research', 'due_diligence', 'analysis', 'recommendation'] as const;

function parseState(input: unknown): WorkflowState {
  const value = (input ?? {}) as Partial<WorkflowState>;
  return {
    nextStep: Math.max(0, Math.min(Number(value.nextStep ?? 0), STEPS.length)),
    tenantId: String(value.tenantId ?? ''),
    opportunityId: String(value.opportunityId ?? ''),
  };
}

/** PostgreSQL-backed workflow runtime. Admission is durable; execution is fenced. */
export class PostgresInvestmentWorkflowRuntime implements InvestmentWorkflowRuntime {
  constructor(private readonly db: InvestmentWorkflowDatabase) {}

  async startRun(input: { tenantId: string; opportunityId: string; idempotencyKey: string }): Promise<{ runId: string; nextStep: number }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.query<{ run_id: string; metadata: unknown }>(
        `SELECT r.run_id, r.metadata
         FROM idempotency_keys i
         JOIN agent_runs r ON r.run_id=i.run_id
         WHERE i.idempotency_key=$1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const state = parseState(existing.rows[0].metadata);
        return { runId: String(existing.rows[0].run_id), nextStep: state.nextStep };
      }

      const runId = `investment:${randomUUID()}`;
      const state: WorkflowState = { nextStep: 0, tenantId: input.tenantId, opportunityId: input.opportunityId };
      await tx.query(
        `INSERT INTO agent_runs
           (run_id, agent_id, state, input, version, metadata)
         VALUES ($1,'equity-investment','QUEUED',$2::jsonb,0,$3::jsonb)`,
        [runId, JSON.stringify({ tenantId: input.tenantId, opportunityId: input.opportunityId }), JSON.stringify(state)],
      );
      await tx.query(
        `INSERT INTO idempotency_keys (idempotency_key, command_hash, run_id)
         VALUES ($1,$2,$3)`,
        [input.idempotencyKey, input.idempotencyKey, runId],
      );
      return { runId, nextStep: 0 };
    });
  }

  async executeTurn(input: { runId: string; fencingToken: bigint; input: unknown }): Promise<{ status: 'CONTINUE' | 'WAITING' | 'COMPLETED' }> {
    return this.db.transaction(async (tx) => {
      const current = await tx.query<{ metadata: unknown; state: string; version: number; fencing_token: bigint }>(
        `SELECT metadata, state, version, fencing_token
         FROM agent_runs
         WHERE run_id=$1
         FOR UPDATE`,
        [input.runId],
      );
      if (!current.rows[0]) throw new Error(`Investment workflow run not found: ${input.runId}`);
      if (current.rows[0].state === 'WAITING') return { status: 'WAITING' };
      if (current.rows[0].state === 'COMPLETED' || current.rows[0].state === 'SUCCEEDED') return { status: 'COMPLETED' };

      const storedToken = BigInt(current.rows[0].fencing_token ?? 0);
      if (current.rows[0].state === 'RUNNING' && storedToken !== input.fencingToken) {
        throw new Error(`Investment workflow fencing token mismatch: ${input.runId}`);
      }

      const state = parseState(current.rows[0].metadata);
      const payload = (input.input ?? {}) as { step?: string; opportunityId?: string };
      const expectedStep = STEPS[state.nextStep];
      if (!expectedStep || payload.step !== expectedStep) {
        throw new Error(`Investment workflow step mismatch: expected ${expectedStep ?? 'terminal'}, received ${payload.step ?? 'none'}`);
      }
      if (payload.opportunityId !== state.opportunityId) {
        throw new Error(`Investment workflow opportunity mismatch: ${input.runId}`);
      }

      const nextStep = state.nextStep + 1;
      const nextState = { ...state, nextStep };
      const sequence = BigInt(current.rows[0].version) + 1n;
      await tx.query(
        `INSERT INTO checkpoints
           (checkpoint_id, run_id, sequence, fencing_token, adapter, adapter_version, schema_version, payload)
         VALUES ($1,$2,$3,$4,'investment-workflow','1',1,$5::bytea)`,
        [`checkpoint:${randomUUID()}`, input.runId, sequence, input.fencingToken, Buffer.from(JSON.stringify(nextState))],
      );
      const nextStatus = nextStep >= STEPS.length ? 'WAITING' : 'RUNNING';
      await tx.query(
        `UPDATE agent_runs
         SET metadata=$2::jsonb, state=$3, version=$4, fencing_token=$5
         WHERE run_id=$1`,
        [input.runId, JSON.stringify(nextState), nextStatus, sequence, input.fencingToken],
      );
      return { status: nextStatus === 'WAITING' ? 'WAITING' : 'CONTINUE' };
    });
  }

  async resumeRun(input: { runId: string; input: unknown }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const payload = (input.input ?? {}) as { step?: string; approval?: string };
      if (payload.step !== 'approval' || payload.approval !== 'APPROVE') {
        throw new Error(`Unsupported investment workflow resume: ${input.runId}`);
      }
      const result = await tx.query(
        `UPDATE agent_runs
         SET state='COMPLETED', finished_at=NOW(), version=version+1
         WHERE run_id=$1 AND state='WAITING'`,
        [input.runId],
      );
      if (result.rowCount !== 1) throw new Error(`Investment workflow is not waiting: ${input.runId}`);
    });
  }
}
