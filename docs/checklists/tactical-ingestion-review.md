# 战术提炼审阅清单

- [ ] 用户显式选择来源、范围、标签和数据分类。
- [ ] 来源快照具有内容哈希、时间、授权和 redaction receipt。
- [ ] Secret、PII、Restricted 与 Prompt Injection 扫描通过。
- [ ] 提炼内容区分事实、经验、假设和未经验证建议。
- [ ] ACTIVE/PAUSED/DELETED 标签语义正确。
- [ ] 目标为 NEW 或精确 base skill version 的 SUPPLEMENT。
- [ ] 前置、排除、状态、失败、Stop、Rollback 和 Verifier 足够。
- [ ] Candidate Diff 中没有就地改写已发布版本。
- [ ] 用户已审阅并批准最终 Diff。
- [ ] 输出只进入 DRAFT，不自动进入 Stable 调用目录。
- [ ] 来源、模型、用户和版本链可追溯。
- [ ] 拒绝或撤回不会删除历史审计。
