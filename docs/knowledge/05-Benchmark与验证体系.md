# Benchmark 与验证体系

## 1. 为什么需要 Benchmark

Agent-native 企业系统的关键风险集中在失败路径：权限绕过、重复副作用、事务不一致、Worker 崩溃、lease 过期、重复 delivery、重试风暴和并发竞争。因此 Benchmark 必须验证系统不变量，而不只是验证返回值。

## 2. 16 个核心场景

| Case | 验证重点 |
|---|---|
| B01 | Permission allow |
| B02 | Permission deny |
| B03 | Permission scope mismatch |
| B04 | Idempotency duplicate |
| B05 | Idempotency conflict |
| B06 | Outbox atomic commit |
| B07 | Outbox publish retry |
| B08 | Duplicate delivery |
| B09 | Crash after claim |
| B10 | Crash during tool |
| B11 | Crash after result before outbox |
| B12 | Crash after outbox before ack |
| B13 | Expired lease reclaim |
| B14 | Retryable backoff |
| B15 | Terminal failure |
| B16 | Concurrent workers |

## 3. 64 场景矩阵

```text
16 Cases × 4 Adapters
= 64 case-adapter scenarios
```

统一 Adapter：AgentScope、LangGraph、Eino、Mastra。

统一安全不变量：Permission、Idempotency、Outbox。

## 4. Case 定义必须包含的字段

每个 Case 应包含：

1. fixture
2. initial state
3. Mock LLM/Tool
4. exact operation steps
5. SQL assertions
6. expected result
7. failure criteria
8. invariants
9. adapters

这样 Benchmark 可以从“人工演示”变成“机器可回归的规格”。

## 5. Runner

统一 Runner 暴露：

```ts
run(testCase, adapter): Promise<BenchmarkRunResult>
runAll(): Promise<BenchmarkRunResult[]>
```

`runAll()` 必须按固定 case 顺序和 adapter 顺序执行，保证 artifact deterministic。

## 6. Artifact

Benchmark report 使用 JSON schemaVersion 1，必须满足：

```text
total = 64
passed = 64
failed = 0
```

并且每个 `caseId:adapter` 组合只能出现一次，不能遗漏。

## 7. 当前验证层级

### Level 1：Contract

验证接口和状态语义。

### Level 2：Deterministic Scenario

使用确定性 fixture 验证复杂失败路径，当前 B01–B16 已有这一层能力。

### Level 3：Real PostgreSQL

验证真实 transaction、lock、lease、idempotency、outbox 和 recovery。B09–B16 需要继续强化这一层。

### Level 4：Real Framework SDK

真实 AgentScope、LangGraph、Eino、Mastra 接入后运行相同矩阵。

### Level 5：Concurrent/Chaos/Soak

验证真实 Worker 竞争、进程重启、网络异常、长期运行和资源压力。

## 8. Hard Gate 规则

最终 CI 应独立执行 benchmark gate，而不是把 artifact 上传作为测试成功的副产品。

建议：

```text
benchmark command
    ↓
parse JSON
    ↓
assert schemaVersion == 1
assert total == 64
assert passed == 64
assert failed == 0
assert invariant violations == 0
    ↓
non-zero exit => block merge
```

## 9. 结果解释规则

“64/64 passed”必须同时注明测试层级。例如：

- deterministic 64/64：说明场景语义和执行器正确。
- real PostgreSQL 64/64：说明 durable infrastructure 也通过。
- real SDK 64/64：说明框架集成也通过。
- production concurrency/chaos 64/64：才接近完整生产验证。

严禁把低层级测试结果直接表述成高层级生产结论。
