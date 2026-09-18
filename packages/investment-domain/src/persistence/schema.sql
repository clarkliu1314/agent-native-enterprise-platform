CREATE TABLE IF NOT EXISTS investment_opportunities (
  opportunity_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('DRAFT','SCREENING','DUE_DILIGENCE','IC_REVIEW','APPROVED','REJECTED')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CLOSED')),
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL,
  UNIQUE (tenant_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS investment_opportunities_tenant_idx
  ON investment_opportunities (tenant_id, opportunity_id);

CREATE TABLE IF NOT EXISTS investment_decisions (
  decision_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  decision_cycle INTEGER NOT NULL CHECK (decision_cycle >= 1),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('APPROVE','REJECT')),
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (tenant_id, opportunity_id, decision_cycle),
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT investment_decisions_opportunity_fk
    FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES investment_opportunities(tenant_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS investment_decisions_opportunity_idx
  ON investment_decisions (tenant_id, opportunity_id, decision_cycle);
