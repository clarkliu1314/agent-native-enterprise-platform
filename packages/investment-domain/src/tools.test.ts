import { describe, expect, it } from 'vitest';
import { createInvestmentTools } from './tools';
import { getToolPolicy } from './policies';

const context = {
  tenantId: 'tenant-1',
  opportunityId: 'opp-1',
  actorId: 'actor-1',
};

describe('investment tools and policy', () => {
  it('keeps research and analysis tools read-only and deterministic', async () => {
    const tools = createInvestmentTools();

    expect(await tools.companyLookup({ companyId: 'company-1' })).toEqual({
      companyId: 'company-1',
      companyName: 'Acme',
    });
    expect(await tools.companyFinancials({ companyId: 'company-1' })).toEqual({
      companyId: 'company-1',
      revenue: 100,
      ebitda: 20,
      currency: 'USD',
    });
    expect(await tools.dueDiligenceRun({ companyId: 'company-1' })).toMatchObject({
      companyId: 'company-1',
      status: 'PASS',
    });
    expect(await tools.investmentAnalysisGenerate({ companyId: 'company-1' })).toMatchObject({
      companyId: 'company-1',
      recommendation: 'APPROVE',
    });
    expect(await tools.icRecommend({ companyId: 'company-1' })).toMatchObject({
      companyId: 'company-1',
      recommendation: 'APPROVE',
    });
  });

  it('requires explicit authorization for side-effecting tools', async () => {
    const tools = createInvestmentTools();

    await expect(tools.advanceOpportunityStage({ ...context, nextStage: 'SCREENING' })).rejects.toThrow(
      'Tool permission denied',
    );
    await expect(tools.createInvestmentDecision({
      ...context,
      decisionCycle: 1,
      recommendation: 'APPROVE',
      rationale: 'Meets IC criteria',
      idempotencyKey: 'investment-decision:opp-1:1',
    })).rejects.toThrow('Tool permission denied');
  });

  it('classifies side-effecting tools and preserves business idempotency keys', () => {
    expect(getToolPolicy('opportunity.advance_stage')).toEqual({ effect: 'SIDE_EFFECTING', permission: 'investment.opportunity.write' });
    expect(getToolPolicy('investment_decision.create')).toEqual({ effect: 'SIDE_EFFECTING', permission: 'investment.decision.write' });
    expect(getToolPolicy('company.lookup')).toEqual({ effect: 'PURE', permission: null });
  });
});
