import type { TransactionalAuditRepository } from '@agent-native/runtime';
import { PostgresInvestmentDecisionRepository, PostgresInvestmentOpportunityRepository } from './postgres-repositories';
import { PostgresInvestmentEventStore } from './postgres-event-store';
import type { InvestmentEventStore } from '../application/event-store';
import type { InvestmentSqlClient, InvestmentTransactionContext, InvestmentUnitOfWork } from '../application/unit-of-work';

export interface InvestmentDatabase {
  transaction<T>(work: (tx: InvestmentSqlClient) => Promise<T>): Promise<T>;
}

export class PostgresInvestmentUnitOfWork implements InvestmentUnitOfWork {
  constructor(private readonly db: InvestmentDatabase, private readonly eventStore: InvestmentEventStore = new PostgresInvestmentEventStore(), private readonly audit?: TransactionalAuditRepository) {}
  transaction<T>(work: (context: InvestmentTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work({ tx, opportunities: new PostgresInvestmentOpportunityRepository(tx), decisions: new PostgresInvestmentDecisionRepository(tx), events: this.eventStore, audit: this.audit }));
  }
}
