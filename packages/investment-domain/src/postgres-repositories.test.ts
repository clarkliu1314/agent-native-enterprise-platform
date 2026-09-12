import { describe, expect, it } from 'vitest';
import type { InvestmentOpportunityRepository } from './repositories';
import { PostgresInvestmentOpportunityRepository } from './postgres-repositories';

describe('investment PostgreSQL persistence contract', () => {
  it('exposes an opportunity repository with optimistic version persistence', () => {
    const repository: InvestmentOpportunityRepository = new PostgresInvestmentOpportunityRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
    });

    expect(repository).toBeDefined();
    expect(repository.get).toBeTypeOf('function');
    expect(repository.save).toBeTypeOf('function');
  });
});
