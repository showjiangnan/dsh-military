# Agent Execution Binding 检查清单

- [ ] actual root Session preset 为 `military`。
- [ ] 子 Agent 使用父 Agent 的同一 preset generation。
- [ ] Template、Tool、Permission、API、Residency、Redaction、Verifier、Budget 均解析到精确 revision。
- [ ] provider/model 支持要求的 reasoning，且不超过数据驻留边界。
- [ ] Resource reservation 已成功。
- [ ] Binding 在 Agent 发布前持久化。
- [ ] effective `request/header` 与 Binding 一致。
- [ ] 模型可见工具与 Tool/Permission Profile 交集一致。
- [ ] 设置更新不会修改既有 Binding。
- [ ] revoke 会在下一次准入前收紧或冻结。
