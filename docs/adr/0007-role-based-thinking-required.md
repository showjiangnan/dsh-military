# ADR-0007：按角色强制 Thinking

- 状态：Accepted
- 日期：2026-08-18

## 背景

原方案曾以关闭 Worker Thinking 节省成本，但本版以任务成功率为优先。

## 决策

General、Staff、Worker、Engineer 和三类研究 Agent 均不得使用 `reasoningEffort=off`。具体强度由角色、风险和 Task Complexity 决定；以有效 `request/header` 审计，而不是相信 Prompt 或静态配置。

## 后果

Adapter 级全局 `thinking: disabled` 不适用；必须实现 Agent Scope 的请求策略和非法降级 fail-closed。
