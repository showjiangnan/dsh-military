# ADR：来源权利、派生图和知识撤回

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

用户提供内容不自动意味着组织可永久共享，历史会话也可能被污染。

## 决策

每个战术源记录 owner/license/use/audience，并可沿派生图撤回和影响评估。

## 后果

新增 Source Snapshot、Revocation Order 和再验证。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
