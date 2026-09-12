import { describe, expect, it } from 'vitest';
import { advanceOpportunityStage, type InvestmentOpportunity } from './opportunity';

describe('InvestmentOpportunity lifecycle', () => {
  const opportunity: InvestmentOpportunity = {
    opportunityId: 'opp-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    companyName: 'Acme',
    stage: 'DRAFT',
    status: 'ACTIVE',
    ownerId: 'owner-1',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    version: 1,
  };

  it('allows only the approved forward lifecycle', () => {
    expect(advanceOpportunityStage(opportunity, 'SCREENING').stage).toBe('SCREENING');
    expect(advanceOpportunityStage({ ...opportunity, stage: 'SCREENING' }, 'DUE_DILIGENCE').stage).toBe('DUE_DILIGENCE');
    expect(advanceOpportunityStage({ ...opportunity, stage: 'DUE_DILIGENCE' }, 'IC_REVIEW').stage).toBe('IC_REVIEW');
    expect(advanceOpportunityStage({ ...opportunity, stage: 'IC_REVIEW' }, 'APPROVED').stage).toBe('APPROVED');
    expect(advanceOpportunityStage({ ...opportunity, stage: 'IC_REVIEW' }, 'REJECTED').stage).toBe('REJECTED');
  });

  it('rejects skipping stages and transitions out of terminal stages', () => {
    expect(() => advanceOpportunityStage(opportunity, 'DUE_DILIGENCE')).toThrow(/Invalid opportunity stage transition/);
    expect(() => advanceOpportunityStage({ ...opportunity, stage: 'APPROVED' }, 'REJECTED')).toThrow(/Invalid opportunity stage transition/);
  });

  it('does not mutate the input aggregate', () => {
    const next = advanceOpportunityStage(opportunity, 'SCREENING');
    expect(next).not.toBe(opportunity);
    expect(opportunity.stage).toBe('DRAFT');
    expect(next.version).toBe(2);
  });
});
