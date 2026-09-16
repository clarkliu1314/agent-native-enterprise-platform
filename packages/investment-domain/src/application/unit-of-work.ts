import type {
  InvestmentDecisionRepository,
  InvestmentOpportunityRepository,
} from "./repositories";
import type { InvestmentEventStore } from "./event-store";

export interface InvestmentSqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface InvestmentTransactionContext {
  sql: InvestmentSqlClient;
  opportunities: InvestmentOpportunityRepository;
  decisions: InvestmentDecisionRepository;
  events: InvestmentEventStore;
  audit: InvestmentSqlClient;
}

export interface InvestmentUnitOfWork {
  run<T>(work: (context: InvestmentTransactionContext) => Promise<T>): Promise<T>;
}
