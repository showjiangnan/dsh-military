# ADR：General 默认模型由 military preset 所有

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

General 不应出现在子代理模板设置，但用户需要会话级切换。

## 决策

Preset 只在 Session 没有显式模型时填充默认；WebUI Session model selection 优先，仍受 reasoning、能力和驻留门禁。

## 后果

子 Agent 路由不跟随 General；模型切换生成 Receipt。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
