# 参谋部电台

## 1. 定位

电台是结构化、持久、版本化的战术通信基础设施。它解决兄弟 Agent 直连、消息丢失、重复求援、旧指导写回和无证据占用参谋资源的问题。

## 2. 请求必需内容

所有子 Agent 请求战术指导时必须额外汇报：

- Agent identity、角色、session/generation；
- Mission/Direction/Wave/Task/Task Version/Attempt；
- 所处 Environment Snapshot；
- 当前已分配、尝试和完成的私有战术及版本；
- Blocker 类型、陈述、可复现性和边界；
- 已尝试动作、观察和排除理由；
- Harness 自动附加的工具、Artifact 和 Verifier 证据；
- 一个明确 `requestedDecision`；
- 已使用/剩余预算；
- idempotency key、createdAt、expiresAt。

自由文本只能作为字段内容，不可替代信封。

## 3. Escalation Gate

请求进入参谋前先由外置 Harness 验收“求援资格”，而不是验收任务完成。

输出：

```text
ADMISSIBLE
MISSING_EVIDENCE
DUPLICATE_REQUEST
CHEAP_RETRY_AVAILABLE
STRATEGIC_ESCALATION
BUDGET_EXHAUSTED
POLICY_DENIED
```

可接受请求通常满足：

- Blocker 可定位或复现；
- 完成规定廉价检查；
- 有真实工具/Artifact；
- 没有重复问已回答问题；
- 需要一个具体战术决策；
- 当前技能不足或出现冲突。

## 4. Broker 语义

每封信具有：

- `requestId`；
- `idempotencyKey`；
- `taskVersion`；
- `leaseOwner/leaseUntil`；
- `attempt`；
- `visibilityTimeout`；
- `expiresAt`；
- `ack`；
- Dead Letter 状态。

数据库或队列 Provider 必须支持幂等和租约恢复。

## 5. 事件唤醒与 Heartbeat

正常流程：

```text
radio/requested event
→ Broker 通知/唤醒合格 Advisor
→ Advisor lease
```

Heartbeat 只用于：

- Advisor 存活；
- 过期 lease；
- 孤儿任务；
- 故障转移；
- 队列健康。

不让 Thinking Advisor 持续轮询并浪费模型调用。

## 6. Advisor 处理

- 读取结构化请求和最小证据；
- 召回 3～5 个候选战术；
- 检查版本、前置、排除、权限、冲突和依赖；
- 选择 1 个主战术 + 最多 2 个补充；
- 编译单一 Tactical Directive；
- 指明 expected observations、evidence、stop 和 fallback；
- 写入 Guidance，不直接投递给兄弟 Agent。

## 7. Broker 投递

投递前检查：

- 当前 Task Version 等于 expectedTaskVersion；
- Agent generation/lease 仍有效；
- Guidance 未过期；
- Skill 版本未隔离；
- 工具/API 权限仍满足；
- 请求未关闭或被其他 Candidate 解决。

否则标记 `GUIDANCE_STALE` 或 `GUIDANCE_EXPIRED`。

## 8. 回执和后续

Worker ack 后执行；后续 Candidate/Blocker 引用 guidanceId 和 skill refs。Effectiveness Agent 可计算：

- 请求到指导延迟；
- 指导后首轮/最终通过；
- 过期、重复和无效指导；
- 参谋与技能的增量贡献。

## 9. 安全

- Broker 根据调用者身份重建敏感字段，不信任 Worker自报权限；
- 企业数据通过 Artifact/引用和最小必要投影；
- Radio 事件不存原始 secret；
- Advisor 不能通过 Guidance 给 Worker 新权限；
- Dead Letter 仍遵守分类和保留策略；
- 防止一个 Worker 通过重复请求耗尽高成本参谋。

## 用户问题转交

Radio 新增 `DecisionQuestionSet` 消息类型。它不是直接弹窗命令，只能送达 General：

```text
Advisor/Chief → Radio Broker → General → ask_user_question
```

Broker 依据 contextVersion、dedupeKey 和 expiresAt 去重。旧 Task/Brainstorm revision 的问题不应显示给用户。

## 0.3.0：授权、预算和 Decision Relay

Radio Request 还需携带 Authority/Policy revision、remaining budget、base Workspace Snapshot 和 source tactic rights。Advisor 调用前预留预算；无新增 Evidence 的重复请求被去重或拒绝。

需要用户决定的 Guidance 不直接弹窗，而生成 Decision Broker Record。Task Version、Guidance expiry 或来源撤回使待决问题 `STALE/SUPERSEDED`。
