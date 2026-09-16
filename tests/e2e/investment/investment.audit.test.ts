import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository } from '../../../packages/runtime/src/auditability';
import { InvestmentApplicationService } from '../../../packages/investment-domain/src/application/application-service';
import { PostgresInvestmentUnitOfWork } from '../../../packages/investment-domain/src/persistence/unit-of-work';
import type { InvestmentSqlClient } from '../../../packages/investment-domain/src/application/event-store';

function tx(): InvestmentSqlClient {
  const rows: Record<string, unknown>[] = [];
  return {
    async query(sql: string) {
      if (sql.includes('FROM investment_opportunities')) return { rows: [{ opportunity_id: 'opp-1', tenant_id: 'tenant-a', company_id: 'co-1', company_name: 'Acme', stage: 'IC_REVIEW', status: 'ACTIVE', owner_id: 'owner-1', created_at: '2026-09-14T09:00:00.000Z', updated_at: '2026-09-14T09:00:00.000Z', version: 4 }], rowCount: 1 };
      if (sql.includes('INSERT INTO investment_opportunities')) return { rows: [{ opportunity_id: 'opp-1', tenant_id: 'tenant-a', company_id: 'co-1', company_name: 'Acme', stage: 'DRAFT', status: 'ACTIVE', owner_id: 'owner-1', created_at: '2026-09-14T09:00:00.000Z', updated_at: '2026-09-14T09:00:00.000Z', version: 1 }], rowCount: 1 };
      if (sql.includes('FROM investment_decisions')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO investment_decisions')) return { rows: [{ decision_id: 'decision-1', opportunity_id: 'opp-1', tenant_id: 'tenant-a', decision_cycle: 1, recommendation: 'APPROVE', rationale: 'approved', created_at: '2026-09-14T09:01:00.000Z', idempotency_key: 'investment-decision:opp-1:1' }], rowCount: 1 };
      if (sql.includes('UPDATE investment_opportunities')) return { rows: [], rowCount: 1 };
      rows.push({ sql });
      return { rows: [], rowCount: 1 };
    },
  };
}

describe('investment auditability', () => {
  it('audits a material investment approval once at the same transaction boundary as the domain event', async () => {
    const audit = new InMemoryAuditRepository();
    const database = { transaction: async <T>(work: (tx: InvestmentSqlClient) => Promise<T>) => work(tx()) };
    const uow = new PostgresInvestmentUnitOfWork(database, undefined, audit);
    const service = new InvestmentApplicationService(uow);
    const result = await service.approve({ tenantId: 'tenant-a', opportunityId: 'opp-1', decisionCycle: 1, recommendation: 'APPROVE', rationale: 'approved', actorId: 'user-1', idempotencyKey: 'investment-decision:opp-1:1' });
    const now = Date.now();
    const audits = await audit.query({ tenantId: 'tenant-a', from: new Date(now - 60_000).toISOString(), to: new Date(now + 60_000).toISOString(), limit: 100 });
    expect(result.decisionId).toBe('decision-1'); expect(audits.items).toHaveLength(1); expect(audits.items[0]).toMatchObject({ actorId: 'user-1', actorType: 'USER', action: 'INVESTMENT_APPROVED', resourceType: 'INVESTMENT_OPPORTUNITY', resourceId: 'opp-1', outcome: 'SUCCEEDED', metadata: { decisionCycle: 1, resultingStage: 'APPROVED' } });
  });
});
