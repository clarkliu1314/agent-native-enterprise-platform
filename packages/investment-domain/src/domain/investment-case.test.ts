import { describe, expect, it } from 'vitest';
import {
  createInvestmentCase,
  transitionInvestmentCase,
  putInvestmentCaseOnHold,
  resumeInvestmentCase,
  type InvestmentCase,
} from './investment-case';

const base = {
  id: 'case-1',
  tenantId: 'tenant-a',
  opportunityId: 'opp-1',
  name: 'Acme investment',
  description: 'Research Acme',
  createdAt: '2026-09-18T00:00:00.000Z',
};

describe('InvestmentCase domain lifecycle', () => {
  it('creates a DRAFT case at version 1', () => {
    const c = createInvestmentCase(base);
    expect(c.status).toBe('DRAFT');
    expect(c.previousStatus).toBeNull();
    expect(c.decisionId).toBeNull();
    expect(c.version).toBe(1);
  });

  it.each([
    ['DRAFT', 'RESEARCHING'],
    ['RESEARCHING', 'ANALYZING'],
    ['ANALYZING', 'DECISION_PENDING'],
    ['DECISION_PENDING', 'APPROVED'],
    ['DECISION_PENDING', 'REJECTED'],
  ] as const)('allows %s -> %s', (from, to) => {
    const current: InvestmentCase = { ...createInvestmentCase(base), status: from, version: 1 };
    const next = transitionInvestmentCase(current, to, '2026-09-18T01:00:00.000Z');
    expect(next.status).toBe(to);
    expect(next.previousStatus).toBe(from);
    expect(next.version).toBe(2);
  });

  it('rejects terminal re-entry and invalid transitions', () => {
    const approved: InvestmentCase = { ...createInvestmentCase(base), status: 'APPROVED', version: 3 };
    expect(() => transitionInvestmentCase(approved, 'RESEARCHING', '2026-09-18T01:00:00.000Z')).toThrow(/Invalid investment case transition/);
    const draft = createInvestmentCase(base);
    expect(() => transitionInvestmentCase(draft, 'ANALYZING', '2026-09-18T01:00:00.000Z')).toThrow(/Invalid investment case transition/);
  });

  it('round-trips ON_HOLD to the previous business state', () => {
    const researching = transitionInvestmentCase(createInvestmentCase(base), 'RESEARCHING', '2026-09-18T01:00:00.000Z');
    const held = putInvestmentCaseOnHold(researching, '2026-09-18T02:00:00.000Z');
    expect(held.status).toBe('ON_HOLD');
    expect(held.previousStatus).toBe('RESEARCHING');
    const resumed = resumeInvestmentCase(held, '2026-09-18T03:00:00.000Z');
    expect(resumed.status).toBe('RESEARCHING');
    expect(resumed.previousStatus).toBe('ON_HOLD');
    expect(resumed.version).toBe(4);
  });

  it('validates tenant and opportunity ownership', () => {
    expect(() => createInvestmentCase({ ...base, tenantId: '' })).toThrow(/tenantId is required/);
    expect(() => createInvestmentCase({ ...base, opportunityId: '' })).toThrow(/opportunityId is required/);
  });
});
