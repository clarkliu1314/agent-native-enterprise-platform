import type { TransactionalAuditRepository } from '@agent-native/runtime';
import type { InvestmentSqlClient } from './event-store';
import type { InvestmentCaseEventStore } from './case-event-store';
import type { InvestmentCaseRepository, InvestmentCaseTaskRepository } from './case-repositories';
import type { InvestmentOpportunityRepository, InvestmentDecisionRepository } from './repositories';

export interface InvestmentCaseTransactionContext {
  tx: InvestmentSqlClient;
  cases: InvestmentCaseRepository;
  tasks: InvestmentCaseTaskRepository;
  opportunities: InvestmentOpportunityRepository;
  decisions: InvestmentDecisionRepository;
  events: InvestmentCaseEventStore;
  audit?: TransactionalAuditRepository;
}
export interface InvestmentCaseUnitOfWork {
  transaction<T>(work: (context: InvestmentCaseTransactionContext) => Promise<T>): Promise<T>;
}
