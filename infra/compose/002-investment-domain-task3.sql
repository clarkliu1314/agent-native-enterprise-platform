CREATE TABLE IF NOT EXISTS investment_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT investment_events_opportunity_fk
    FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES investment_opportunities(tenant_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS investment_events_opportunity_idx
  ON investment_events (tenant_id, opportunity_id, occurred_at);
