# Agent-native 企业系统项目评估报告与行动计划

> 日期：2026-09-11  
> 分支：`feat/16-case-benchmark`  
> 最新已验证基线：CI Run #226 通过  
> 本文只记录已经形成证据或已经明确的判断；“已实现”与“生产集成”严格区分。

## 1. 执行摘要

当前工程已经完成 Agent-native 底座的第一轮骨架建设，十个主阶段中约八个阶段已经形成可运行、可测试或可验证的成果。当前最重要的结论不是“功能数量已经很多”，而是平台已经建立了几个正确的长期边界：Agent Framework 不等于 Agent Runtime；运行状态、工具执行安全、幂等、Outbox、恢复和持久化属于平台核心；Vercel 只承担请求边界；框架通过统一 Adapter Contract 接入。

当前 CI Run #226 已通过，Benchmark Artifact 中包含 64 个 case-adapter 组合，摘要为 `total=64, passed=64, failed=0`。但这 64/64 主要证明当前确定性 Benchmark 执行器及其安全契约成立，并不等价于“64 个真实 PostgreSQL/多 Worker/真实框架 SDK 场景已经全部生产级通过”。

因此当前工程成熟度建议按以下三个维度理解：

- **平台核心设计与契约：约 90%**
- **可验证的工程实现：约 80%**
- **生产级端到端就绪度：约 60%–65%**

最大的剩余风险集中在四项：真实 PostgreSQL 恢复 Benchmark、真实并发 Worker、Benchmark Hard Gate、四个真实 Agent Framework SDK Adapter。

## 2. 十阶段总体状态

| 阶段 | 当前状态 | 评估 | 关键说明 |
|---|---|---:|---|
| 1 Runtime Contract | 已完成 | 95%–100% | 稳定应用契约、生命周期、取消、checkpoint/recovery 已建立 |
| 2 In-memory Runtime | 已完成 | 95% | 作为参考实现和测试基准 |
| 3 Durable Persistence | 基本完成 | 90% | PostgreSQL durable store 已存在并有集成测试 |
| 4 Permission/Idempotency/Outbox | 基本完成 | 90%–95% | 核心安全边界已落地；仍需生产运营增强 |
| 5 Crash Recovery | 核心完成 | 85%–90% | recovery store/lease/reclaim/backoff/terminal failure 已实现；Benchmark 尚未完全接入真实数据库 |
| 6 四框架 Adapter | 契约完成 | 约 30% 生产集成 | 当前是 reference adapters，不是四个真实 SDK 的完整运行时集成 |
| 7 16-case Benchmark | 可执行第一版 | 70%–75% | 16 cases、64 matrix、runner、artifact、B09–B16 确定性场景已存在；真实 PostgreSQL/concurrency/hard gate 待补 |
| 8 Docker Compose | 完成当前边界 | 95% | PostgreSQL、Redis、migration/seed、worker/benchmark smoke、CI compose smoke 已完成 |
| 9 Vercel Boundary | 完成 | 95%–100% | 无状态 API boundary、LLM gateway、配置及静态安全约束已完成 |
| 10 CI/Verification | 基础完成 | 80%–85% | Run #226 绿；Benchmark hard gate、merge protection、format/lint 等仍可强化 |

## 3. 已经形成的核心技术资产

### 3.1 Runtime Contract

应用层依赖统一 Runtime Contract，而不是依赖具体 Agent Framework。这样可以避免业务逻辑被 AgentScope、LangGraph、Eino 或 Mastra 的生命周期和 API 锁死。

### 3.2 Durable Runtime

平台核心负责 Run、Turn、Tool Execution、Checkpoint、Recovery、Cancellation 等持久化生命周期。内存实现只作为参考实现，不承担生产真相。

### 3.3 Tool Permission

工具调用采用显式授权与默认拒绝原则。权限检查位于工具真正产生外部效果之前，而不是在 Agent Framework 层依赖约定。

### 3.4 Idempotency

外部有副作用的工具必须具有幂等语义。当前实现已经进一步考虑 tenant/tool scope、重复请求、结果 replay、single-flight 等边界。

### 3.5 Outbox

状态/结果与 Outbox 的写入具有明确事务边界。Publisher 负责发布，重复 delivery 由消费侧幂等语义兜底。

### 3.6 Crash Recovery

恢复模型包括候选发现、`FOR UPDATE SKIP LOCKED` claim、lease owner/token、lease renewal、expired reclaim、retry/backoff、terminal classification。恢复以持久化状态为真相，而不是依赖请求进程仍然存活。

### 3.7 Deployment Boundary

Vercel/API 只做认证、参数验证、调用 Runtime Contract、读取 durable state 和返回 accepted/completed。长时间执行、recovery lease、Outbox publisher、Worker coordination 不放入 request lifetime。

## 4. 当前最关键的 P0 遗留项

### P0-1：真实 PostgreSQL B09–B13

把 crash-after-claim、crash-during-tool、result-before-outbox、outbox-before-ack、expired-lease-reclaim 从确定性 scenario store 提升为真实 PostgreSQL transaction/lease 测试。

**完成标准：** CI 能在真实 PostgreSQL service 上重复执行；SQL assertions 能证明 crash 前后状态、lease、idempotency、outbox 和 business effect 一致。

### P0-2：真实 PostgreSQL B14–B16

B14/B15 需要验证 durable retry/backoff 和 terminal failure；B16 必须使用两个或更多真实 worker 竞争同一 durable record，并证明只有一个 worker 获得有效 lease/业务效果。

**完成标准：** 多 Worker 并发运行稳定通过，且重复执行不会制造第二个 business effect。

### P0-3：Benchmark Hard Gate

当前 Artifact 上传发生在 Test 成功之后，尚不能把 Benchmark 本身作为独立安全门槛。

**完成标准：** CI 独立检查 `total=64`、`passed=64`、`failed=0`，并检查所有 permission/idempotency/outbox safety invariant；任何违反均阻断合并。

### P0-4：真实四框架 SDK Adapter

当前四个 Adapter 主要是 reference adapter。下一阶段需要分别接入实际 SDK，同时严格保持 Runtime Contract 不被框架反向污染。

**完成标准：** 四个真实 Adapter 均能运行统一 contract tests，并进入同一 64 场景 Benchmark。

## 5. P1 遗留项

1. Observability：结构化日志、trace/span、run/tool/recovery correlation ID。
2. Event versioning：事件 schema version、兼容策略、migration policy。
3. Outbox DLQ：失败消息的隔离、人工 replay、最大重试策略。
4. Idempotency retention：TTL/归档策略、容量治理和审计要求。
5. Metrics/SLO：tool success rate、duplicate rate、recovery latency、outbox lag、lease contention。
6. Worker operational controls：concurrency limit、backpressure、graceful shutdown、drain。

## 6. P2 优化项

1. formatter/lint 合同与 CI enforcement。
2. OpenTelemetry 完整接入。
3. Dashboard 和 Benchmark 历史趋势。
4. HA、load test、chaos test、长期 soak test。
5. 更完整的 API error model、rate limiting、审计查询体验。
6. 性能优化与数据库索引/归档治理。

## 7. 推荐后续执行顺序

```text
同步主计划与知识库
    ↓
真实 PostgreSQL B09-B13
    ↓
真实 PostgreSQL B14-B16 + 多 Worker
    ↓
64 个真实 durable scenarios
    ↓
Benchmark Hard Gate
    ↓
AgentScope 真实 SDK Adapter
    ↓
LangGraph 真实 SDK Adapter
    ↓
Eino 真实 SDK Adapter
    ↓
Mastra 真实 SDK Adapter
    ↓
真实四框架 × 16 Case = 64 场景
    ↓
Observability / SLO / DLQ / Retention
    ↓
最终 CI / Merge Gate
    ↓
进入股权投资业务域
```

## 8. 进入业务域前的 Go/No-Go 门槛

在开始股权投资管理业务模型之前，至少必须满足：

- [ ] Runtime Contract 稳定且无业务域泄漏。
- [ ] PostgreSQL recovery scenarios 全部真实验证。
- [ ] B16 多 Worker 并发通过。
- [ ] 64 个真实 case-adapter 场景全部通过。
- [ ] Permission、Idempotency、Outbox 三类 invariant 为硬门槛。
- [ ] Vercel 与 Worker 的部署边界经过 CI 验证。
- [ ] Recovery/Outbox/Idempotency 已具备最小可观测性。
- [ ] Benchmark Artifact 可用于发布前回归比较。

## 9. 结论

当前阶段不应该继续堆业务功能。正确策略是先把 Agent-native 底座从“正确的设计 + 可运行参考实现”提升为“真实 durable runtime + 真实框架集成 + 可阻断发布的 Benchmark”。完成这些 P0 后，平台才真正具备承载企业级、强审计、强一致、长生命周期 Agent 业务的基础。
