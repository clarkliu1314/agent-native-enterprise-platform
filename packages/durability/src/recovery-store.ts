import type { Pool, PoolClient } from 'pg';
import type { ToolExecutionRequest } from '@agent-native/tool-runtime';
import type { RecoveryState } from './recovery';

export interface RecoveryCandidateRecord {
  runId: string;
  request: ToolExecutionRequest;
  state: RecoveryState;
  attempts: number;
  nextAttemptAt: Date;
  owner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

export interface RecoveryLease {
  runId: string;
  owner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  attempts: number;
  request: ToolExecutionRequest;
  state: RecoveryState;
}

export interface RecoveryFailure {
  runId: string;
  owner: string;
  leaseToken: string;
  retryable: boolean;
  error: unknown;
  now?: Date;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class RecoveryCandidateStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      ALTER TABLE agent_runs
        ADD COLUMN IF NOT EXISTS recovery_state TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS recovery_owner TEXT,
        ADD COLUMN IF NOT EXISTS recovery_lease_token TEXT,
        ADD COLUMN IF NOT EXISTS recovery_lease_expires_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS agent_runs_recovery_candidates_idx
        ON agent_runs (next_attempt_at, run_id)
        WHERE recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE');
      CREATE INDEX IF NOT EXISTS agent_runs_recovery_lease_idx
        ON agent_runs (recovery_lease_expires_at)
        WHERE recovery_lease_expires_at IS NOT NULL;
    `);
  }

  async findRecoverableCandidates(limit = 10, now = new Date()): Promise<RecoveryCandidateRecord[]> {
    const result = await this.pool.query(
      `SELECT run_id, metadata->'recovery_request' AS recovery_request,
              recovery_state, recovery_attempts, next_attempt_at,
              recovery_owner, recovery_lease_token, recovery_lease_expires_at
       FROM agent_runs
       WHERE recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE')
         AND next_attempt_at <= $1
         AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= $1)
         AND metadata ? 'recovery_request'
       ORDER BY next_attempt_at ASC, run_id ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map(rowToCandidate);
  }

  async claimRecoveryCandidate(runId: string, owner: string, leaseToken: string, leaseMs = 30_000, now = new Date()): Promise<RecoveryLease | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT run_id, metadata->'recovery_request' AS recovery_request,
                recovery_state, recovery_attempts, next_attempt_at,
                recovery_owner, recovery_lease_token, recovery_lease_expires_at
         FROM agent_runs
         WHERE run_id = $1
           AND recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE')
           AND next_attempt_at <= $2
           AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= $2)
           AND metadata ? 'recovery_request'
         FOR UPDATE SKIP LOCKED`,
        [runId, now],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      await client.query(
        `UPDATE agent_runs
         SET recovery_owner = $2, recovery_lease_token = $3, recovery_lease_expires_at = $4
         WHERE run_id = $1`,
        [runId, owner, leaseToken, leaseExpiresAt],
      );
      await client.query('COMMIT');
      return {
        runId,
        owner,
        leaseToken,
        leaseExpiresAt,
        attempts: row.recovery_attempts,
        request: row.recovery_request as ToolExecutionRequest,
        state: row.recovery_state as RecoveryState,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reclaimExpiredRecoveryCandidates(now = new Date()): Promise<number> {
    const result = await this.pool.query(
      `UPDATE agent_runs
       SET recovery_owner = NULL, recovery_lease_token = NULL, recovery_lease_expires_at = NULL
       WHERE recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE')
         AND recovery_lease_expires_at IS NOT NULL
         AND recovery_lease_expires_at <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async completeRecovery(runId: string, owner: string, leaseToken: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE agent_runs
       SET recovery_state = 'SUCCEEDED', recovery_owner = NULL,
           recovery_lease_token = NULL, recovery_lease_expires_at = NULL
       WHERE run_id = $1 AND recovery_owner = $2 AND recovery_lease_token = $3`,
      [runId, owner, leaseToken],
    );
    return result.rowCount === 1;
  }

  async recordRecoveryFailure(input: RecoveryFailure): Promise<RecoveryState> {
    const maxAttempts = input.maxAttempts ?? 5;
    const baseBackoffMs = input.baseBackoffMs ?? 1_000;
    const maxBackoffMs = input.maxBackoffMs ?? 60_000;
    const now = input.now ?? new Date();
    const nextAttempts = await this.pool.query(
      `SELECT recovery_attempts FROM agent_runs
       WHERE run_id = $1 AND recovery_owner = $2 AND recovery_lease_token = $3
       FOR UPDATE`,
      [input.runId, input.owner, input.leaseToken],
    );
    if (!nextAttempts.rows[0]) throw new Error(`Recovery lease lost: ${input.runId}`);
    const attempts = Number(nextAttempts.rows[0].recovery_attempts) + 1;
    const terminal = !input.retryable || attempts >= maxAttempts;
    const state: RecoveryState = terminal ? 'FAILED_FINAL' : 'FAILED_RETRYABLE';
    const delay = Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.max(0, attempts - 1));
    const nextAttemptAt = new Date(now.getTime() + delay);
    await this.pool.query(
      `UPDATE agent_runs
       SET recovery_state = $4,
           recovery_attempts = $5,
           next_attempt_at = $6,
           recovery_owner = NULL,
           recovery_lease_token = NULL,
           recovery_lease_expires_at = NULL,
           metadata = jsonb_set(metadata, '{recovery_last_error}', $7::jsonb, true)
       WHERE run_id = $1 AND recovery_owner = $2 AND recovery_lease_token = $3`,
      [input.runId, input.owner, input.leaseToken, state, attempts, nextAttemptAt, JSON.stringify(serializeError(input.error))],
    );
    return state;
  }
}

function rowToCandidate(row: any): RecoveryCandidateRecord {
  return {
    runId: row.run_id,
    request: row.recovery_request as ToolExecutionRequest,
    state: row.recovery_state as RecoveryState,
    attempts: Number(row.recovery_attempts),
    nextAttemptAt: new Date(row.next_attempt_at),
    owner: row.recovery_owner,
    leaseToken: row.recovery_lease_token,
    leaseExpiresAt: row.recovery_lease_expires_at ? new Date(row.recovery_lease_expires_at) : null,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { value: error };
}
