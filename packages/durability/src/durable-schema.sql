-- Durable runtime schema. PostgreSQL is the source of truth for lifecycle, ownership,
-- events, idempotency, execution steps, checkpoints, and waits.

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED')),
  input JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_recovery_idx
  ON agent_runs (state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS agent_turns (
  turn_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS model_calls (
  call_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  turn_id TEXT REFERENCES agent_turns(turn_id),
  model TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  replay_policy TEXT NOT NULL CHECK (replay_policy IN ('REPLAYABLE','NON_REPLAYABLE')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','RUNNING','SUCCEEDED','FAILED','WAITING')),
  response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS model_call_attempts (
  attempt_id TEXT PRIMARY KEY,
  model_call_id TEXT NOT NULL REFERENCES model_calls(call_id),
  attempt_number INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  provider_request_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  UNIQUE (model_call_id, attempt_number)
);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_calls_idempotency_idx
  ON tool_calls (run_id, idempotency_key);

CREATE TABLE IF NOT EXISTS agent_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  outbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES agent_events(event_id),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_publish_idx
  ON outbox_events (published_at, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  command_hash TEXT NOT NULL,
  run_id TEXT REFERENCES agent_runs(run_id),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS wait_conditions (
  wait_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
  kind TEXT NOT NULL CHECK (kind IN ('HUMAN_APPROVAL','TOOL_CALLBACK','WEBHOOK','SCHEDULE')),
  status TEXT NOT NULL CHECK (status IN ('WAITING','SATISFIED','CANCELLED')),
  condition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  satisfied_at TIMESTAMPTZ
);
