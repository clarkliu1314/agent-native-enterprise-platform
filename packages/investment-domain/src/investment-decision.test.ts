import { describe, expect, it } from 'vitest';
import { createInvestmentDecision, decisionIdempotencyKey } from './investment-decision';

describe('InvestmentDecision invariants', () => {
  it('derives a stable business idempotency key', () => {
    expect(decisionIdempotencyKey('opp-1', 1)).toBe('investment-decision:opp-1:1');
    expect(decisionIdempotencyKey('opp-1', 1)).toBe(decisionIdempotencyKey('opp-1', 1));
  });

  it('creates a durable decision with the business key and cycle', () => {
    const decision = createInvestmentDecision({
      decisionId: 'decision-1',
      opportunityId: 'opp-1',
      tenantId: 'tenant-1',
      decisionCycle: 1,
      recommendation: 'APPROVE',
      rationale: 'Strong unit economics',
      createdAt: '2026-09-12T00:00:00.000Z',
    });

    expect(decision).toEqual({
      decisionId: 'decision-1',
      opportunityId: 'opp-1',
      tenantId: 'tenant-1',
      decisionCycle: 1,
      recommendation: 'APPROVE',
      rationale: 'Strong unit economics',
      createdAt: '2026-09-12T00:00:00.000Z',
      idempotencyKey: 'investment-decision:opp-1:1',
    });
  });

  it('rejects invalid decision cycles and recommendations', () => {
    expect(() => createInvestmentDecision({
      decisionId: 'decision-1', opportunityId: 'opp-1', tenantId: 'tenant-1', decisionCycle: 0,
      recommendation: 'APPROVE', rationale: 'x', createdAt: '2026-09-12T00:00:00.000Z',
    })).toThrow(/decision cycle/);

    expect(() => createInvestmentDecision({
      decisionId: 'decision-1', opportunityId: 'opp-1', tenantId: 'tenant-1', decisionCycle: 1,
      recommendation: 'MAYBE' as 'APPROVE', rationale: 'x', createdAt: '2026-09-12T00:00:00.000Z',
    })).toThrow(/recommendation/);
  });
});
