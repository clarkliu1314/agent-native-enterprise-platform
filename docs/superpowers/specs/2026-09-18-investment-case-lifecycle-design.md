# Investment Case Lifecycle Design

## 1. Goal

建立 Investment Case 作为“一个可持续推进的投资项目生命周期”的业务聚合，使投资机会可以进入正式项目管理、研究、分析、决策准备并持续推进，同时保持现有 Runtime、durability、permission、idempotency、outbox、audit 与 recovery 契约不变。

## 2. Scope

本阶段包含：

- Opportunity → InvestmentCase 的晋级关系。
- InvestmentCase 基础信息与业务生命周期。
- Research / Analysis task。
- Agent Workflow 驱动任务执行。
- Runtime WAITING 与 durable resume。
- InvestmentDecision 与 Case 的关联。
- Case 状态、Task、Domain Event、Audit、Outbox 在 PostgreSQL transaction 中保持一致。
- 复用现有 tenant / permission / idempotency / optimistic concurrency / audit / recovery 能力。
- 建立完整 Investment Case E2E business loop。

本阶段不包含：

- 交易执行。
- Broker 集成。
- Portfolio / holdings。
- 估值模型。
- 财报导入。
- 复杂 IC voting。

## 3. Architecture

目录边界：

```
packages/investment-domain/src/
├── domain/
│   ├── investment-case.ts
│   ├── investment-case-events.ts
│   └── ...
├── application/
│   ├── case-commands.ts
│   ├── case-queries.ts
│   ├── case-repositories.ts
│   ├── case-event-store.ts
│   ├── case-unit-of-work.ts
│   └── case-workflow-port.ts
├── persistence/
│   ├── postgres-case-repositories.ts
│   ├── postgres-case-event-store.ts
│   ├── postgres-case-unit-of-work.ts
│   └── schema.sql
└── workflow/
    └── case-workflow.ts
```

依赖方向：

```
Domain -> platform contracts only
Application -> Domain + ports
Persistence -> Application ports + Domain
Workflow -> Application workflow port + runtime contract
API -> Application / Workflow through composition root
```

InvestmentCase 不直接依赖 PostgreSQL、Redis 或具体 Agent Framework。

## 4. Domain Model

### 4.1 InvestmentCase

```
id
tenantId
opportunityId
name
description
status
previousStatus
decisionId
createdAt
updatedAt
version
```

Case status：

```
DRAFT
RESEARCHING
ANALYZING
DECISION_PENDING
APPROVED
REJECTED
ON_HOLD
```

Runtime status 仍严格保持：

```
QUEUED
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

两套状态机不得混用。特别是 Runtime WAITING 不会把 Case.status 设为 WAITING。

### 4.2 Domain invariants

1. Case 必须属于 tenant。
2. Case 必须关联已存在的 Opportunity。
3. 同一 tenant + opportunity 最多存在一个 Case；Case 进入终态后也不创建第二个并行 Case。
4. DRAFT → RESEARCHING 是研究启动的合法入口。
5. RESEARCHING → ANALYZING 只能在研究任务成功完成后发生。
6. ANALYZING → DECISION_PENDING 表示分析材料已形成。
7. DECISION_PENDING → APPROVED / REJECTED 通过 Decision 业务操作完成。
8. APPROVED / REJECTED 为终态，不允许重新进入研究。
9. ON_HOLD 保存进入 Hold 前的业务状态，并只能恢复到该业务状态。
10. 每次 Case 状态变化产生 durable domain event。
11. version 用于 optimistic concurrency，禁止并发 command 静默覆盖。
12. 技术 Run FAILED 不自动产生投资 REJECTED 结论。

## 5. Application Contract

Application commands：

```
CreateInvestmentCase
StartResearch
CompleteResearch
StartAnalysis
CompleteAnalysis
PutCaseOnHold
ResumeCase
AttachInvestmentDecision
```

Case repository port：

```ts
getById(tenantId: string, caseId: string): Promise<InvestmentCase | null>
getByOpportunityId(tenantId: string, opportunityId: string): Promise<InvestmentCase | null>
create(case: InvestmentCase): Promise<InvestmentCase>
save(case: InvestmentCase, expectedVersion: number): Promise<InvestmentCase>
```

Case workflow port：

```ts
startResearch(
  tenantId: string,
  caseId: string,
  taskId: string,
  idempotencyKey: string,
): Promise<{ runId: string }>

startAnalysis(
  tenantId: string,
  caseId: string,
  taskId: string,
  idempotencyKey: string,
): Promise<{ runId: string }>

resume(
  tenantId: string,
  caseId: string,
  taskId: string,
  runId: string,
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ runId: string }>
```

所有 mutation 必须先执行 fail-closed permission check，再执行 durable idempotency check，再进入 domain mutation。

## 6. Unit of Work and Durability

Case mutation 使用现有 InvestmentUnitOfWork 模式。

一个成功业务 mutation 必须在同一个 PostgreSQL transaction 中完成：

```
Case state
+ Domain Event
+ Audit
+ Outbox
```

任意一步失败全部 rollback。

Redis 仅用于 delivery / scheduling，不作为 Case、Task 或业务事件事实源。

## 7. Persistence Model

最小 Case 专属表：

### investment_cases

```
id
tenant_id
opportunity_id
name
description
status
previous_status
decision_id
version
created_at
updated_at
```

约束：

- primary key(id)
- unique(tenant_id, opportunity_id)
- version >= 1

### investment_case_events

```
id
tenant_id
case_id
aggregate_version
event_type
payload
occurred_at
```

约束：

- unique(tenant_id, case_id, aggregate_version)

### investment_case_tasks

```
id
tenant_id
case_id
task_type
status
run_id
idempotency_key
input
output
created_at
updated_at
```

Task status：

```
PENDING
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

Task 是业务执行意图，Run 是技术执行实例；task.run_id 关联平台 Runtime Run。

复用现有：

```
outbox_messages
idempotency_records
audit_records
```

## 8. Business Data Flow

Create：

```
API
 -> Permission
 -> Idempotency
 -> Opportunity lookup
 -> InvestmentCase.create
 -> PostgreSQL transaction
    -> Case
    -> Event
    -> Audit
    -> Outbox
 -> Commit
```

Research：

```
DRAFT
 -> StartResearch
 -> RESEARCHING
 -> ResearchTask
 -> Outbox
 -> CaseWorkflow
 -> RuntimeFacade
 -> Run
```

WAITING：

```
Case = RESEARCHING
Task = WAITING
Run = WAITING
```

Resume 是 durable application command，不直接操作 Redis：

```
ResumeCase
 -> Permission
 -> Idempotency
 -> expected version / run validation
 -> Runtime resume
```

完成：

```
Run SUCCEEDED
 -> Task SUCCEEDED
 -> Case RESEARCHING -> ANALYZING
 -> Event + Audit + Outbox
```

随后 Analysis 完成：

```
ANALYZING -> DECISION_PENDING
```

Decision 关联使用现有 InvestmentDecision，不复制 Decision aggregate。

## 9. Error Semantics

明确区分：

```
NotFound
Conflict
InvalidTransition
DuplicateIdempotencyKey
PermissionDenied
ValidationError
```

Optimistic concurrency：

```
expectedVersion=N
actualVersion!=N
=> Conflict
```

技术执行失败：

```
Run FAILED
Task FAILED
Case remains in current business state
```

除非有明确业务 command，否则不能把技术失败转换成 REJECTED。

PermissionDenied 时不修改 Case，不创建 workflow-triggering outbox，不产生业务状态副作用。

Idempotency 必须覆盖 HTTP retry、Worker retry、Outbox redelivery、Recovery redelivery。

## 10. Crash Recovery

如果 PostgreSQL transaction 已 commit 而 Worker 随后 crash：

```
PostgreSQL
 -> Case
 -> Task
 -> Event
 -> Outbox
```

Recovery 根据 durable state 重建 delivery。

Redis 丢失不应导致 Case 丢失或要求重新创建。

如果 Worker 在副作用完成后、ACK 前 crash，重复 delivery 必须通过现有 durable idempotency / execution semantics 避免重复业务效果。

## 11. E2E Acceptance Criteria

### E2E-01 Create Case

Given Opportunity exists and actor has permission.

Then:

- Case exists in PostgreSQL。
- status = DRAFT。
- exactly one CaseCreated event。
- Audit exists。
- exactly one logical Outbox trigger。

### E2E-02 Start Research

Given Case = DRAFT.

Then:

- Case = RESEARCHING。
- ResearchTask exists。
- Task references the workflow request。
- workflow-triggering Outbox exists。

### E2E-03 WAITING

Given ResearchTask is running.

When workflow requires external input.

Then:

- Run = WAITING。
- Task = WAITING。
- Case remains RESEARCHING。
- Case.status is never WAITING。

### E2E-04 Resume

Given Run = WAITING.

When ResumeCase is submitted once or retried with the same idempotency key.

Then:

- the same logical Run resumes。
- no duplicate Task。
- no duplicate business event。
- no duplicate logical side effect。

### E2E-05 Research Completion

Given ResearchTask is running.

When Run succeeds.

Then:

- Run = SUCCEEDED。
- Task = SUCCEEDED。
- Case = ANALYZING。
- completion event exists。
- next-stage Outbox exists。

### E2E-06 Decision Association

Given Case = DECISION_PENDING and InvestmentDecision exists.

When AttachInvestmentDecision executes.

Then:

- Case durably references Decision。
- Audit exists。
- repeated identical command is idempotent。
- conflicting duplicate is rejected。

### E2E-07 Tenant Isolation

Given Case belongs to tenant A.

When tenant B attempts mutation.

Then:

- PermissionDenied。
- Case unchanged。
- no workflow-triggering side effect。

### E2E-08 Idempotency

Repeated command with same tenant + operation + idempotency key produces one logical business effect and returns the original logical result。

### E2E-09 Concurrent Mutation

Two commands use the same expected Case version.

Then exactly one mutation succeeds and the other receives Conflict；final version increments once。

### E2E-10 Crash Recovery

After durable transaction commit, simulate worker crash / delivery-state loss.

Then Recovery reconstructs delivery and the Case/Task remain durable without duplicate business effect。

## 12. Hard Gates

Implementation is complete only when:

- Domain lifecycle invariants pass。
- Application ports and UoW pass。
- PostgreSQL durability and constraints pass。
- Event + Audit + Outbox transaction coupling passes。
- Permission is fail-closed。
- Idempotency is durable。
- Optimistic concurrency passes。
- Workflow/Runtime separation passes。
- WAITING / Resume passes。
- Crash recovery passes。
- Full Case E2E passes。
- Existing Runtime FSM semantics remain unchanged。
- Existing platform 64-case benchmark hard gate remains unchanged。
- Full CI is green。

本项目不通过修改既有 Benchmark hard gate 来获得通过；Investment Case E2E 作为新的业务纵向验证。

## 13. Non-goals and Future Extension

本阶段不引入交易、Portfolio、Broker、估值、财报导入和复杂 IC voting。

后续可以在同一 Case 生命周期上增加独立 bounded capabilities，但不得绕过 Case/Application/Workflow/Runtime 的既定边界。
