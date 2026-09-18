import type { TransactionalAuditRepository } from '@agent-native/runtime';
import type { InvestmentDecisionRepository, InvestmentOpportunityRepository } from './repositories';
import type { InvestmentEventStore, InvestmentSqlClient } from './event-store';

export interface InvestmentTransactionContext {
  tx: InvestmentSqlClient;
  opportunities: InvestmentOpportunityRepository;
  decisions: InvestmentDecisionRepository;
  events: InvestmentEventStore;
  audit?: TransactionalAuditRepository;
}

export interface InvestmentUnitOfWork {
  transaction<T>(work: (context: InvestmentTransactionContext) => Promise<T>): Promise<T>;
}
