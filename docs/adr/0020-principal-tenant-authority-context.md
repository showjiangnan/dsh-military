# ADR：统一 Principal、Tenant 与 Authority Context

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

字符串 requestedBy 无法支撑多租户、来源权利和撤权。

## 决策

所有跨会话和高影响操作必须使用 Host 构造的 Authority Context 和细粒度 Authorization Receipt。

## 后果

管理 API 增加身份上下文；Agent 不能自铸人类授权。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
