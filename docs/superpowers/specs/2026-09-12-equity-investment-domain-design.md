# Equity Investment Domain — Vertical Slice Design

## Status

Approved design for Stage 10. The first implementation is intentionally a minimal, complete equity-investment vertical slice rather than a full PE/VC system.

## Goal

Prove that Architecture A can host a real enterprise business workflow whose business state is durable, recoverable, idempotent, auditable, and human-approval aware.

## Architectural Boundary

```text
Investment Domain
  -> Application Service / Workflow
  -> RuntimeFacade / Durable Runtime
  -> PostgreSQL + Idempotency + Tool Runtime + Outbox
```

The investment domain owns business invariants. The durable runtime owns agent execution, leases, checkpoints, recovery, tool safety, and delivery. Agent frameworks remain adapters behind the runtime contract.

Application code must depend on `@agent-native/runtime-contract` and domain interfaces, not framework-specific runtime semantics.

## Vertical Slice

```text
Create Opportunity
  -> Start durable Agent Run
  -> Company Research
  -> Due Diligence
  -> Investment Analysis
  -> IC Recommendation
  -> WAITING / Human Approval
       -> APPROVE -> Investment Decision
       -> REJECT  -> Investment Decision
  -> Business Events + Audit Trail + Outbox
```

## Aggregate: InvestmentOpportunity

Required fields:

- `opportunityId`
- `tenantId`
- `companyId`
- `companyName`
- `stage`
- `status`
- `ownerId`
- `createdAt`
- `updatedAt`
- `version`

Lifecycle:

```text
DRAFT -> SCREENING -> DUE_DILIGENCE -> IC_REVIEW -> APPROVED | REJECTED
```

Agents cannot mutate this lifecycle directly. Every state-changing operation is a domain command validated by the application service.

## Aggregate: InvestmentDecision

The decision is a durable business fact and must be unique for the applicable decision cycle.

Invariant:

```text
one opportunity + one decision cycle = at most one InvestmentDecision
```

The decision command is idempotent. Repeated commands with the same business idempotency key replay the original result; a conflicting command hash is rejected.

## Domain Commands

- `CreateOpportunity`
- `AdvanceOpportunityStage`
- `RequestIcApproval`
- `ApproveInvestment`
- `RejectInvestment`
- `CreateInvestmentDecision`

Commands that change durable business state execute through a transaction boundary that also records the business event and outbox message.

## Domain Events

At minimum:

- `OpportunityCreated`
- `OpportunityStageAdvanced`
- `IcApprovalRequested`
- `InvestmentApproved`
- `InvestmentRejected`
- `InvestmentDecisionCreated`

Every event is attributable to tenant, actor/agent, opportunity, and command/idempotency context.

## Agent Workflow Contract

The workflow may perform analysis and read-oriented research, but it does not own the business aggregate.

```text
research -> due diligence -> analysis -> recommendation -> request approval
```

The workflow must be restartable from durable runtime state. Recovery must re-enter the normal Permission -> Idempotency -> Tool Execution -> Outbox path.

## Tool Catalog

| Tool | Kind | Business side effect |
|---|---|---|
| `company.lookup` | PURE | none |
| `company.financials` | PURE | none |
| `due_diligence.run` | PURE | none in the vertical slice; deterministic mock/external read |
| `investment_analysis.generate` | ANALYSIS | none |
| `ic.recommend` | PURE | none |
| `opportunity.advance_stage` | SIDE_EFFECTING | opportunity lifecycle |
| `investment_decision.create` | SIDE_EFFECTING | creates decision |

Side-effecting tools must pass Permission -> Idempotency before effect. Business commands remain the authoritative write boundary.

## Persistence Boundary

Business tables belong to the investment domain and are PostgreSQL-backed. The runtime tables remain owned by `packages/durability`.

The first slice should add only the business tables required to prove the workflow:

- `investment_opportunities`
- `investment_decisions`
- `investment_events` or an equivalent business-event projection/table if required by existing repository conventions

Business state, business event, and outbox insertion must commit atomically for state-changing commands.

## Crash / Recovery Hard Gate

The implementation is not complete unless these scenarios pass:

1. crash before research: run restarts safely;
2. crash during due diligence: no duplicate business side effect;
3. crash after IC recommendation: recommendation remains durable/replayable;
4. crash around `WAITING`: human approval resumes the same run;
5. duplicate approval: exactly one decision;
6. crash after business state write but before outbox publish: transaction leaves consistent state and outbox record;
7. duplicate outbox delivery: consumer is idempotent;
8. expired worker lease: another worker recovers using fencing without stale-writer corruption.

## Non-Goals

The first slice does not implement portfolio management, fund accounting, cap tables, term-sheet negotiation, legal document management, full financial modeling, or production external-data integrations.

## Acceptance Invariants

- No Agent adapter can bypass the domain write boundary.
- Every externally effectful tool call is authorized and idempotent.
- Replaying a recovered run cannot create a second investment decision.
- Business state and its outbox event are transactionally consistent.
- Human approval is represented as a durable wait, not process memory.
- The domain can be exercised through the same durable runtime used by the rest of the platform.
