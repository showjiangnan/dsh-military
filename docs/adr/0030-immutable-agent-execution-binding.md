# ADR-0030：子代理使用不可变 Agent Execution Binding

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

Department Template、模型能力、权限、API Grant、Verifier、上下文策略和预算都可能独立更新。若 Agent 每一步重新读取“当前设置”，同一次 Attempt 会在运行中漂移，验收、恢复和绩效归因无法重建。

## 决策

每个非 General Agent 在未发布的创建事务中解析并持久化一个不可变 `AgentExecutionBinding`。Binding 包含所有实际生效的 revision、provider/model/reasoning、preset generation 和 context/budget policy。请求和工具 Guard 按 `bindingId` 对账。

设置变更只影响后续实例；安全撤权通过独立 revoke generation 立即收紧，必要时冻结实例，而不是修改 Binding。

## 后果

- 可以精确重放一次 Agent 实例的能力边界；
- 绩效按真实模板和模型归因；
- 配置热更新不会导致 Attempt 中途变性；
- 创建事务增加一次多 Profile 解析和持久写入；
- 必须维护 Binding 与 effective `request/header`、工具 Scope 的一致性测试。
