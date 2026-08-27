# 用户决策 Broker 状态机

## 1. 背景

DSH RC.2 中 delegated child 不能直接调用 `ask_user_question`。Advisor、Chief、Worker 和 Engineer 只能提交结构化 `DecisionQuestionSet`；根 General 通过 `MilitaryDecisionBroker` 统一展示、回答和回送。

## 2. 状态

[`DecisionBrokerRecord`](../schemas/decision-broker-record.schema.json) 使用：

```text
CREATED
QUEUED
PRESENTED
PARTIALLY_ANSWERED
ANSWERED
EXPIRED
CANCELLED
SUPERSEDED
STALE
DELIVERY_FAILED
```

终态不可回到可展示状态。新问题必须创建新 ID 或显式 supersede。

## 3. 创建准入

问题集必须包含：

- stable decisionSetId；
- origin Agent/Session；
- root Session；
- Mission/Task/version；
- 用户拥有的决策理由；
- 可选项、推荐项和影响；
- expiry；
- 幂等键。

Broker 拒绝：

- 可通过工具侦察回答的问题；
- 重复问题；
- 已 stale 的 Task version；
- 请求 Agent 已冻结且问题不再有效；
- 试图索取隐式高风险授权；
- 超出 question budget。

## 4. 排序和合并

优先级：

```text
CRITICAL safety/authorization
→ HIGH blocking decision
→ NORMAL planning choice
→ LOW preference
```

可合并条件：同一 root Session、同一 user-owned decision domain、兼容 expiry、没有相互冲突的 version。合并后保留每个 origin 和回送路由。

## 5. 展示

General 在安全 Turn 边界：

1. lease 下一 Record；
2. 再次验证 Mission/Task version；
3. 将选项转成 DSH `ask_user_question`；
4. 记录 `decision/question-presented`；
5. 等待用户或取消信号。

问题 UI 关闭、浏览器断线或 Agent compaction 不丢失 Record。恢复后若 DSH 工具调用未完成，Broker 根据 presentationId 对账。

## 6. 部分回答

多问题集合允许部分回答：

- 已回答项写 Answer Receipt；
- 未回答项保持 `PARTIALLY_ANSWERED`；
- General 可重新展示剩余项；
- 新的 Task version 只使相关问题 stale；
- 禁止把未回答项自动解释为默认授权。

## 7. 并发

- 同一 decisionSet version 只有一个 active presentation lease；
- 多个浏览器标签页使用 presentation revision CAS；
- 第一个有效回答提交，后续收到 `ALREADY_ANSWERED`；
- 答案落盘后再回送 origin Agent；
- origin Agent 已销毁时答案进入 Mission Decision Record，由 Staff 重新规划。

## 8. Expiry 与 Stale

Expiry 策略由问题类型决定：

- 普通偏好：暂停相关 Task；
- 安全授权：拒绝动作；
- 外部副作用：不得默认；
- 低风险可逆实现选择：只有 Mission Intent 已明确允许默认时才可使用推荐项，并记录政策来源。

Task version、Mission cancel、Change Order、origin replacement 都可使 Record stale。

## 9. Compaction

未决 Decision Record 是强保留内容。Compaction 摘要只引用 ID，完整问题和回答保存在 Broker/Artifact Store。General generation handoff 必须重新注入 pending Record 投影。

## 10. 验收条件

- 子 Agent 不能直接弹窗；
- 多个问题按优先级串行展示；
- 多标签页不会重复提交；
- 断线后可恢复；
- stale 问题不回送旧 Task；
- 没有回答不能产生高风险授权；
- 所有答案可追踪到用户、presentation 和来源 Agent。
