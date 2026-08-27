# MVP 就绪检查表

- [ ] 领域事件和状态机已冻结并有 schemaVersion。
- [ ] Mission Ledger 可追加、CAS、重放和校验 checksum。
- [ ] Agent Session 能从 durable events 重建模型可见军事上下文。
- [ ] 每个子代理发布前已有 AgentExecutionBinding。
- [ ] 每个昂贵操作执行前已有 ResourceBudgetReservation。
- [ ] Preset Resume Receipt 可跨进程恢复并与 generation 对账。
- [ ] Worker/工兵 `reasoningEffort=off` 会 fail closed。
- [ ] Worker 只能通过 Candidate 或 Blocker 结束任务。
- [ ] Candidate 的工具声明会与 DSH 工具事件对账。
- [ ] Verifier 失败时绝不自动接受。
- [ ] Harness 独占 accept/freeze/release。
- [ ] Task Version race 测试通过。
- [ ] 工兵无法写非允许路径。
- [ ] 工兵无法执行远端 Git 写或历史重写。
- [ ] 空项目能初始化本地 main 并形成 specs commit。
- [ ] 事件重放和崩溃恢复测试通过。
- [ ] 没有原始密钥进入 Session、Ledger 或 Artifact metadata。
- [ ] 至少一个垂直场景端到端通过。
