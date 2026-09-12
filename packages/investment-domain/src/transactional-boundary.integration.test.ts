import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { InvestmentApplicationService, PostgresInvestmentUnitOfWork } from './application-service';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('investment transactional command boundary', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const opportunityId = `tx-opp-${suffix}`;

  beforeAll(async () => {
    await pool.query('DELETE FROM investment_events WHERE opportunity_id=$1', [opportunityId]).catch(() => undefined);
    await pool.query('DELETE FROM investment_decisions WHERE opportunity_id=$1', [opportunityId]).catch(() => undefined);
    await pool.query('DELETE FROM investment_opportunities WHERE opportunity_id=$1', [opportunityId]).catch(() => undefined);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM outbox_events WHERE tenant_id=$1 AND idempotency_key LIKE $2', ['tenant-tx', `investment:%:${opportunityId}:%`]);
    await pool.query('DELETE FROM investment_events WHERE opportunity_id=$1', [opportunityId]);
    await pool.query('DELETE FROM investment_decisions WHERE opportunity_id=$1', [opportunityId]);
    await pool.query('DELETE FROM investment_opportunities WHERE opportunity_id=$1', [opportunityId]);
    await pool.end();
  });

  it('rolls back the business mutation when the event/outbox boundary fails', async () => {
    const uow = new PostgresInvestmentUnitOfWork(pool, { failOutbox: true });
    const service = new InvestmentApplicationService(uow);

    await expect(service.createOpportunity({
      tenantId: 'tenant-tx',
      opportunityId,
      companyId: 'company-tx',
      companyName: 'Transactional Co',
      ownerId: 'owner-tx',
      actorId: 'actor-tx',
      idempotencyKey: `investment:create:${opportunityId}:1`,
      now: '2026-09-12T00:00:00.000Z',
    })).rejects.toThrow('forced outbox failure');

    const opportunity = await pool.query(
      'SELECT opportunity_id FROM investment_opportunities WHERE opportunity_id=$1',
      [opportunityId],
    );
    const events = await pool.query(
      'SELECT event_id FROM investment_events WHERE opportunity_id=$1',
      [opportunityId],
    );
    const outbox = await pool.query(
      'SELECT outbox_id FROM outbox_events WHERE tenant_id=$1 AND idempotency_key=$2',
      ['tenant-tx', `investment:create:${opportunityId}:1`],
    );

    expect(opportunity.rowCount).toBe(0);
    expect(events.rowCount).toBe(0);
    expect(outbox.rowCount).toBe(0);
  });
});
