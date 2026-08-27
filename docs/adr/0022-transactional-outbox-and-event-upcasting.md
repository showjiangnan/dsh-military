# ADR：Transactional Outbox、事件不可变与 Upcaster

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

异步通知与数据库双写会产生幽灵状态，重写历史破坏审计。

## 决策

Event append、revision 和 outbox 同事务；旧事件不改写，通过纯 Upcaster读取。

## 后果

Projection 可重建；需要 migration ledger 和 Golden Trace。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
