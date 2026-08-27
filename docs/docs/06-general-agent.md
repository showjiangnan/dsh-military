# 将军 Agent 设计

## 1. 角色定位

General 是用户主会话中的战略控制 Agent。用户是统帅，General 不是用户的替代者，而是负责把行动方向变成可执行组织行为。

## 2. 核心职责

- 解析用户目标、约束、偏好与授权；
- 形成 Mission Intent；
- 决定需要哪些参谋领域；
- 批准或退回 Direction；
- 处理跨 Direction 的优先级和资源冲突；
- 处理战略级 Blocker、风险接受和用户问题；
- 消费已认证 Tactical Memory，而非 Worker 原始推理；
- 向用户汇报进度、实质性选择、限制和最终结果；
- 仅在用户明确授权下执行 Promotion Order。

## 3. 禁止职责

- 不直接接受 Candidate；
- 不自行修改 Worker 的证据；
- 不绕过 Oversight Freeze；
- 不把参谋建议当成已发生事实；
- 不在用户未授权时 push、创建远端 PR 或写其他分支；
- 不逐个微观控制 Worker 工具步骤。

## 4. 输入

General 只应消费：

- 用户消息和授权；
- Mission/Direction 投影；
- Staff Council Result；
- Strategic Escalation；
- Wave Tactical Report；
- 已验证 Tactical Memory；
- 风险与 SLO 摘要；
- Promotion Order 状态。

不应默认接收所有子 Agent 的完整 transcript。

## 5. 输出

```text
MissionIntentDraft
DirectionRatification
ChangeOrder
StrategicDecision
UserQuestion
PromotionOrderRequest
MissionStatusReport
MissionCompletionReport
```

每个改变状态的输出通过领域工具和 Harness 校验，不依赖自然语言解析。

## 6. Thinking 与模型路由

- 默认 `high`，复杂战略综合可 `max`；
- `off` 禁止；
- 遇到未知环境先派侦察，而不是增加推理长度；
- 模型 fallback 必须满足数据驻留和最低 reasoning；
- 有效 provider/model/reasoning 记录在请求事实和效能数据中。

## 7. 与用户的沟通原则

General 应在以下情况打断内部执行并向用户提问：

- 目标本身存在互斥解释；
- 需要用户专属授权；
- 需接受高风险或不可逆副作用；
- 战略取舍会显著改变成本、时间或结果；
- 项目事实无法从允许工具确认。

不应为每个 Task 分解和 Worker 数量向用户请求确认。

## 8. 战略升级分类

| 类型 | 处理 |
|---|---|
| `USER_INTENT_AMBIGUITY` | 向用户回显选项 |
| `SCOPE_CHANGE` | 创建 Change Order |
| `RISK_ACCEPTANCE` | 请求明确风险授权 |
| `EXTERNAL_ACTION` | 创建 Promotion/External Action Order |
| `NO_VERIFIER` | 降级为人工审查或暂停 |
| `RESOURCE_EXHAUSTION` | 调整 Direction/Wave 或预算 |
| `ARCHITECTURAL_CONFLICT` | 召集新的 Staff Council |
| `SECURITY_INCIDENT` | 紧急停止和用户告知 |

## 9. General Compaction

General compaction 只管理上下文：

- 压缩前由 Harness确保关键 Mission 投影持久；
- compaction 后以 ID 幂等触发 Effectiveness Agent；
- Memory Agent 的结果经过来源验证后再注入；
- compaction 摘要不能成为 Ledger 的替代事实。

## 10. Git Promotion

当用户主动要求提交 GitHub 或其他分支：

1. Harness 记录用户授权；
2. General 创建 Promotion Order；
3. 校验 source commit、repository、remote、target branch、action 和 expiry；
4. 由 General 专属工具执行；
5. 记录远端 receipt；
6. 工兵仍不获得该权限。

## 0.2.0：Preset、用户交互与参谋长

General 是 `military` 根会话的 persona。创建时必须存在 `MilitarySessionBinding`，恢复时 actual preset 必须仍为 `military`。

General 是唯一面向用户的 Agent 交互所有者：Advisor 和 Chief of Staff 返回 `DecisionQuestionSet`，General 去重、检查用户拥有的决策边界，再调用 `ask_user_question`。General 不应把普通偏好回答解释为 Git、生产或 Restricted 数据授权。

General 还负责：

- 触发 Tactical Sufficiency Gate；
- 决定是否调用 Chief fallback；
- 接收委员会和后勤部报告，但不修改其原始数据；
- 向 Engineer 下达 Brainstorm specs handoff；
- 不把运行中子代理配置热切到新的 Template revision。

## 11. 0.3.0：General 模型来源与会话切换

General 的路由不由 Department Template 管理，而由固定 `military` preset 中的 [`GeneralExecutionPolicy`](../schemas/general-execution-policy.schema.json) 提供默认值：

```text
military preset default provider/model
→ 用户在当前会话模型选择器中的显式覆盖
→ ModelCapability、Thinking、数据驻留、权限和预算准入
→ DSH RC.2 prepareCall
→ request/header 记录 effective route
```

规则：

- 会话没有显式模型覆盖时，General 使用 preset 默认；
- 用户切换模型后，只影响 General 的后续请求；
- 切换不改变 actual preset、preset generation、历史或 Mission 身份；
- 已运行子 Agent 不切换；后续新子 Agent 继续按 Department Template revision 创建；
- 目标模型不支持要求的 reasoning、上下文、数据驻留或工具协议时，在网络 I/O 前拒绝；
- 切换失败时旧路由保持有效，不静默回退；
- 成功切换生成 [`ModelSelectionReceipt`](../schemas/model-selection-receipt.schema.json)，并在评估数据中按 route 分段。

General 不能通过自然语言要求子 Agent 跟随自己的模型，也不能把普通会话模型切换解释为预算、数据出境或外部 API 授权。

## 12. Generation、Authority 与预算

General 恢复前必须完成 `MilitarySessionBinding` 与 preset generation 匹配。若旧 generation 缺失，General 不启动模型轮次，Session 进入只读 `QUARANTINED`，由用户选择安装旧资产、迁移或导出。

所有 General 管理写操作携带 `AuthorityContext`。General 是用户交互所有者，不等于拥有无限权限：Promotion、Restricted 数据、追加预算、跨会话评估和战术组织发布都需要独立 Authorization Receipt。

General 可请求资源追加，但预算 reservation、并发准入和耗尽处置由 Harness 执行。预算不足不能通过关闭 Thinking、跳过 Verifier 或缩减证据要求解决。
