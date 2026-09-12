import type { ReplayPolicy } from '@agent-native/runtime-contract/durable';
import type { SqlClient } from './ports';
import type { ModelCallStore } from './model-execution-service';

const json = (value: unknown): string => JSON.stringify(value ?? null);

export class PostgresModelCallStore implements ModelCallStore {
  constructor(private readonly db: SqlClient) {}

  async getCall(callId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT mc.status,mc.response,mc.error,mc.replay_policy,COUNT(mca.attempt_id)::int AS attempt_count
       FROM model_calls mc LEFT JOIN model_call_attempts mca ON mca.call_id=mc.call_id
       WHERE mc.call_id=$1 GROUP BY mc.call_id`,
      [callId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      status: row.status as 'REQUESTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING',
      response: row.response,
      error: row.error ? String(row.error) : undefined,
      replayPolicy: row.replay_policy as ReplayPolicy,
      attemptCount: Number(row.attempt_count),
    };
  }

  async createCall(input: { callId: string; runId: string; turnId?: string; model: string; requestHash: string; replayPolicy: ReplayPolicy }): Promise<void> {
    await this.db.query(
      `INSERT INTO model_calls (call_id,run_id,turn_id,model,request_hash,replay_policy,status)
       VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED')
       ON CONFLICT (call_id) DO NOTHING`,
      [input.callId, input.runId, input.turnId ?? null, input.model, input.requestHash, input.replayPolicy],
    );
  }

  async createAttempt(input: { attemptId: string; callId: string; attemptNumber: number; requestHash: string; providerRequestId?: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO model_call_attempts (attempt_id,call_id,attempt_number,request_hash,provider_request_id,outcome)
       VALUES ($1,$2,$3,$4,$5,'RUNNING')
       ON CONFLICT (attempt_id) DO NOTHING`,
      [input.attemptId, input.callId, input.attemptNumber, input.requestHash, input.providerRequestId ?? null],
    );
  }

  async completeAttempt(input: { attemptId: string; outcome: 'SUCCEEDED' | 'FAILED'; providerRequestId?: string }): Promise<void> {
    await this.db.query(
      `UPDATE model_call_attempts SET outcome=$2,provider_request_id=COALESCE($3,provider_request_id),completed_at=now() WHERE attempt_id=$1`,
      [input.attemptId, input.outcome, input.providerRequestId ?? null],
    );
  }

  async completeCall(input: { callId: string; response?: unknown; error?: string }): Promise<void> {
    const status = input.error ? 'FAILED' : 'SUCCEEDED';
    await this.db.query(
      `UPDATE model_calls SET status=$2,response=$3::jsonb,error=$4,completed_at=now() WHERE call_id=$1`,
      [input.callId, status, json(input.response), input.error ?? null],
    );
  }
}
