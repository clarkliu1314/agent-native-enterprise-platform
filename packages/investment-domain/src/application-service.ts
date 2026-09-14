import { randomUUID } from 'node:crypto';
import type { ApproveInvestmentCommand, AdvanceOpportunityStageCommand, CreateOpportunityCommand, RejectInvestmentCommand } from './commands';
import { decisionIdempotencyKey, createInvestmentDecision, type InvestmentDecision } from './investment-decision';
import { PostgresInvestmentDecisionRepository, PostgresInvestmentOpportunityRepository } from './postgres-repositories';
import type { InvestmentEventStore } from './event-store';
import { PostgresInvestmentEventStore } from './event-store';
import type { InvestmentDomainEvent } from './events';
import type { InvestmentDecisionRepository, InvestmentOpportunityRepository } from './repositories';
import { advanceOpportunityStage, type InvestmentOpportunity } from './opportunity';
import type { AuditRecord, TransactionalAuditRepository } from '@agent-native/runtime';

export interface InvestmentSqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface InvestmentDatabase { transaction<T>(work: (tx: InvestmentSqlClient) => Promise<T>): Promise<T>; }
export interface InvestmentTransactionContext { opportunities: InvestmentOpportunityRepository; decisions: InvestmentDecisionRepository; events: InvestmentEventStore; audit?: TransactionalAuditRepository; tx: InvestmentSqlClient; }
export interface InvestmentUnitOfWork { transaction<T>(work: (context: InvestmentTransactionContext) => Promise<T>): Promise<T>; }

export class PostgresInvestmentUnitOfWork implements InvestmentUnitOfWork {
  constructor(
    private readonly db: InvestmentDatabase,
    private readonly eventStore: InvestmentEventStore = new PostgresInvestmentEventStore(),
    private readonly audit?: TransactionalAuditRepository,
  ) {}
  transaction<T>(work: (context: InvestmentTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work({ tx, opportunities: new PostgresInvestmentOpportunityRepository(tx), decisions: new PostgresInvestmentDecisionRepository(tx), events: this.eventStore, audit: this.audit }));
  }
}
function now(commandNow?: string): string { return commandNow ?? new Date().toISOString(); }
function decisionConflict(existing: InvestmentDecision, command: ApproveInvestmentCommand | RejectInvestmentCommand): Error | null {
  if (existing.opportunityId !== command.opportunityId || existing.tenantId !== command.tenantId || existing.decisionCycle !== command.decisionCycle || existing.recommendation !== command.recommendation || existing.rationale !== command.rationale) return new Error(`Investment decision idempotency conflict: ${command.idempotencyKey}`);
  return null;
}
function investmentAudit(input: {
  auditId: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
  requestId?: string;
  traceId?: string;
  metadata: Record<string, string | number | boolean | null>;
}): AuditRecord {
  return {
    auditId: input.auditId,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    actorType: 'USER',
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: 'SUCCEEDED',
    reasonClass: 'NONE',
    correlation: {
      requestId: input.requestId ?? input.auditId,
      traceId: input.traceId ?? input.auditId,
      ...(input.resourceType === 'INVESTMENT_OPPORTUNITY' ? { workflowId: undefined } : {}),
    },
    metadata: input.metadata,
  };
}

export class InvestmentApplicationService {
  constructor(private readonly uow: InvestmentUnitOfWork) {}
  async createOpportunity(command: CreateOpportunityCommand): Promise<InvestmentOpportunity> {
    return this.uow.transaction(async ({ opportunities, events, audit, tx }) => {
      const existing = await opportunities.get(command.tenantId, command.opportunityId);
      if (existing) return existing;
      const timestamp = now(command.now);
      const opportunity: InvestmentOpportunity = { opportunityId: command.opportunityId, tenantId: command.tenantId, companyId: command.companyId, companyName: command.companyName, stage: 'DRAFT', status: 'ACTIVE', ownerId: command.ownerId, createdAt: timestamp, updatedAt: timestamp, version: 1 };
      const persisted = await opportunities.create(opportunity);
      await events.append(tx, { type: 'OpportunityCreated', eventId: randomUUID(), tenantId: command.tenantId, opportunityId: command.opportunityId, actorId: command.actorId, idempotencyKey: command.idempotencyKey, occurredAt: timestamp, companyId: command.companyId });
      if (audit) await audit.appendInTransaction(tx, investmentAudit({ auditId: `audit:investment:${command.opportunityId}:CREATED:1`, tenantId: command.tenantId, actorId: command.actorId, action: 'OPPORTUNITY_CREATED', resourceType: 'INVESTMENT_OPPORTUNITY', resourceId: command.opportunityId, occurredAt: timestamp, requestId: command.idempotencyKey, traceId: command.idempotencyKey, metadata: { resultingStage: 'DRAFT', version: 1 } }));
      return persisted;
    });
  }
  async advanceStage(command: AdvanceOpportunityStageCommand): Promise<InvestmentOpportunity> {
    return this.uow.transaction(async ({ opportunities, events, audit, tx }) => {
      const current = await opportunities.get(command.tenantId, command.opportunityId);
      if (!current) throw new Error(`Investment opportunity not found: ${command.opportunityId}`);
      if (current.version !== command.expectedVersion) throw new Error(`Investment opportunity version conflict: ${command.opportunityId} expected version ${command.expectedVersion}`);
      const updated = advanceOpportunityStage(current, command.nextStage);
      await opportunities.save(updated, command.expectedVersion);
      const timestamp = now(command.now);
      await events.append(tx, { type: 'OpportunityStageAdvanced', eventId: randomUUID(), tenantId: command.tenantId, opportunityId: command.opportunityId, actorId: command.actorId, idempotencyKey: command.idempotencyKey, occurredAt: timestamp, from: current.stage, to: updated.stage });
      if (audit) await audit.appendInTransaction(tx, investmentAudit({ auditId: `audit:investment:${command.opportunityId}:STAGE:${updated.version}`, tenantId: command.tenantId, actorId: command.actorId, action: 'OPPORTUNITY_STAGE_ADVANCED', resourceType: 'INVESTMENT_OPPORTUNITY', resourceId: command.opportunityId, occurredAt: timestamp, requestId: command.idempotencyKey, traceId: command.idempotencyKey, metadata: { fromStage: current.stage, resultingStage: updated.stage, version: updated.version } }));
      return updated;
    });
  }
  approve(command: ApproveInvestmentCommand): Promise<InvestmentDecision> { return this.decide(command, 'APPROVE'); }
  reject(command: RejectInvestmentCommand): Promise<InvestmentDecision> { return this.decide(command, 'REJECT'); }
  private async decide(command: ApproveInvestmentCommand | RejectInvestmentCommand, recommendation: 'APPROVE' | 'REJECT'): Promise<InvestmentDecision> {
    const expectedKey = decisionIdempotencyKey(command.opportunityId, command.decisionCycle);
    if (command.idempotencyKey !== expectedKey) throw new Error(`Investment decision idempotency key mismatch: expected ${expectedKey}`);
    return this.uow.transaction(async ({ opportunities, decisions, events, audit, tx }) => {
      const existing = await decisions.getByIdempotencyKey(command.tenantId, command.idempotencyKey);
      if (existing) { const conflict = decisionConflict(existing, command); if (conflict) throw conflict; return existing; }
      const current = await opportunities.get(command.tenantId, command.opportunityId);
      if (!current) throw new Error(`Investment opportunity not found: ${command.opportunityId}`);
      const nextStage = recommendation === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = advanceOpportunityStage(current, nextStage);
      const decision = createInvestmentDecision({ decisionId: randomUUID(), opportunityId: command.opportunityId, tenantId: command.tenantId, decisionCycle: command.decisionCycle, recommendation, rationale: command.rationale, createdAt: now(command.now) });
      const persisted = await decisions.create(decision, command.idempotencyKey);
      await opportunities.save(updated, current.version);
      const event: InvestmentDomainEvent = recommendation === 'APPROVE'
        ? { type: 'InvestmentApproved', eventId: randomUUID(), tenantId: command.tenantId, opportunityId: command.opportunityId, actorId: command.actorId, idempotencyKey: command.idempotencyKey, occurredAt: decision.createdAt, decisionId: persisted.decisionId }
        : { type: 'InvestmentRejected', eventId: randomUUID(), tenantId: command.tenantId, opportunityId: command.opportunityId, actorId: command.actorId, idempotencyKey: command.idempotencyKey, occurredAt: decision.createdAt, decisionId: persisted.decisionId };
      await events.append(tx, event);
      if (audit) await audit.appendInTransaction(tx, investmentAudit({ auditId: `audit:investment:${command.opportunityId}:DECISION:${command.decisionCycle}`, tenantId: command.tenantId, actorId: command.actorId, action: recommendation === 'APPROVE' ? 'INVESTMENT_APPROVED' : 'INVESTMENT_REJECTED', resourceType: 'INVESTMENT_OPPORTUNITY', resourceId: command.opportunityId, occurredAt: decision.createdAt, requestId: command.idempotencyKey, traceId: command.idempotencyKey, metadata: { decisionCycle: command.decisionCycle, resultingStage: updated.stage } }));
      return persisted;
    });
  }
}
