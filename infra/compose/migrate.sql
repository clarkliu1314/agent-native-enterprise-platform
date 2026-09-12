-- Durable runtime schema. PostgreSQL is the source of truth for lifecycle,
-- ownership, events, idempotency, durable steps, checkpoints, waits, and outbox.

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED')),
  input JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fencing_token BIGINT NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  recovery_state TEXT NOT NULL DEFAULT 'NONE',
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovery_owner TEXT,
  recovery_lease_token TEXT,
  recovery_lease_expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_claim_idx
  ON agent_runs (state, run_id);
CREATE INDEX IF NOT EXISTS agent_runs_lease_idx
  ON agent_runs (lease_expires_at)
  WHERE state = 'RUNNING';
CREATE INDEX IF NOT EXISTS agent_runs_recovery_candidates_idx
  ON agent_runs (next_attempt_at, run_id)
  WHERE recovery_state IN ('IN_PROGRESS', 'FAILED_RETRYABLE');

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  command_hash TEXT NOT NULL,
  run_id TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idempotency_run_fk FOREIGN KEY (run_id) REFERENCES agent_runs(run_id)
);
CREATE INDEX IF NOT EXISTS idempotency_run_idx ON idempotency_keys (run_id);

CREATE TABLE IF NOT EXISTS agent_turns (
  turn_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS agent_events_run_sequence_idx ON agent_events (run_id, sequence);

CREATE TABLE IF NOT EXISTS outbox_events (
  outbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES agent_events(event_id),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  -- Legacy benchmark/recovery fields retained for compatibility with existing fixtures.
  idempotency_key TEXT,
  event_type TEXT,
  tool_name TEXT,
  tenant_id TEXT,
  actor_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (next_attempt_at, created_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  fencing_token BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PURE','SIDE_EFFECTING')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','RUNNING','SUCCEEDED','FAILED','WAITING')),
  input JSONB NOT NULL,
  output JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tool_calls_run_idx ON tool_calls (run_id);

CREATE TABLE IF NOT EXISTS tool_execution_idempotency (
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  input_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'SUCCEEDED',
  lease_expires_at TIMESTAMPTZ,
  output JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key),
  CONSTRAINT tool_execution_idempotency_status_check
    CHECK (status IN ('IN_PROGRESS','SUCCEEDED','FAILED_RETRYABLE','FAILED_FINAL'))
);

CREATE TABLE IF NOT EXISTS model_calls (
  call_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  turn_id TEXT REFERENCES agent_turns(turn_id),
  model TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  replay_policy TEXT NOT NULL,
  response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS model_attempts (
  attempt_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES model_calls(call_id),
  attempt_number INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  provider_request_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'RUNNING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (call_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  turn_id TEXT REFERENCES agent_turns(turn_id),
  sequence BIGINT NOT NULL,
  fencing_token BIGINT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS checkpoints_run_sequence_idx ON checkpoints (run_id, sequence DESC);

CREATE TABLE IF NOT EXISTS run_waits (
  wait_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  kind TEXT NOT NULL,
  condition JSONB NOT NULL,
  satisfied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata)
VALUES ('local-seed-run', 'benchmark-agent', 'QUEUED', '{"fixture":"local-compose"}'::jsonb, 0, '{"environment":"local"}'::jsonb)
ON CONFLICT (run_id) DO NOTHING;
