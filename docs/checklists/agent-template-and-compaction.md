# Agent 模板与上下文策略检查清单

- [ ] 模板具有稳定 id、revision、department、role 和 lifecycle。
- [ ] provider/model/reasoning 被模型目录验证。
- [ ] Thinking Required 角色不能配置 `off`。
- [ ] context budget 小于模型有效窗口并预留输出/工具 envelope。
- [ ] trigger percent 显示对应 threshold tokens。
- [ ] compaction 只在工具配对和事务安全边界执行。
- [ ] 达阈值时创建幂等 CompactionAttempt。
- [ ] null/failed compaction 不被记录为 success。
- [ ] 摘要保留 Task、Acceptance、Evidence、Guidance 和未决选择。
- [ ] 设置修改产生新 revision，不漂移运行中实例。
- [ ] 权限撤销在下一次工具准入前生效。
- [ ] 绩效按 template revision 分组。
