# Workspace 与集成检查清单

- [ ] 写 Task 使用独立 Snapshot 和 Lease。
- [ ] Worker 没有 local-main commit 或 remote Git 权限。
- [ ] Candidate Patch hash、路径和 base snapshot 可验证。
- [ ] ACCEPTED 之前 Patch 不进入 main。
- [ ] Integration Order 固定 expected HEAD/tree 和 Verifier。
- [ ] 冲突、stale 和回归失败均不移动 main。
- [ ] 成功产生 Integration Receipt 和 repository marker。
- [ ] Engineer 根据真实集成 Diff 更新 specs。
- [ ] 外部/普通 DSH 会话修改只触发 drift，不被 Military 冻结。
