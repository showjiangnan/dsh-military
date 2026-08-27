# Military Preset 隔离检查清单

- [ ] `military/preset.yml` 和 `agent.cordis.yml` 可被 roster 发现且健康。
- [ ] 新建会话可选择 `military`，已开始会话切换返回 `agent-preset-locked`。
- [ ] Military 模型工具、Prompt 和命令只注册在 preset standing scope。
- [ ] Host Plane 服务不直接贡献模型可见内容。
- [ ] 所有会话入口验证 actual preset 和 Session Binding。
- [ ] 子代理在 unpublished setup 中使用 `composeFrom()`。
- [ ] 普通会话事件触发 Host listener 时零 Military 写入。
- [ ] 同 cwd 的两个会话按 rootSessionId/missionId 隔离。
- [ ] Military 锁不会拦截普通 preset 的文件工具。
- [ ] 外部文件变化产生 drift，而不是冻结普通会话。
- [ ] 恢复、fork 和冷读能解析实际 preset generation。
- [ ] 绩效扫描只纳入 actual preset=`military`。
