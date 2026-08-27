# 包拓扑与依赖边界

## 1. 设计目标

`dsh-military` 对外可以作为一个 Bundle 安装，但内部不应实现成一个巨型插件。应遵循 DSH 的 Service Definition / Provider / Consumer seam 模式，把稳定领域契约、运行时控制、具体存储、模型消费者和 Web Client 分开。

核心原则：

- 领域层不导入 DSH 内部实现类型；
- 适配层只做协议映射，不持有业务真源；
- 任何一个 Provider 都可被替换；
- WebUI 只消费服务和事件，不直接改数据库；
- Worker、参谋、工兵和研究 Agent 使用同一领域协议，但拥有不同 Scope、工具、权限和推理策略；
- Bundle 仅负责组合，不实现领域逻辑。

## 2. 推荐仓库结构

```text
packages/
  military/
    contracts/                    # 领域类型、错误码、事件、Service Definition
    ledger/                       # ctx.militaryLedger 定义
    ledger-sqlite/                # 本地 Provider
    ledger-postgres/              # 企业 Provider（后续）
    runtime/                      # ctx.military；Mission/Direction/Wave/Task 生命周期
    planning/                     # 方向—波次—任务编译与 DAG 校验
    staff/                        # ctx.militaryStaff；参谋名册、会商和兵力生成
    staff-agent/                  # 参谋模型 Consumer
    radio/                        # ctx.militaryRadio 定义与 Broker
    radio-sqlite/                 # 本地队列 Provider
    tactics/                      # ctx.militaryTactics 定义
    tactics-git/                  # Git 版本化战术 Provider
    tactics-skill-adapter/        # ACTIVE/STABLE 战术到 ctx.skills 的编译视图
    verification/                 # ctx.militaryVerification；验收器注册表
    oversight/                    # ctx.militaryOversight；确定性联锁和冻结
    oversight-agent/              # 只读语义督战 Agent
    artifacts/                    # ctx.militaryArtifacts 定义
    artifacts-local/              # 本地内容寻址存储
    specs/                        # ctx.militarySpecs；specs 生命周期
    git/                          # ctx.militaryGit 定义
    git-local-main/               # 受限本地 main Git Provider
    memory/                       # ctx.militaryMemory；三类研究任务编排
    trajectory-agent/             # 战术轨迹记忆总结
    effectiveness-agent/          # 战术效能评估
    museum-agent/                 # 战术博物馆
    metrics/                      # ctx.militaryMetrics 定义
    metrics-otel/                 # OTel Provider
    tools-worker/                 # Worker 的领域工具 Consumer
    tools-staff/                  # 参谋工具 Consumer
    tools-engineer/               # 工兵工具 Consumer
    tools-general/                # 将军工具 Consumer
    adapters-dsh-agent/           # ctx.agents / hooks 薄适配
    adapters-dsh-session/         # SessionEvent 镜像和重放
    adapters-dsh-tools/           # tools pipeline 适配
    adapters-dsh-skill/           # ctx.skills 适配
    adapters-dsh-compaction/      # compaction 事件适配
    web-host/                     # Settings/API Host 半部
    web-client/                   # Settings cards、Conversation Nodes、运行态面板
    preset-military/              # 固定 system preset 资产包
    preset-installer/             # 解析资产路径并生成完整 roster profile overlay
    tags/                         # ctx.militaryTags 与标签生命周期
    ingestion/                    # ctx.militaryIngestion 与来源快照/审阅
    agent-templates/              # 子代理模板 revision 与 effective policy
    context-policy/               # per-agent context budget/compaction trigger
    command-brainstorm/           # agent-scoped /brainstorm
    chief-of-staff-agent/         # 参谋长模型 Consumer
    evaluation/                   # 跨会话 dataset/job/report
    evaluation-examiner-agent/    # 单模板评估
    evaluation-chair-agent/       # 总体绩效合成
  bundle/
    military/                     # @your-org/dsh-military；只做 cordis.patch.yml 组合
```

MVP 可以合并少量实现包，但 `contracts`、`runtime`、`verification`、`oversight`、`specs/git` 与 `web-client` 仍应保持边界。

## 3. 服务清单

| `ctx` 键 | 类型 | 职责 |
|---|---|---|
| `ctx.military` | Runtime | 启动/恢复 Mission，调度 Direction/Wave/Task，持有 Agent Handle |
| `ctx.militaryLedger` | Store | 追加不可变事件、CAS 状态迁移、读取投影 |
| `ctx.militaryPlanning` | Engine | Mission Intent → Direction/Wave/Task；DAG、粒度和冲突检查 |
| `ctx.militaryStaff` | Runtime | 参谋注册、资格过滤、会商、主责参谋选择、兵力生成 |
| `ctx.militaryRadio` | Runtime | 战术请求队列、租约、去重、投递、死信 |
| `ctx.militaryTactics` | Registry | 私有战术版本、生命周期、检索、编译、回滚 |
| `ctx.militaryVerification` | Registry/Engine | 验收器注册、执行、证据覆盖、最终判定 |
| `ctx.militaryOversight` | Controller | 完成联锁、冻结/释放、工具纪律、异常政策 |
| `ctx.militaryArtifacts` | Store | 内容寻址证据、Diff、测试日志和文档产物 |
| `ctx.militarySpecs` | Engine | specs 基线、维护命令、追踪矩阵和一致性检查 |
| `ctx.militaryGit` | Executor | 受限本地 main 初始化、提交和证明 |
| `ctx.militaryMemory` | Runtime | 轨迹、效能、博物馆任务及向将军汇报 |
| `ctx.militaryMetrics` | Service | 指标、追踪、成本、效能实验 |
| `ctx.militaryWorkspace` | Runtime | 工作区快照、锁、隔离 worktree 或 sandbox |
| `ctx.militarySessionGate` | Policy/Service | actual preset 准入、MilitarySessionBinding、父子 generation 对账 |
| `ctx.militaryAgentTemplates` | Registry | 非 General 子代理模板、revision、模型与 Context Policy |
| `ctx.militaryTags` | Registry | 战术标签、alias、暂停、重命名和 tombstone |
| `ctx.militaryIngestion` | Runtime | 来源授权、快照、提炼 Job、Candidate 审阅和 Draft 提交 |
| `ctx.militaryDecisionBroker` | Runtime | 子代理问题集去重、投递给 General、回答回执 |
| `ctx.militaryBrainstorm` | Runtime | `/brainstorm` Order、阶段、暂停恢复与 specs handoff |
| `ctx.militaryChiefOfStaff` | Executor | 战术不足时生成 GENERATED_REFERENCE Advice |
| `ctx.militaryEvaluation` | Runtime | 跨会话 Dataset、Examiner 分片、Chair 与双部分报告 |
| `ctx.militaryAdministrativeLedger` | Store | 标签、模板、提炼和绩效等跨会话管理事实 |

## 4. 依赖方向

```text
contracts
  ↑
ledger / artifacts / metrics / tactics / verification / git
  ↑
planning / staff / radio / specs / oversight / memory
  ↑
runtime
  ↑
tools-* / *-agent / adapters-dsh-*
  ↑
web-host / web-client / bundle
```

禁止反向依赖：

- `contracts` 不依赖任何 Provider；
- `runtime` 不导入 SQLite、Git CLI、Web Client；
- Web Client 不直接访问存储；
- 验收器不能调用“接受任务”之外的任务变更 API；
- Agent 消费者不能获得 Ledger 的任意写权限；
- Bundle 不包含业务状态机。

## 5. 模型面对的领域工具

所有角色都有：

```text
military_get_context
military_read_artifact
```

`military_get_context` 是每个 Military turn 的首个工具：它返回权威
root Session、Mission、Brainstorm Order 与分配 Task。模型不得猜测这些 ID。

### Worker

```text
military_get_order
military_get_tactical_directive
military_record_observation
military_submit_candidate
military_submit_blocker
military_radio_request
military_submit_decision_questions
```

Worker 不应拥有：

```text
military_accept_result
military_change_acceptance
military_create_agent
military_freeze_agent
military_specs_write
military_git_commit
military_publish_tactic
```

### 工兵

```text
military_specs_read
military_specs_apply_order
```

`military_specs_apply_order` 在 Host 内原子完成写入、验证、本地提交与 receipt；
Engineer 不再看到独立 validate/commit 工具。

### 参谋

```text
military_staff_read_mission
military_staff_retrieve_tactics
military_staff_issue_guidance
military_staff_chief_advice
military_submit_decision_questions
```

### 将军

```text
military_mission_start
military_task_create
military_task_get
military_spawn_department_agent
military_radio_poll
military_radio_issue
military_decision_present
military_decision_answer
military_tactical_ingest
military_tactical_review
military_evaluation_start
military_evaluation_get
military_status
```

`military_task_create` 只向模型公开浅层语义草稿；Host 生成全部 identity、
version fence、复杂度、证据合同和环境快照。工具注册表保存稳定并集，但 RC.2
agent-scoped visibility 在首次 prompt 前按 immutable ToolProfile 裁剪；运行时
角色与 Capability Grant guard 仍是权威边界。

## 6. Service Definition 与 Provider 分离示例

```ts
// contracts / service definition
export abstract class MilitaryLedger {
  abstract append(event: MissionEvent, expectedRevision?: number): Promise<AppendReceipt>
  abstract readMission(missionId: MissionId, options?: ReadOptions): Promise<MissionSnapshot>
  abstract subscribe(missionId: MissionId, listener: MissionEventListener): () => void
}

// provider
export class SqliteMilitaryLedger extends MilitaryLedger {
  // SQLite 事务、唯一键、CAS 和 durable subscription
}

// consumer
export class MilitaryRuntime {
  constructor(private readonly ledger: MilitaryLedger) {}
}
```

## 7. Bundle 包

```text
@your-org/dsh-military
  package.json
  cordis.patch.yml
  lib/index.js
  README.md
```

`cordis.patch.yml` 按以下顺序组合：

1. 领域 Service Definitions；
2. 本地默认 Providers；
3. Runtime 和 Policies；
4. DSH adapters；
5. 模型工具与角色 Agent；
6. Host 配置；
7. Web Client 模块。

用户的 profile 或 home patch 位于 Bundle 之后，可替换：

- SQLite → PostgreSQL；
- 本地 Artifact → S3；
- 本地 Radio → NATS/Kafka；
- 默认模型与 reasoning policy；
- Verifier；
- 企业 API Gateway；
- 参谋名单。

## 8. 版本策略

- Bundle 与领域包使用统一 SemVer；
- Mission Event、Task Order、Tactical Skill 各有独立 `schemaVersion`；
- 数据库 migration 版本与 NPM 版本分开；
- DSH adapter 包显式记录支持的 DSH commit/版本区间；
- 破坏性 DSH 变化只要求修改 adapters 和契约重放测试；
- 私有战术版本不得与软件包版本混用。

## 0.2.0 包拓扑增量

推荐新增包：

```text
preset-military/                 # 固定 preset 资产包
preset-installer/                # 保留现有 roots 的完整 profile overlay 生成器
adapters-dsh-preset/             # actual preset、mount/composeFrom 薄适配
tags/ + tags-sqlite/             # ctx.militaryTags
ingestion/ + ingestion-agent/    # ctx.militaryIngestion
agent-templates/                 # ctx.militaryAgentTemplates
context-policy/                  # per-agent budget/compaction policy
command-brainstorm/              # agent-scoped /brainstorm
agent-chief-of-staff/            # 参谋长模型 Consumer
evaluation/                      # Job、dataset、rubric、report
agent-evaluation-examiner/
agent-evaluation-chair/
web-client-performance/
```

以上示意中的空格应在实际包名中移除；文档故意把能力拆开，避免 Bundle 巨型化。

Bundle patch 挂载 Host Plane Provider、Settings 和 preset root；`military/agent.cordis.yml` 只挂模型面对的 Agent Plane Consumer。

## 0.3.0：新增实现包建议

为避免巨型插件，增加下列独立 seam/provider/consumer：

```text
dsh-military-contracts-generated
dsh-military-preset-generations
dsh-military-compatibility-rc2
dsh-military-authorization
dsh-military-policy-registry
dsh-military-general-routing
dsh-military-workspace
dsh-military-integration-git
dsh-military-ledger-sqlite
dsh-military-outbox
dsh-military-decision-broker
dsh-military-budget
dsh-military-knowledge-supply-chain
dsh-military-evaluation-dataset
dsh-military-bundle-lifecycle
dsh-military-client
```

`dsh-military-bundle` 只组合这些包。RC.2 特定调用放在 `adapters-dsh-rc2-*`，领域服务不得导入 DSH Agent Loop 私有实现。Preset 资产和 generation archive 可作为独立只读包交付。

Host-only Registry 与 Agent-plane tool/prompt 分离；需要按 Agent 地址读取 isolate service 的路径使用 RC.2 支持的 preset/service addressing adapter，而不是把服务泄漏到 root realm。

## 0.3.0 最终服务增量

实现收敛后还应提供以下独立 seam，而不是塞入 `ctx.military`：

| `ctx` 键 | 职责 |
|---|---|
| `ctx.militaryPresetGenerations` | Generation Manifest、archive、Resume Receipt 与 Migration |
| `ctx.militaryCompatibility` | RC.2 Feature Probe 与启动 disposition |
| `ctx.militaryAuthorization` | Authority Context、授权、撤权和 deny-first 判断 |
| `ctx.militaryPolicies` | Tool/Permission/API/Residency/Redaction/Verifier/Model/Budget versioned registry |
| `ctx.militaryGeneralRouting` | preset 默认、会话模型选择和 `ModelSelectionReceipt` |
| `ctx.militaryAgentBindings` | 非 General Agent 的不可变 `AgentExecutionBinding` |
| `ctx.militaryIntegration` | Candidate Patch 队列、冲突、回归与 local `main` Receipt |
| `ctx.militaryResourceBudgets` | 多级 reservation、lease 回收和 usage settlement |
| `ctx.militaryEvaluationDataset` | 可复现 Dataset Manifest |
| `ctx.militaryEvaluationAppeals` | 报告申诉、复评和 superseding revision |
| `ctx.militaryKnowledgeSupplyChain` | 来源、派生图、撤回和影响评估 |
| `ctx.militaryBundleLifecycle` | install/upgrade/rollback/disable/uninstall Saga |

这些接口的参考签名位于 [`reference/types/services.ts`](../reference/types/services.ts)。Provider 可合并部署，但 Service Definition 不能因 MVP 共用数据库而消失。
