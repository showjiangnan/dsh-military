# 战术提炼质量协议

提炼 Candidate 的质量维度：

1. 来源覆盖：每个事实/经验是否能映射到 source span；
2. 可执行性：是否有动作、状态、预期观察和停止条件；
3. 可验证性：是否有工具、Verifier 或人工验收方式；
4. 适用边界：前置、排除、兼容和数据分类是否清楚；
5. 新颖性：相对现有战术的增量是什么；
6. 安全性：是否含 Secret、PII、越权或外部注入；
7. 可维护性：版本、tag、依赖、冲突和回滚是否完整。

任何维度为阻断级失败时，只能退回重提炼或拒绝，不能发布 DRAFT。

## 0.3.0 来源供应链门禁

除原有提炼质量外，Candidate 发布前必须验证 Source Snapshot 的权利、audience、derivative permission、classification、temporal validity 和 dependency version。`UNKNOWN` rights 不得进入 Workspace/Organization visibility。

撤回演练应证明：新匹配立即停止、受影响版本进入 quarantine、历史 Guidance 可追踪、关键 Accepted Result 进入重验队列、敏感报告按策略脱敏。
