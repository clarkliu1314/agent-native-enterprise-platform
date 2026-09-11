CREATE TABLE IF NOT EXISTS tool_execution_idempotency (
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  input_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'SUCCEEDED',
  lease_expires_at TIMESTAMPTZ NULL,
  output JSONB NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key),
  CONSTRAINT tool_execution_idempotency_status_check
    CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'))
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL,
  input JSONB NOT NULL,
  version INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery_state TEXT NOT NULL DEFAULT 'NONE',
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovery_owner TEXT,
  recovery_lease_token TEXT,
  recovery_lease_expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE published_at IS NULL AND status = 'PENDING';

CREATE INDEX IF NOT EXISTS agent_runs_recovery_candidates_idx
  ON agent_runs (next_attempt_at, run_id)
  WHERE recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE');

CREATE INDEX IF NOT EXISTS agent_runs_recovery_lease_idx
  ON agent_runs (recovery_lease_expires_at)
  WHERE recovery_lease_expires_at IS NOT NULL;

INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata)
VALUES ('local-seed-run', 'benchmark-agent', 'CREATED', '{"fixture":"local-compose"}'::jsonb, 0, '{"environment":"local"}'::jsonb)
ON CONFLICT (run_id) DO NOTHING;
