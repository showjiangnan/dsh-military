# ADR：持久化且由根 General 所有的决策 Broker

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

RC.2 delegated child 不能直接提问，简单队列无法处理断线和竞态。

## 决策

子 Agent 提交问题集，Broker 状态机管理排序、展示、回答、过期和回送，只有根 General 调用 ask_user_question。

## 后果

引入 DecisionBrokerRecord、presentation lease 和 CAS。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
