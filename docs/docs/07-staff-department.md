# 战术参谋部设计

## 1. 定位

参谋部是一个由多个专业 Advisor Agent 构成的部门，不是一个固定的“战术指导 Agent”。其职责覆盖：

- Mission/Direction 专业研判；
- Direction—Wave—Task 计划；
- Worker/Engineer 兵力生成建议；
- Tactical Request 处理；
- 私有战术检索与合成；
- Oversight 异常后的修正命令；
- 未来 Wave 的重新规划。

参谋部没有结果接受权、冻结执行权、Git 远端写权。

## 2. 用户自定义参谋模型

WebUI 中每个参谋以 `Advisor Profile` 管理。建议字段如下。

### 2.1 身份与生命周期

```yaml
advisorId: advisor-web-backend
revision: 3
displayName: Web 后端参谋
status: DRAFT|CANARY|ACTIVE|SUSPENDED|RETIRED
description:
createdBy:
createdAt:
lastReviewedAt:
expiresAt:
```

### 2.2 职责边界

```yaml
responsibilities:
  - API 架构
  - 数据访问
nonResponsibilities:
  - 视觉设计
  - 远端部署批准
domains:
  - web-backend
scenarioTags:
  - typescript
  - nodejs
```

“非职责”与职责同等重要，用于资格过滤和冲突分析。

### 2.3 模型策略

```yaml
modelPolicy:
  provider:
  model:
  reasoningEffort: low|high|max
  maxTokens:
  fallbackProfiles: []
  dataResidency:
  timeout:
```

参谋必须开启 Thinking；专业路由依赖本地评测，而不是模型名称的主观等级。

### 2.4 工具权限

列出可见工具并由 Harness 强制。建议区分：

- Mission/Specs 只读；
- Tactical Registry 读取；
- 企业 API 读取；
- Guidance/Plan 提交；
- 禁止项目直接写入；
- 禁止 Accept/Freeze/Git Promotion。

### 2.5 私有战术权限

```yaml
tacticalSkillPatterns:
  - tactic-web-backend-*
  - tactic-api-*
```

模式只限定可检索集合；具体版本仍需生命周期、场景和分类资格检查。

### 2.6 企业内部 API 权限

每个 API Grant 显式包含：

```yaml
grantId:
gateway:
methods: [GET]
resourcePatterns: []
classificationCeiling:
credentialRef:
rateLimitPerMinute:
responseRedactionPolicy:
```

参谋看不到原始 secret。Gateway 代表参谋调用，并在返回模型前做字段过滤、大小限制、来源标记和注入隔离。

### 2.7 预算与并发

```yaml
maxConcurrentConsultations:
maxRequestsPerMission:
maxGuidancePerTask:
maxToolCallsPerConsultation:
costBudget:
```

避免一个热门参谋拖垮整个 Swarm。

## 3. 参谋资格过滤

路由分三层。

### 第一层：确定性资格

排除：

- 状态非 ACTIVE/CANARY；
- Domain/Scenario 不匹配；
- 数据分类不允许；
- 必需工具/API/Skill 无权限；
- 模型不支持最低能力；
- 预算或并发耗尽；
- Profile 已过期。

### 第二层：语义相关性

对剩余参谋计算：

- 问题与职责相关度；
- 历史同类 Task 验收表现；
- 当前环境兼容性；
- 可用战术覆盖；
- 延迟和成本；
- 与其他参谋的知识互补。

### 第三层：覆盖优化

不是简单选最高分的前 N 名，而是求解：

```text
最大化：领域覆盖 + 风险覆盖 + 独立性 + 历史质量
最小化：重复意见 + 成本 + 延迟 + 权限暴露
```

输出一个 Lead Advisor 和 0～若干 Consulting Advisors。

## 4. 联合会商协议

### 4.1 独立研判

每个参谋先只看同一冻结 Context，不看其他参谋答案，输出：

```yaml
problemFraming:
confirmedFacts:
assumptions:
risks:
recommendedDirection:
proposedWaves:
acceptanceNeeds:
evidenceNeeds:
unknowns:
confidence:
```

### 4.2 对比与异议

Harness 形成意见矩阵，标出：

- 共识；
- 互补；
- 冲突；
- 未覆盖风险；
- 需要用户或 General 决定的项。

### 4.3 主责参谋合成

Lead Advisor 得到结构化意见而非全部思维链，生成单一 Plan/Directive，并保留：

- 被采纳建议及来源；
- 未采纳建议及理由；
- 少数异议；
- 风险与验证计划。

### 4.4 Harness 验证

合成结果必须通过：

- Schema；
- Task 粒度；
- DAG 无环；
- 写集合冲突；
- 权限可实现；
- Acceptance Contract 完整；
- Worker/Verifier/Advisor 容量；
- 用户约束一致性。

## 5. 兵力生成

参谋部提出：

- 每个 Task 的角色、模型和 reasoning；
- Worker 数量；
- 并行/串行关系；
- Workspace 模式；
- 需要的 Verifier；
- 预置 Tactical Directive；
- 最大 rework 与 guidance 次数。

Harness 根据真实容量裁剪；参谋不能强行超过限制。

## 6. 战术请求处理

当 Radio Request 进入：

1. Escalation Gate 确认请求值得参谋投入；
2. 路由到专业参谋；
3. 检索 3～5 个候选私有战术；
4. 评估前置、排除、冲突和版本；
5. 选择 1 个主战术和最多 2 个补充战术；
6. 编译为一份 Tactical Directive；
7. Broker 校验 taskVersion 后投递；
8. 后续验收结果回流效能评估。

不要把 3～5 个完整 Skill 文档直接堆给 Worker。

## 7. 修正命令

Oversight 冻结后，参谋获得：

- Inspection Report；
- 真实工具和 Artifact；
- Task Order；
- 当前环境；
- Agent 历史 attempt。

参谋输出：

```text
CORRECTION_RETRY：保留原 Agent，明确修正步骤
REISSUE_TASK：增加 taskVersion，重新发命令
REPLACE_AGENT：换 Agent，不信任原会话
REPLAN_WAVE：任务结构有问题
STRATEGIC_ESCALATION：需要 General/用户
TERMINATE：无安全可行路径
```

只有 Harness 执行 release/replace/replan。

## 8. 参谋自身质量控制

- Guidance 也有版本、expiry 和来源；
- 参谋建议必须列 Evidence Need，不能伪造事实；
- 参谋不得读取超出权限的数据；
- 每个参谋按 Task Type 计算接受率、指导提升、过期率和负面影响；
- 持续低效或高风险的 Profile 自动 SUSPENDED，等待用户审查；
- Profile 更新通过 revision 和 Canary，不原地静默改变。

## 9. WebUI 配置向导

建议步骤：

1. 基本身份；
2. 职责/非职责；
3. 领域和场景；
4. 模型与 Thinking；
5. 工具；
6. 私有战术范围；
7. 企业 API Grant；
8. 数据分类与凭据引用；
9. 预算和并发；
10. 权限 Diff 与风险预览；
11. Canary 测试；
12. 激活。

UI 必须明确显示“描述不会授予权限”。

## 0.2.0：参谋长、标签和模板

每名用户定义参谋由两个版本化对象组成：Advisor Profile 描述领域职责和权限，Agent Template Profile 描述 provider/model/reasoning/context policy。两者通过稳定 id 和 revision 关联。

参谋部会商先查询用户管理的 Tactical Tag Catalog 和 Private Tactic Registry。若 Tactical Sufficiency Gate 输出 `PARTIAL | INSUFFICIENT | CONFLICTED | UNKNOWN`，再调用固定参谋长。参谋长不会绕过领域参谋，也不会把生成意见冒充私有战术。

所有需要用户选择的参谋输出统一转为 `DecisionQuestionSet`，交由根 General 调用 `ask_user_question`。详情见[参谋长兜底](36-chief-of-staff-fallback.md)。
