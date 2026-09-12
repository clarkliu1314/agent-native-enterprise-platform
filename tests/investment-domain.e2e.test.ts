import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { InvestmentApplicationService, PostgresInvestmentUnitOfWork } from '../packages/investment-domain/src/application-service';

describe('investment domain durable E2E', () => {
  it('persists one decision, one business event, and one outbox effect for duplicate approval', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for investment E2E tests');

    const pool = new Pool({ connectionString: databaseUrl });
    const database = {
      transaction<T>(work: (tx: { query: <R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<{ rows: R[]; rowCount: number }> }) => Promise<T>): Promise<T> {
        return pool.connect().then(async (client) => {
          await client.query('BEGIN');
          try {
            const value = await work({ query: (sql, params) => client.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[]; rowCount: number }> });
            await client.query('COMMIT');
            return value;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        });
      },
    };
    const service = new InvestmentApplicationService(new PostgresInvestmentUnitOfWork(database));
    const suffix = randomUUID();
    const opportunityId = `opp-e2e-${suffix}`;
    const tenantId = `tenant-e2e-${suffix}`;
    const decisionKey = `investment-decision:${opportunityId}:1`;
    const actorId = `actor-e2e-${suffix}`;

    try {
      await service.createOpportunity({
        opportunityId,
        tenantId,
        companyId: `company-${suffix}`,
        companyName: 'E2E Company',
        ownerId: actorId,
        actorId,
        idempotencyKey: `opportunity:${opportunityId}`,
      });
      for (const nextStage of ['SCREENING', 'DUE_DILIGENCE', 'IC_REVIEW'] as const) {
        await service.advanceStage({ tenantId, opportunityId, actorId, nextStage, idempotencyKey: `stage:${opportunityId}:${nextStage}` });
      }

      const first = await service.approve({
        tenantId,
        opportunityId,
        actorId,
        decisionCycle: 1,
        recommendation: 'APPROVE',
        rationale: 'E2E approval',
        idempotencyKey: decisionKey,
      });
      const second = await service.approve({
        tenantId,
        opportunityId,
        actorId,
        decisionCycle: 1,
        recommendation: 'APPROVE',
        rationale: 'E2E approval',
        idempotencyKey: decisionKey,
      });

      expect(second).toEqual(first);

      const counts = await pool.query<{ decisions: string; events: string; outbox: string }>(
        `SELECT
           (SELECT COUNT(*) FROM investment_decisions WHERE tenant_id = $1 AND opportunity_id = $2 AND decision_cycle = 1) AS decisions,
           (SELECT COUNT(*) FROM investment_events WHERE tenant_id = $1 AND opportunity_id = $2 AND idempotency_key = $3) AS events,
           (SELECT COUNT(*) FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $3) AS outbox`,
        [tenantId, opportunityId, decisionKey],
      );

      expect(counts.rows[0]).toEqual({ decisions: '1', events: '1', outbox: '1' });

      const opportunity = await pool.query<{ stage: string; status: string }>(
        'SELECT stage, status FROM investment_opportunities WHERE tenant_id = $1 AND opportunity_id = $2',
        [tenantId, opportunityId],
      );
      expect(opportunity.rows[0]).toEqual({ stage: 'APPROVED', status: 'CLOSED' });
    } finally {
      await pool.query('DELETE FROM investment_events WHERE tenant_id = $1 AND opportunity_id = $2', [tenantId, opportunityId]);
      await pool.query('DELETE FROM investment_decisions WHERE tenant_id = $1 AND opportunity_id = $2', [tenantId, opportunityId]);
      await pool.query('DELETE FROM investment_opportunities WHERE tenant_id = $1 AND opportunity_id = $2', [tenantId, opportunityId]);
      await pool.query('DELETE FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [tenantId, decisionKey]);
      await pool.end();
    }
  });
});
