# ADR：RC.2 能力探测与 fail-closed

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

版本号不能证明部署具备 persistence、user questions 或 preset generation adapter。

## 决策

启动按精确 commit 和能力探测产生 READY/DEGRADED/MIGRATION/UNSUPPORTED。

## 后果

关键能力缺失时隐藏或禁用 Military，普通 DSH 不受影响。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
