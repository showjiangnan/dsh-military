# 军事评估委员会检查清单

- [ ] 时间区间、模板筛选和调用者权限已冻结。
- [ ] 只纳入 actual preset=`military` 的 Session。
- [ ] Dataset Artifact 有 hash、query 和数据质量摘要。
- [ ] 模板按 `templateId@revision` 拆分。
- [ ] 基础指标由 Harness 计算，不由 LLM 猜测。
- [ ] 一次 Examiner 只评估一个模板 revision。
- [ ] 每个分析点引用 Evidence 或明确标为推断。
- [ ] 难度、角色和任务类型得到分层/校正。
- [ ] 样本不足显示 `INSUFFICIENT_DATA`，不强行排名。
- [ ] 报告包含 individual 与 overall 两部分。
- [ ] 建议映射到可创建的 Canary 变更。
- [ ] 报告和原始 Evidence 遵循数据分类与保留策略。
