# ADR-0004：参谋部电台采用 Broker，而非 Agent 直连

- 状态：Accepted
- 日期：2026-08-18

## 背景

DSH continuable child 的消息权限围绕直接父级；兄弟 Agent 直连既不自然，也不利于审计、去重和版本校验。

## 决策

Worker 向 `ctx.militaryRadio` 提交 Tactical Request；参谋只生成 Guidance；Broker 验证 taskVersion、过期时间和权限后投递。正常发现由事件唤醒，Heartbeat 只负责 liveness、lease 和故障转移。

## 后果

通信可以重放、去重、限流和死信；Advisor 不是消息权威。
