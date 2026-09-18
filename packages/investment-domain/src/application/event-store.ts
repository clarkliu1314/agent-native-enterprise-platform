import type { InvestmentDomainEvent } from '../domain/events';

export interface InvestmentSqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{
    rows: T[];
    rowCount: number;
  }>;
}

export interface InvestmentEventStore {
  append(tx: InvestmentSqlClient, event: InvestmentDomainEvent): Promise<void>;
}
