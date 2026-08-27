# ADR：原子 Bundle 生命周期

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

直接覆盖 profile 或删除 generation 会破坏现有会话。

## 决策

安装、升级、回滚和卸载使用 profile revision CAS、备份、Probe 和结构化 Receipt。

## 后果

安装器复杂度增加，但获得可恢复和可审计生命周期。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
