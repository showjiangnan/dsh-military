# ADR：Golden Trace 与状态机模型检查

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

语法校验不能发现并发状态和权限漏洞。

## 决策

关键流程保存完整事件 Trace，并对 Task、Freeze、Radio、Decision、Integration 竞态做属性和 TLA+ 检查。

## 后果

发布门禁更严格，需要维护 Fixture 和模型。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
