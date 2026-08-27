# 参谋长兜底机制

## 1. 角色定位

参谋长（Chief of Staff）是参谋部中的固定特殊 Agent，用于在私有战术和专业参谋覆盖不足时，依据模型自身能力、已认证上下文和明确假设，生成推进决策所需的参考意见。

它不是万能事实来源，也不是 General 的替代者。它没有最终战略批准、任务接受、冻结、Git 远端写入或用户授权权力。

## 2. 何时触发

参谋部先运行 `TacticalSufficiencyGate`。只有以下一种或多种条件成立时，才调用参谋长：

- 没有任何满足前置条件的私有战术；
- 候选战术只覆盖部分决策维度；
- 战术版本与当前环境不兼容；
- 战术证据质量或效能样本低于阈值；
- 领域参谋意见严重冲突且无主责覆盖；
- 问题属于新技术、新版本或未建档场景；
- Radio 请求已证明有价值，但现有 Guidance 无法形成可执行步骤。

不能因为参谋长方便，就跳过便宜的项目侦察、API 查询和现有战术检索。

## 3. 战术充分性评分

Harness 先计算结构化输入，不让参谋长自行宣称“技能不足”：

```text
coverageScore        决策维度覆盖
compatibilityScore   模型/工具/环境/数据兼容
provenanceScore      来源与样本质量
freshnessScore       技术版本和时间相关性
effectivenessScore   历史外置验收表现
conflictPenalty      候选之间的冲突
```

输出：

```text
SUFFICIENT
PARTIAL
INSUFFICIENT
CONFLICTED
UNKNOWN
```

触发阈值按 Task Type 配置，并记录版本。

## 4. 输入边界

参谋长收到一个冻结的 `ChiefContextPacket`：

- Mission/Direction/Wave/Task 位置；
- 用户目标、硬约束和未决选择；
- 已认证事实和 Artifact；
- 领域参谋独立意见；
- 已检索战术及不适用原因；
- 当前环境和可用工具；
- Acceptance Contract；
- 禁止事项、预算和数据分类。

不默认读取所有 Worker 原始思考或整仓库。需要新事实时，参谋长提出侦察建议，由有权限的 Agent 执行。

## 5. 输出契约

`ChiefOfStaffAdvice` 包含：

- 问题重述；
- 已知事实与假设分离；
- 2～4 个可行方案；
- 推荐方案及理由；
- 风险、反例和失效条件；
- 最小下一步；
- 所需 Verifier；
- 是否需要用户选择；
- `DecisionQuestionSet`；
- 置信度和置信度来源；
- 明确声明“模型生成参考”而非私有战术。

Schema 见 [`chief-of-staff-advice.schema.json`](../schemas/chief-of-staff-advice.schema.json)。

## 6. 与用户交互

参谋长是 General 的子代理，不能直接调用 DSH 的 `ask_user_question`。正确流程：

```text
Chief produces DecisionQuestionSet
  → Harness validates question ids/options
  → Radio/Staff Broker sends to General
  → General deduplicates against pending questions
  → General invokes ask_user_question
  → answer is recorded
  → General sends resolved choice back to Staff
```

这样所有弹窗都由根交互 Agent 所有，不会有多个子代理争抢用户。

## 7. 与私有战术的关系

参谋长建议默认是一次性 `GENERATED_REFERENCE`，不能自动进入私有战术目录。

如果后续执行通过严格验收，系统可以创建战术提炼候选：

```text
Chief Advice + Accepted Execution + Verifier Evidence
→ TacticalExtractionCandidate
→ User Review
→ DRAFT Tactic
```

未执行、未验证或失败的建议可以作为 Museum 反例，但不能被提升为最佳实践。

## 8. 调度优先级

```text
project inspection
→ eligible private tactics
→ domain advisors
→ chief of staff fallback
→ user decision through General
→ strategic escalation / human expert
```

高风险领域可以配置为：即使参谋长给出建议，也必须由用户或指定人类专家批准。

## 9. 权限

参谋长默认：

- 只读 Mission/Artifact/Staff/Tactic；
- 可调用受控检索和企业只读 API；
- 可生成 Advice 和 DecisionQuestionSet；
- 不直接写项目文件；
- 不执行 Git；
- 不接受 Task；
- 不修改 Acceptance Contract；
- 不冻结/释放 Agent；
- 不发布 Skill；
- 不获得未经 Profile 授权的 Restricted 数据。

## 10. 预算与循环控制

每个决策节点默认最多：

- 1 次初始 Advice；
- 1 次基于用户回答的修订；
- 1 次基于新证据的修订。

连续无法推进时必须输出：

```text
BLOCKED_NEEDS_USER
BLOCKED_NEEDS_DOMAIN_EXPERT
BLOCKED_NEEDS_EVIDENCE
STRATEGIC_REPLAN_REQUIRED
```

禁止参谋长与其他参谋无限互相评论。

## 11. 质量门禁

Harness 检查：

- Advice 引用的事实存在；
- 假设被明确标注；
- 建议没有越过权限；
- 方案不是同义改写；
- 用户问题属于用户拥有的选择；
- 下一步可以独立验收；
- 没有把 generated reference 冒充 Stable Tactic；
- Task Version 和 Context Packet 未过期。

## 12. WebUI

参谋名册中固定显示一张“参谋长”卡：

- 模型、Thinking、Context Policy；
- 触发次数；
- 私有战术不足触发原因；
- Advice 被采用、被拒绝和最终通过率；
- Pending user decisions；
- 用户可暂停参谋长，但暂停后不足场景必须升级 General，不能静默跳过。

## 13. 测试与验收

- 有充分 Stable Tactic 时不会无谓触发参谋长；
- Skill 不兼容时触发理由可审计；
- 参谋长不能直接弹出 delegated ask-user；
- DecisionQuestionSet 可由 General 正确显示和回传；
- Advice 不能直接发布为 Skill；
- Advice 引用不存在的 Artifact 时被拒；
- Advice 过期时不投递给新 Task Version；
- 连续修订达到预算后升级，不无限循环；
- 绩效报告能区分 generated reference 与 private tactic guidance。

## 0.3.0：预算、证据与问题中继

Chief fallback 需要独立预算 reservation，且同一 decision key 有最大初稿/修订次数。建议必须引用当前 Context Snapshot 和已检查的私有战术，不得把模型常识标成企业事实。

需要用户选择时，Chief 只输出 `DecisionQuestionSet`；Decision Broker 验证 taskVersion、去重和 expiry 后，由 General 弹窗。用户回答返回后，Chief 可产生新 advice revision，但不能修改旧建议或绕过 Harness 决策记录。
