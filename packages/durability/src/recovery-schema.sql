ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS recovery_state TEXT NOT NULL DEFAULT 'NONE',
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
