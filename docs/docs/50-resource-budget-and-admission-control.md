# 资源预算、准入控制与过载保护

## 1. 目标

`dsh-military` 以成功率优先，允许 General、参谋、Worker、工兵和研究 Agent 使用 Thinking，但“优先质量”不等于“无限计算”。资源预算的目的不是单纯压低费用，而是防止并发失控、无信息增益重试、Radio 循环、上下文膨胀和外部 API 风暴破坏任务质量与宿主稳定性。

预算由 Harness 强制，模型只能提出追加资源请求。

## 2. 四级预算

```text
Deployment Budget
  └── Tenant/User Budget
        └── Mission Budget
              └── Direction/Wave/Task Budget
```

下级预算不能扩大上级预算。有效预算是所有适用层级的最小剩余额度。

机器契约见 [`resource-budget-policy.schema.json`](../schemas/resource-budget-policy.schema.json)。

## 3. 计量维度

至少计量：

- 模型请求次数；
- 输入、输出和 reasoning Token；
- 并发 Agent 与并发工具；
- Wall-clock 执行时间；
- 工具调用和失败调用；
- Radio 请求、指导和重复求援；
- Task rework、Candidate 和验证次数；
- Enterprise API 请求与响应字节；
- Workspace、Artifact 和日志存储字节；
- Compaction、handoff 和恢复次数；
- Tactical ingestion 与 Evaluation dataset 大小。

价格只是可选投影，预算的权威计量使用提供方 usage、持久事件和 Harness 计数器。

## 4. 准入顺序

创建任何昂贵工作前执行：

```text
Authorization
→ Preset/Role eligibility
→ Compatibility probe
→ Budget reservation
→ Concurrency admission
→ Workspace/API lease
→ Publish work
```

预算采用 reservation，而不是执行后才统计。完成后按实际 usage 结算并释放未使用部分；进程崩溃后根据 lease expiry 与 durable receipt 回收。

## 5. 并发和背压

每个队列分别限制：

- General 用户轮次；
- Staff consultation；
- Worker execution；
- Verification；
- Radio advice；
- Engineer integration/specs；
- Tactical research；
- Performance evaluation。

Verifier、Radio 和 Integration 是系统关键瓶颈，不能因为大量 Worker 已就绪而无限排队。调度器使用 weighted fair queue，交互式用户决策和安全冻结高于推测性研究。

## 6. 无信息增益检测

以下情况消耗 retry budget，并可能提前停止：

- 相同输入、相同工具和相同错误重复出现；
- 新 Candidate 与上次内容哈希相同；
- Radio 请求没有新增 Evidence；
- Advisor 指导未改变可执行 Action；
- Compaction 后可用上下文没有有效下降；
- Worker 多次修改 Acceptance Contract 范围外内容；
- Museum 重复提出同一战术版本。

模型不能通过改写措辞重置计数；Harness 以结构化动作和 Artifact 哈希判定。

## 7. 预算耗尽处置

允许的权威处置：

```text
PAUSE_AND_REPORT
REQUIRE_USER_AUTHORIZATION
CANCEL_SPECULATIVE_TASKS
DEGRADE_NONCRITICAL_RESEARCH
REDUCE_CONCURRENCY
HANDOFF_GENERATION
TERMINATE_TASK
TERMINATE_MISSION
```

不得静默把 Thinking 关闭、替换为不合规模型、跳过 Verifier 或把未验收结果标为完成。

用户追加预算时生成 `UserAuthorizationReceipt` 和 `ChangeOrder`，明确额度、范围、有效期和风险。

## 8. 优先级和资源分配

推荐优先级：

1. 安全停止、冻结和恢复；
2. 用户待决问题；
3. 关键路径 Verification 与 Integration；
4. 已承诺 Wave 中的 Worker/Engineer；
5. Staff/Radio；
6. 非关键侦察；
7. Museum、批量提炼和绩效评估。

高优先级可以抢占尚未开始的低优先级工作，但不能丢弃已经产生的 durable Candidate、Evidence 或账务事实。

## 9. 预算与模型切换

General 在会话页面切换模型后：

- 新模型的 Token/请求/价格能力重新解析；
- 当前 Mission 剩余预算不自动扩大；
- 若模型最低上下文或 reasoning 不满足策略，切换拒绝；
- 已运行子代理不随 General 切换；
- 后续新子代理仍按冻结的 Department Template 路由。

## 10. WebUI

设置页展示预算策略；Mission Dashboard 展示：

- 已用、已预留、剩余和预测；
- 当前并发与队列等待；
- 最大消耗方向/模板；
- 即将触发的阈值；
- 追加授权入口；
- 预算耗尽后的处置历史。

不应只显示货币，避免把没有价格信息的本地模型误认为无限资源。

## 11. SLO

建议：

- reservation 决策 p95 < 50 ms；
- 崩溃 lease 回收在两个 heartbeat interval 内；
- 不发生负余额提交；
- 同一 usage receipt 不重复计费；
- Budget exhaustion 100% 产生 durable disposition；
- Standard Session 不计入 Military Mission 预算。

## 12. 验收条件

- 所有昂贵操作执行前有 reservation；
- Agent 无法自行重置预算或并发计数；
- 预算耗尽不降低验证和安全边界；
- 用户追加预算可追溯且有范围；
- 无信息增益循环会停止；
- 崩溃后 reservation 可恢复或回收；
- 不同 tenant/Mission 的预算互不串扰。

## 13. Reservation 与 Usage Receipt

预算策略本身不代表可用额度。每个昂贵操作开始前必须创建 [`ResourceBudgetReservation`](../schemas/resource-budget-reservation.schema.json)：

```text
policy revision + scope + requested counters
→ hierarchy check
→ CAS reserve
→ granted counters + expiry
→ operation admission
```

操作结束、取消或崩溃恢复后，以 [`ResourceUsageReceipt`](../schemas/resource-usage-receipt.schema.json) 结算实际消耗和 overage。相同 `idempotencyKey` 只能计入一次。终态为：

```text
RESERVED → SETTLED | EXPIRED | REVOKED
REJECTED 为直接终态
```

未取得 reservation 的模型请求、批量评估、战术提炼或新增子代理必须在副作用前拒绝。结算失败进入 recovery queue，不允许通过删除 reservation 来伪造余额恢复。
