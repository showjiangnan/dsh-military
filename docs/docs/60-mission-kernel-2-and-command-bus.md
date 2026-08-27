# 60. Mission Kernel 2.0 与单写者 Command Bus

## 1. 决策

每个 Mission 以 `tenantId + missionId` 为串行化分区键，由一个 Mission Kernel 独占权威写入。General、Staff、Worker、Engineer、Verifier、Radio、Oversight 和 Research 只能提交 Command；它们不能直接改变 Task、Wave、Budget、Lease、Candidate 或 Integration 的权威状态。

```text
Command
→ authority check
→ budget reservation
→ revision/state validation
→ domain events
→ durable activity/outbox
→ projection commit
```

## 2. Command Envelope

每个 Command 必须携带：

- `commandId` 与 `idempotencyKey`；
- `tenantId`、`missionId`、`expectedRevision`；
- actor 的 `AuthorityContext`；
- 可选 `taskId`、`taskVersion`、`activationId`；
- 结构化 payload；
- deadline 与 cancellation provenance。

同一幂等键但 payload hash 不同必须拒绝，不能把语义不同的操作误判为重试。

## 3. 双日志边界

```text
Military Mission Ledger = Mission 领域事实真源
DSH Session Log         = 会话、模型可见历史和 UI 投影真源
```

Mission Event 可以通过 Session Projection Adapter 镜像为 `ignorable: true` 的 Military Session Event；Session Event 不能反向独立推动 Mission 状态。

## 4. Activity 与外部副作用

Git、Workspace、模型 Activation、企业 API、Artifact、Integration 和 specs commit 通过 Durable Activity 执行。Mission Event 记录业务决定，Activity Store 记录精确句柄、attempt、lease、receipt 和补偿状态。

## 5. 恢复

进程启动时按以下顺序恢复：

1. 校验数据库 migration；
2. 重放 Mission Ledger；
3. 重建 Projection；
4. 加载未完成 Activity；
5. 对账 DSH Session/Child、Workspace、Git 和 Artifact；
6. 对可重试 Activity 重新投递；
7. 对不确定副作用进入 `RECONCILIATION_REQUIRED`。

## 6. 不变量

- 同一 Mission revision 只允许一个成功写者；
- Event 和 Outbox 在同一事务提交；
- 接受 Candidate 的 Event 必须引用独立 Verification Receipt；
- Integration Receipt 产生前，Task 不得成为 `INTEGRATED`；
- Session 镜像失败不能回滚已提交 Mission 事实，但必须进入可重试 Outbox；
- FROZEN Activation 不能获得新的写 Activity。
