import type { InvestmentDomainEvent } from '../domain/events';
import type { InvestmentEventStore, InvestmentSqlClient } from '../application/event-store';

export type { InvestmentEventStore } from '../application/event-store';

function json(value: unknown): string { return JSON.stringify(value); }

export class PostgresInvestmentEventStore implements InvestmentEventStore {
  constructor(private readonly options: { failOutbox?: boolean } = {}) {}

  async append(tx: InvestmentSqlClient, event: InvestmentDomainEvent): Promise<void> {
    await tx.query(
      `INSERT INTO investment_events
         (event_id, tenant_id, opportunity_id, actor_id, idempotency_key, event_type, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [event.eventId, event.tenantId, event.opportunityId, event.actorId, event.idempotencyKey, event.type, json(event), event.occurredAt],
    );

    if (this.options.failOutbox) throw new Error('forced outbox failure');

    await tx.query(
      `INSERT INTO outbox_events
         (outbox_id, event_id, topic, payload, idempotency_key, event_type, tenant_id, actor_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
      [`investment-outbox:${event.eventId}`, event.eventId, 'investment.business', json(event), event.idempotencyKey, event.type, event.tenantId, event.actorId],
    );
  }
}
