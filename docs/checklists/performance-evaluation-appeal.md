# 绩效评估申诉检查清单

## 提交前

- [ ] 申诉指向固定 `reportId@revision`，且报告仍可从 Artifact digest 读取。
- [ ] Principal 通过 Host 报告读取与本地执行确认边界。
- [ ] 每个 challenge 指定稳定 finding path、理由和 Evidence。
- [ ] finding path 确实存在于目标 immutable Report。
- [ ] Evidence classification 不高于评审者可读范围。
- [ ] 不把自由文本“不认可”当成结构化 challenge。
- [ ] idempotency key 已生成，重复提交不会创建第二份申诉。

## 评审

- [ ] 原 Report、Dataset、Manifest、Attempt 和 source Artifact 保持不可变。
- [ ] 评审者记录 resolution、理由和 Evidence。
- [ ] 结论只允许 `UPHELD`、`PARTIALLY_UPHELD`、`DENIED` 或用户撤回。
- [ ] 成立/部分成立时只列出有 Evidence 支持的 authorized excluded Attempt id。
- [ ] 被排除 Attempt 属于原冻结 Dataset，且不存在跨报告/跨 tenant 注入。
- [ ] 拒绝把修改指标值、route、配置或难度作为“人工修正”。
- [ ] RC.2 本地单用户边界被准确记录，不冒充企业 RBAC 或双人审批。

## 重算与谱系

- [ ] Host 以原 Request + authorized exclusions 重新运行 Dataset Builder。
- [ ] 新 Frozen Dataset 和 Manifest 通过 Schema 与 canonical hash 验证。
- [ ] 已完成 configuration shard 仅在 Dataset 相同且配置相同时复用。
- [ ] 新报告通过 Request/Dataset/Attempt/Individual/Overall Schema。
- [ ] 新报告拥有新 report id/revision，并设置 `supersedesReportId`。
- [ ] 旧报告设置反向 `supersededByReportId`，内容与 Artifact digest 不变。
- [ ] 重复 recompute 使用稳定 idempotency key 返回同一结果。
- [ ] 提交、撤回、解决、重算和 superseding receipt 可审计。

## Web 与治理

- [ ] 历史视图可比较 dataset hash、排除样本、配置、区间、decision 和阻断变化。
- [ ] 数据/Evidence 视图仅通过 Host Remote 读取，不暴露 SQLite 或任意路径。
- [ ] 撤回只改变申诉状态，不删除原 Report/Dataset。
- [ ] 申诉不会自动修改 Agent Template、Prompt、模型、ToolProfile、
  PermissionProfile 或 capability。
- [ ] 即使新报告为 `DECISION_ELIGIBLE`，`promotionAllowed` 仍为 `false`。
