# 组织模型与职责分离

## 1. 统帅：用户

用户提供行动方向而非必需的内部计划。系统应区分：

- 硬目标；
- 硬约束；
- 偏好；
- 禁止动作；
- 外部授权；
- 可接受风险；
- 用户尚未决定的问题。

用户可随时停止、修改 Mission 或撤销外部授权。

## 2. 将军：General Agent

General 是主会话 Agent，负责：

- 将用户输入转为 Mission Intent；
- 选择和召集参谋；
- 批准 Direction；
- 处理跨方向冲突与战略升级；
- 控制用户沟通粒度；
- 消费已认证 Tactical Memory；
- 在用户明确授权后执行远端/其他分支 Git Promotion。

General 不能自行接受 Worker Candidate，也不能替 Harness 解除冻结。

## 3. 参谋部：可配置部门

参谋部不是单一 Agent，而是由用户配置的专业 Advisor Roster。每个参谋具有：

- 职责与非职责；
- 领域和场景标签；
- 模型、Thinking、Token 与 fallback 策略；
- 工具、私有战术、企业 API 和数据分类权限；
- 并发、请求和成本预算；
- 版本、Canary、停用与审查状态。

参谋先独立研判，再由主责参谋合成，避免锚定和群体附和。

## 4. 快速反应部队：Worker

Worker 是同级、短生命周期或可续行的执行 Agent：

- 每个 Worker 只接收一个 Task Order；
- 必须开启 Thinking；
- 使用受限工具和 Workspace；
- 记录观察、工具和 Artifact；
- 只提交 Candidate、Blocker 或 Radio Request；
- 不派生下级、不接受结果、不写 specs。

参谋部决定派生数量，Harness 根据容量和冲突最终调度。

## 5. 工兵部

工兵是专门的文档和工程保障 Agent：

- 空项目/头脑风暴阶段建立 specs；
- 每个 Wave 和 Change Order 后维护 specs；
- 维护追踪矩阵；
- 执行受限本地 main Git commit；
- 提交自己的 Candidate，由同一外置验收体系验收。

工兵不是通用代码 Worker。

## 6. 督战队

由两个不同组件组成：

1. **Oversight Controller**：确定性 Harness 服务，拥有 Freeze/Release policy；
2. **Inspector Agent**：只读模型，解释歧义、矛盾、谎报和边界问题。

Inspector 的建议不是权威状态变更。产品可显示为“监督与质量保障部”。

## 7. 参谋部电台

电台是消息基础设施而非 Agent：

- 接收结构化求援；
- 自动附加 Harness 证据；
- 进行资格审查；
- 去重、租赁、过期和死信；
- 路由参谋；
- 版本校验后投递。

Advisor 只生成指导内容，Broker 掌握投递权。

## 8. 后勤保障与研究部

固定三个模型 Agent：

- **战术轨迹记忆总结 Agent**：把已验收事实组织为可读轨迹；
- **战术效能评估 Agent**：在 General compaction 后评价技能、模型、任务粒度和指导效能；
- **战术博物馆 Agent**：归档版本并研究下一待测战术。

三个 Agent 均不直接改变 Task 或发布 STABLE 战术。

## 9. Agent Identity

每个 Agent 必须具有：

```yaml
agentId:
sessionId:
role:
displayName:
generation:
advisorId: optional
missionId:
currentTaskId: optional
```

Agent 名称不是权限依据；Harness 注册的 identity 与 Scope 才是。

## 10. 部门通信规则

- Worker ↔ Worker：禁止自由直连；通过 Artifact、accepted event 或参谋命令；
- Worker → Staff：Radio Request；
- Staff → Worker：Broker 投递的 Directive/Correction；
- Engineer → Staff：Blocker 或 specs Candidate；
- Inspector → Staff：Inspection Report；
- Research → General：验证后的 Tactical Memory；
- General → User：战略态势和需用户决定的事项。

## 0.2.0 组织扩展

### 参谋长

参谋长是参谋部的固定兜底角色。Tactical Sufficiency Gate 判定私有战术和领域参谋不足时才触发。它生成 `GENERATED_REFERENCE`，没有发布 Skill、接受 Task 或直接弹窗的权限。

### 军事评估委员会

委员会独立于日常验收和后勤战术效能分析，由 Dataset Auditor、Individual Performance Examiner 和 Committee Chair 组成。它评估 Agent Template revision，不介入当前 Mission 的接受决策。

### 战术提炼管理角色

提炼由 Host Job、提炼 Agent、用户 Reviewer 和 Tactical Registry 共同完成。用户 Reviewer 才能批准候选成为 DRAFT。

## 0.3.0 新增非模型权威组件

组织图中必须把以下组件与 Agent 区分显示：

- Compatibility Controller；
- Authorization/Policy Runtime；
- Budget Admission Controller；
- Workspace Lease Manager；
- Integration Executor；
- Decision Broker；
- Event/Outbox/Artifact Store；
- Dataset Auditor；
- Bundle Lifecycle Controller。

它们不通过自然语言决定状态，且不能被描述成“特殊 Agent”。模型负责语义判断，非模型组件负责身份、事务、版本、权限、验收和资源。
