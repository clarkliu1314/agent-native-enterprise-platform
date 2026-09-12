import { describe, expect, it } from 'vitest';
import type { InvestmentDecision } from './investment-decision';
import type { InvestmentDomainEvent } from './events';
import type { InvestmentOpportunityRepository, InvestmentDecisionRepository } from './repositories';
import { InvestmentApplicationService, type InvestmentUnitOfWork } from './application-service';
import type { InvestmentOpportunity } from './opportunity';

const opportunity: InvestmentOpportunity = {
  opportunityId: 'opp-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  companyName: 'Acme',
  stage: 'IC_REVIEW',
  status: 'ACTIVE',
  ownerId: 'owner-1',
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  version: 3,
};

class FakeOpportunityRepository implements InvestmentOpportunityRepository {
  rows = new Map<string, InvestmentOpportunity>();
  saved: Array<{ opportunity: InvestmentOpportunity; expectedVersion: number }> = [];

  async get(tenantId: string, opportunityId: string) {
    return this.rows.get(`${tenantId}:${opportunityId}`) ?? null;
  }

  async create(value: InvestmentOpportunity) {
    this.rows.set(`${value.tenantId}:${value.opportunityId}`, value);
    return value;
  }

  async save(value: InvestmentOpportunity, expectedVersion: number) {
    this.saved.push({ opportunity: value, expectedVersion });
    this.rows.set(`${value.tenantId}:${value.opportunityId}`, value);
  }
}

class FakeDecisionRepository implements InvestmentDecisionRepository {
  rows = new Map<string, InvestmentDecision>();

  async getByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.rows.get(`${tenantId}:${idempotencyKey}`) ?? null;
  }

  async create(decision: InvestmentDecision) {
    const key = `${decision.tenantId}:${decision.idempotencyKey}`;
    const existing = this.rows.get(key);
    if (existing) return existing;
    this.rows.set(key, decision);
    return decision;
  }
}

class FakeUnitOfWork implements InvestmentUnitOfWork {
  readonly opportunities = new FakeOpportunityRepository();
  readonly decisions = new FakeDecisionRepository();
  readonly events: InvestmentDomainEvent[] = [];

  async transaction<T>(work: (context: {
    opportunities: FakeOpportunityRepository;
    decisions: FakeDecisionRepository;
    events: { append(event: InvestmentDomainEvent): Promise<void> };
  }) => Promise<T>): Promise<T> {
    return work({
      opportunities: this.opportunities,
      decisions: this.decisions,
      events: { append: async (event) => { this.events.push(event); } },
    });
  }
}

describe('InvestmentApplicationService', () => {
  it('creates an opportunity and emits one durable business event', async () => {
    const uow = new FakeUnitOfWork();
    const service = new InvestmentApplicationService(uow);

    const result = await service.createOpportunity({
      tenantId: 'tenant-1',
      opportunityId: 'opp-1',
      companyId: 'company-1',
      companyName: 'Acme',
      ownerId: 'owner-1',
      actorId: 'actor-1',
      idempotencyKey: 'opportunity:create:opp-1',
      now: '2026-09-12T00:00:00.000Z',
    });

    expect(result.stage).toBe('DRAFT');
    expect(result.version).toBe(1);
    expect(uow.events).toHaveLength(1);
    expect(uow.events[0]).toMatchObject({
      type: 'OpportunityCreated',
      tenantId: 'tenant-1',
      opportunityId: 'opp-1',
      actorId: 'actor-1',
      idempotencyKey: 'opportunity:create:opp-1',
    });
  });

  it('rejects an invalid stage transition without mutating state or events', async () => {
    const uow = new FakeUnitOfWork();
    uow.opportunities.rows.set('tenant-1:opp-1', { ...opportunity, stage: 'DRAFT', version: 1 });
    const service = new InvestmentApplicationService(uow);

    await expect(service.advanceStage({
      tenantId: 'tenant-1',
      opportunityId: 'opp-1',
      nextStage: 'IC_REVIEW',
      actorId: 'actor-1',
      idempotencyKey: 'stage:opp-1:ic-review',
    })).rejects.toThrow('Invalid opportunity stage transition');

    expect(uow.opportunities.saved).toHaveLength(0);
    expect(uow.events).toHaveLength(0);
  });

  it('replays the original approval decision without a second business event', async () => {
    const uow = new FakeUnitOfWork();
    uow.opportunities.rows.set('tenant-1:opp-1', opportunity);
    const service = new InvestmentApplicationService(uow);
    const command = {
      tenantId: 'tenant-1',
      opportunityId: 'opp-1',
      decisionCycle: 1,
      recommendation: 'APPROVE' as const,
      rationale: 'Meets IC criteria',
      actorId: 'actor-1',
      idempotencyKey: 'investment-decision:opp-1:1',
    };

    const first = await service.approve(command);
    const second = await service.approve(command);

    expect(second).toEqual(first);
    expect(uow.decisions.rows).toHaveLength(1);
    expect(uow.events).toHaveLength(1);
    expect(uow.events[0]).toMatchObject({ type: 'InvestmentApproved', decisionId: first.decisionId });
  });
});
