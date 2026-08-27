# ADR-0001：Mission Ledger 与 DSH Session Log 分层

- 状态：Accepted
- 日期：2026-08-18

## 背景

一个 Mission 跨越多个 Agent Session。DSH Session Log 是单 Session 的模型上下文真源，但不能天然承担跨 Agent 任务 DAG、租约、战术、验收和全局并发事务。

## 决策

建立独立、追加式 Mission Ledger 作为跨 Agent 事实源；对任何需要进入某 Agent 模型请求的军事事实，写入该 Agent 可重建的 DSH Session Event 投影。

## 后果

- 全局一致性由 Mission Ledger 管理；
- 模型可见性仍遵守 DSH Session 重建约束；
- 派生文档不是事实源；
- 必须实现双层关联标识和投影重放测试；
- 不允许只写 Mission Ledger 后用运行时隐藏内存注入模型。
