# ADR：内容寻址的 Preset generation 恢复

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

仅保存 preset id 会在重启后把旧会话装到新工具和 Prompt 下。

## 决策

在固定公共 preset id `military` 之外持久保存内容哈希 generation，并在 RC.2 重启恢复时由专用 Adapter 绑定准确的 archived standing scope。

## 后果

需要 generation store、迁移和垃圾回收；找不到资产时 fail closed。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
