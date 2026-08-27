# 实现契约冻结检查清单

- [x] Event Catalog 生成物新鲜，所有 Payload 为判别联合。
- [x] JSON Schema 与 TypeScript parity 通过。
- [x] RC.2 compatibility probe 为 `READY`。
- [x] current preset generation 可跨进程恢复；archive-only 不匹配会隔离并要求迁移。
- [x] Workspace Patch/Integration/Receipt 链路完整。
- [x] 每个非 General Agent 在发布前持久化不可变 AgentExecutionBinding。
- [x] Preset Resume Receipt 与 Manifest/Session Binding 三方对账。
- [x] 资源 reservation 与 usage settlement 幂等、无负余额。
- [x] 绩效报告申诉不改写旧 revision。
- [x] Authority Context 覆盖跨会话和高影响操作。
- [x] SQL migrations、outbox、Upcaster 和恢复已评审。
- [x] Decision Broker 断线、部分回答和幂等回答路径通过；浏览器多标签属于部署验收。
- [x] Evaluation Dataset Manifest 和公平性协议通过。
- [x] Knowledge revocation impact trace 通过。
- [x] Golden Trace、fault injection 和状态不变量通过。
- [x] Standard sibling Session 隔离回归通过。
