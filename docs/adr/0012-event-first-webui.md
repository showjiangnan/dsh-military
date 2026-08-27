# ADR-0012：WebUI 采用事件优先投影

- 状态：Accepted
- 日期：2026-08-18

## 背景

浏览器本地状态或轮询多个 Agent 会产生丢失、乱序和重连不一致。

## 决策

配置通过 DSH settings namespace/card；运行态通过稳定 Durable Event Family 和 Conversation Nodes/投影展示。所有写命令带 expected revision。

## 后果

UI 可历史重放和断线恢复；专用 Dashboard 可后置，不阻塞核心功能。
