# 私有战术系统

## 1. 定义

私有战术不是更长的 `SKILL.md`，而是一个版本化、可执行、可验证、可回滚的
Tactical Procedure。当前源码由 `ctx.militaryTactics` 管理真源，并通过官方
RC.2 dynamic `ctx.skills` provider 暴露受治理编译视图。

## 1.1 当前投放合同

- `DRAFT` 和 `SIMULATION` 永不进入生产 Task；
- `CANARY`/`TESTING` 只有在 Military 的 `allowCanaryDelivery` 开启时，才会被
  Host 的 Task 语义召回选中；
- 全局 DSH Skill 目录只列出 `STABLE`；
- list/get、Task 创建和每个模型 pre-step 都重新检查来源撤回、许可、scope、
  audience、derivative、expiry 和 exact lifecycle；
- Task Order 固定 `skillId@version`；版本在 Task 执行期间被降级、隔离、撤回
  或过期时，在下一次模型投放前 fail closed；
- Flash 不需要选择标签或理解完整 Registry。Host 从 Task objective、scope、
  workspace/依赖语义和 evidence 要求召回最多配置数量的 exact version，再注入
  一个有字节预算的适用性卡片；
- 卡片只含 scenario、precondition、紧凑步骤、stop/verifier 和 content hash。
  超过八步时卡片只要求一次
  `military_get_order({ "skillId": "<assigned-skill>" })`；Host 从 Task 中派生
  exact frozen version、重新检查实时投放资格并返回完整 procedure，不让 Flash
  猜版本、路径或新增工具。原始来源永远不进入模型上下文。

编译文件遵守渐进式披露：

```text
SKILL.md                    # 触发描述、适用性、紧凑工作流和安全边界
references/procedure.md     # 完整 Claim Evidence、权利、依赖、风险和验证计划
examples/minimal.md         # 最小调用形状
scripts/verify.mjs          # 可执行的离线完整性检查
```

该结构参考 Claude 官方的
[创建 Skill 指南](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)
与[编写最佳实践](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices)：
用精确 `name`/`description` 支持发现，把主文件保持短小，并把按需细节放入
一层 references/examples/scripts。DSH 仍使用自己的 RC.2 Skill Provider，
不依赖 Claude Skills API。

## 2. 战术内容

```yaml
skillId:
version:
lifecycle:
title:
description:
scenarios: []
preconditions: []
exclusions: []
compatibility:
  taskTypes: []
  models: []
  tools: []
  environments: []
  dataClassificationCeiling:
stateMachine:
playbook:
expectedObservations:
verifierContract:
stopConditions:
rollback:
knownFailureModes:
conflictsWith:
dependsOn:
provenance:
metrics:
```

## 3. 状态机与 Playbook

状态机说明当前战术阶段和允许转换；Playbook 中每一步包含：

- stepId；
- action；
- tool；
- 前置/when；
- evidenceRequired；
- retryLimit；
- expected output。

Worker 收到的是 Advisor 编译后的 Directive，不需要自行解释完整复杂状态机。

## 4. 生命周期

```text
DRAFT
→ SIMULATION
→ CANARY
→ TESTING
→ STABLE
→ DEPRECATED
```

任一活动版本可进入 `QUARANTINED`。版本不可原地修改；修复发布新 SemVer。
安全降级支持 `STABLE→TESTING→CANARY→SIMULATION→DRAFT`；人工隔离版本在来源
仍有效并提供重新验证证据时可回到 `DRAFT`。来源已撤回的版本不能恢复。

### DRAFT

Museum/用户/工程师提出，尚不可自动分配。

### SIMULATION

使用 fixture、历史重放或 sandbox 验证状态机、安全和停止条件。

### CANARY

只对少量低风险真实 Task 分配，有明确样本、指标、停止和回滚。

### TESTING

扩大 Task 类型或模型范围，持续观察负面影响。

### STABLE

达到配置的证据阈值，才可成为默认候选。

## 5. 检索与合成

检索分层：

1. 硬过滤：生命周期、场景、前置、排除、环境、分类、工具/API 权限；
2. 召回：标签、语义、历史相似 Task、Failure Mode；
3. 排序：验收表现、上下文匹配、风险、成本、时效；
4. 召回 3～5 个候选；
5. Advisor 处理冲突和依赖；
6. 编译 1 个主战术 + 0～2 个补充为单一 Directive。

## 6. 效能证据级别

不要把“被分配”写成“有效”。记录：

```text
ASSIGNED
ACKNOWLEDGED
ATTEMPTED
COMPLETED
ACCEPTED
CONTRIBUTED
CAUSAL_SUPPORTED
```

- `ACCEPTED`：使用该战术的 Task 被接受；
- `CONTRIBUTED`：有前后对比或明确步骤证据支持增量贡献；
- `CAUSAL_SUPPORTED`：有可比对照/实验支持，仍应报告不确定性。

## 7. 版本和兼容

战术版本固定在 Task Order/Guidance。以下变化发布新版本：

- 前置/排除；
- 状态机；
- Playbook；
- Verifier；
- 权限/分类；
- Stop/Rollback；
- 语义改变。

仅补充非语义元数据可采用 patch 版本，但仍不可篡改已使用的 Artifact。

## 8. 安全和企业知识

- 战术可标注数据分类；
- 普通 Worker 无权浏览整个 Registry；
- Advisor 只检索授权集合；
- 战术不能包含原始凭据；
- API 调用使用 grant/credential reference；
- 对外模型不可接收受限战术内容；
- 战术本身也可能含 prompt injection，应经过安全审查和签名/来源检查。

## 9. DSH Skill 适配

- `ctx.militaryTactics` 是战术真源；
- `ctx.skills` 继续服务普通通用 Skill；
- Provider 只把通过实时权利检查的 STABLE 战术编译为精简 SkillDefinition；
- 完整状态机、指标和敏感 API grants 不直接暴露给 Worker；
- Scope 决定可见层。

## 10. 战术博物馆职责

Museum：

- 固化已使用版本；
- 聚合轨迹和效能；
- 发现可复用模式；
- 提出 DRAFT；
- 设计 Simulation/Canary；
- 提议隔离或弃用。

它没有 STABLE 发布权，也不能以单个成功案例自动晋级。

## 外部提炼与标签

私有战术可由用户显式选择的历史会话、直接经验或 Artifact 产生，但入口只生成 `TacticalExtractionCandidate`。Candidate 必须经过来源快照、Secret/PII/Injection 扫描、现有战术 Diff 和用户审批，才能形成 DRAFT。

战术引用稳定 `tagId`；标签重命名不修改 Skill 历史，暂停阻止自动投放，删除采用 tombstone。完整设计见[外部内容战术提炼与标签治理](33-tactical-ingestion-and-tag-governance.md)。

## 0.3.0：来源供应链和撤回

每个 Tactical Skill version 还需引用 Source Snapshot、license/allowed audience、dependency range、reviewAfter、revocation status 和派生影响索引。`STABLE` 只代表在限定环境通过治理，不代表永久正确。

来源撤回、依赖版本越界或新证据证明错误时，版本进入 `QUARANTINED/REVIEW_REQUIRED`，禁止新 Guidance；历史使用保留并按风险触发重新验证。

`SUPPLEMENT` 只能指向同一 owner 的现有、未隔离私有 Skill。新版本继承并合并
基础版本的 workflow、标签、前置、停止、Verifier、provenance 和全部来源谱系，
不会用一段补充材料覆盖既有过程。任一继承来源撤回都会阻止新投放并隔离所有
受影响派生版本。
