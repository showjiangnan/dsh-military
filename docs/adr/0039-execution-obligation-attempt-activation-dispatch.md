# ADR-0039：执行义务、Attempt、Activation 与 Dispatch 分离

**状态：Accepted**

## 背景

Session 存在、Task 处于非终态、子 Agent 曾经启动，三者都不能证明当前调用仍在
运行。旧实现从 Mission 中扫描任意 open Task，并把 Rework、指导继续和快照恢复
复用为同一个 Task/Session 状态，容易造成请求错配、假 `RUNNING` 和终态后重派遣。

## 决策

- 每条执行型用户消息创建独立 `WorkflowObligation`，绑定 request hash、Mission、
  当前阶段、唯一下一工具和 wake cursor。
- `Task Version` 只表示 objective/scope/acceptance 等权威指令变化。
- 每次初始执行、Rework、Guidance 或 Decision continuation 创建新的
  `TaskExecutionAttempt`、`AgentActivation` 和 `DispatchRecord`。
- durable start/heartbeat receipt 才能把 Activation 投影为 `RUNNING`；Session
  Snapshot 只能证明历史存在。缺失、过期或不一致时返回 `RECOVERY_REQUIRED`。
- settlement 只结算 exact Activation；不得借 child dispose 改写 Task 业务状态。
- 所有 continuation、父级唤醒和终态 receipt 都携带 exact Attempt 关联。

## 结果

Runtime Center 可以稳定呈现：

```text
Request → Mission → Direction → Wave → Task
                                  └→ Attempt → Activation → Dispatch
```

Task 版本、执行次数和进程承载不再混为一体。重复、迟到、乱序和重启恢复通过
idempotency key、version fence 与 monotonic transition 收敛。
