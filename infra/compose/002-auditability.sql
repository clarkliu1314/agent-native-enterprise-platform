-- Stage 12.3 auditability schema. Kept as a separate migration so the
-- production-readiness audit trail is applied by both CI and local Compose.
CREATE TABLE IF NOT EXISTS audit_records (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('USER','SERVICE','SYSTEM')),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','REJECTED','FAILED','REPLAYED')),
  reason_class TEXT NOT NULL CHECK (reason_class IN ('NONE','PROVIDED','SYSTEM')),
  request_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  run_id TEXT,
  workflow_id TEXT,
  agent_id TEXT,
  version INTEGER CHECK (version IS NULL OR version >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (tenant_id, audit_id)
);

CREATE INDEX IF NOT EXISTS audit_records_tenant_time_idx
  ON audit_records (tenant_id, occurred_at ASC, audit_id ASC);
CREATE INDEX IF NOT EXISTS audit_records_tenant_resource_idx
  ON audit_records (tenant_id, resource_type, resource_id, occurred_at ASC, audit_id ASC);

CREATE OR REPLACE FUNCTION audit_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_records_immutable_trigger ON audit_records;
CREATE TRIGGER audit_records_immutable_trigger
  BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW EXECUTE FUNCTION audit_records_immutable();
