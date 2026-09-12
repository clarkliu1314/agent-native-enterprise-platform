import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('investment PostgreSQL persistence', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const opportunityId = `integration-opp-${suffix}`;
  const decisionId = `integration-decision-${suffix}`;
  const idempotencyKey = `integration-decision:${suffix}`;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO investment_opportunities
         (opportunity_id, tenant_id, company_id, company_name, stage, status, owner_id, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, 'IC_REVIEW', 'ACTIVE', $5, NOW(), NOW(), 1)`,
      [opportunityId, 'tenant-integration', 'company-integration', 'Integration Co', 'owner-integration'],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM investment_decisions WHERE opportunity_id=$1', [opportunityId]);
    await pool.query('DELETE FROM investment_opportunities WHERE opportunity_id=$1', [opportunityId]);
    await pool.end();
  });

  it('enforces tenant-scoped opportunity ownership for decisions', async () => {
    await expect(
      pool.query(
        `INSERT INTO investment_decisions
           (decision_id, opportunity_id, tenant_id, decision_cycle, recommendation, rationale, created_at, idempotency_key)
         VALUES ($1, $2, $3, 1, 'APPROVE', 'cross-tenant must fail', NOW(), $4)`,
        [decisionId, opportunityId, 'different-tenant', `${idempotencyKey}:cross-tenant`],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces one decision per tenant, opportunity, and decision cycle', async () => {
    await pool.query(
      `INSERT INTO investment_decisions
         (decision_id, opportunity_id, tenant_id, decision_cycle, recommendation, rationale, created_at, idempotency_key)
       VALUES ($1, $2, 'tenant-integration', 1, 'APPROVE', 'first', NOW(), $3)`,
      [decisionId, opportunityId, idempotencyKey],
    );

    await expect(
      pool.query(
        `INSERT INTO investment_decisions
           (decision_id, opportunity_id, tenant_id, decision_cycle, recommendation, rationale, created_at, idempotency_key)
         VALUES ($1, $2, 'tenant-integration', 1, 'REJECT', 'conflicting cycle', NOW(), $3)`,
        [`${decisionId}-conflict`, opportunityId, `${idempotencyKey}:conflict`],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps the idempotency key unique within a tenant', async () => {
    await expect(
      pool.query(
        `INSERT INTO investment_decisions
           (decision_id, opportunity_id, tenant_id, decision_cycle, recommendation, rationale, created_at, idempotency_key)
         VALUES ($1, $2, 'tenant-integration', 2, 'APPROVE', 'duplicate key', NOW(), $3)`,
        [`${decisionId}-idempotency-conflict`, opportunityId, idempotencyKey],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
