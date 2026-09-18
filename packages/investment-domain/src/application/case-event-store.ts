import type { InvestmentSqlClient } from './event-store';
import type { InvestmentCaseEvent } from '../domain/investment-case-events';
export interface InvestmentCaseEventStore {
  append(tx: InvestmentSqlClient, event: InvestmentCaseEvent): Promise<void>;
}
