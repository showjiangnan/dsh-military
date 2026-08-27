# ADR：JSON Schema 与 Event Catalog 作为机器契约真源

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

手工维护多份契约已经产生必填字段和事件 Payload 漂移。

## 决策

Wire/storage 对象以 JSON Schema 为真源，事件名和 Payload 以 `contracts/event-catalog.json` 为真源，TypeScript 和示例由生成器投影。

## 后果

引入代码生成与 freshness/parity CI，事件 Envelope 升级为 2.0.0。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
