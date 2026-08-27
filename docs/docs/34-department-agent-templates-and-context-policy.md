# Military 可视化设置、部门模板与上下文策略

## 1. 产品边界

DSH 主侧栏 footer 注册独立的 `Military 设置中心` 入口，位置和交互方式与
“知识与技能”入口一致。点击后打开 DSH 原生 Modal；它不再占用通用 Settings
的 `settings.section`，也不要求用户编辑 YAML 或 JSON。

该页面覆盖 General 和全部 11 个内置部门模板：

- General；
- 通用技术参谋、React 前端参谋、参谋长；
- 快速反应部队 Worker；
- 工兵部 Engineer；
- 督战队 Inspector；
- Trajectory、Effectiveness、Museum；
- Evaluation Examiner 与 Committee Chair。

普通、安全的行为参数均使用下拉框、数字框、开关、日期选择器、多选项和标签
编辑器。ToolProfile、PermissionProfile、内部 identity、Task revision、幂等键、
终止工具和父级 receipt 属于 Host 治理合同，只读展示，不能通过设置削弱。

## 2. 页面信息架构

```text
DSH Sidebar Footer
├── Military 设置中心
│   ├── Military-部门模型
│   ├── Military-执行与成本
│   ├── Military-Specs 工作区
│   ├── Military-安全与恢复
│   ├── Military-战术与标签
│   ├── Military-绩效评估
│   └── Military-显示与进阶
├── 知识与技能
└── DSH Settings
```

`Military` 页面绑定 RC.2 shared Settings mirror 的 11 个 namespace：

| 分组 | Namespace | 可视化内容 |
|---|---|---|
| 部门模型 | `military-model-routing` | General 模型、推理强度、输出预算和简体中文提示词 override |
| 部门模型 | `military-agent-templates` | 11 个模板的模型、推理、输出、上下文、并发、压缩、状态和提示词 revision |
| 执行与成本 | `military-core` | Radio 尝试次数和 lease |
| 执行与成本 | `military-staff` | 参谋长兜底 |
| 执行与成本 | `military-memory` | Wave 轨迹和 General 压缩后效能评估 |
| 战术与标签 | `military-tactics` | 候选召回上下限和 Canary 投放 |
| 战术与标签 | `military-tags` | 标签新增、暂停、恢复和 tombstone 删除 |
| 安全与恢复 | `military-oversight` | 完成联锁、宿主证据、冻结和无进展上限 |
| Specs 工作区 | `military-specs` | 安全的本地提交前缀 |
| 绩效评估 | `military-evaluation` | 时间、模板、部门、工作区、Mission、基线、分类和结果 |
| 显示与进阶 | `military-presentation` | 军事/中性术语、审计密度和紧凑布局 |

完整 wire 契约见
[`military-settings.schema.json`](../schemas/military-settings.schema.json)；
[`settings.example.yml`](../examples/settings.example.yml) 只是 namespace 组合参考，
不是推荐的人工作业方式。

## 3. 模型下拉框

Host 通过 RC.2 `ctx.llm.listProviders/listModels/resolveModelInfo` 读取当前
provider/model 目录，再与 Military capability evidence 合并。浏览器只读取
`militaryControlPlane` 的已审计投影。每个下拉选项同时携带：

```text
provider + model + ModelCapabilityProfile
```

内置默认治理路线为：

| 路线 | 默认用途 | 状态 |
|---|---|---|
| `deepseek-official/deepseek-v4-flash` | General 与全部部门的轻量主力 | `CANARY`，内置模板显式允许 |
| `deepseek-official/deepseek-v4-pro` | 用户明确选择的重量升级路径 | 以当前 capability evidence 为准 |

不在真实目录中的已保存值以 `UNAVAILABLE` 只读显示，便于诊断漂移，但不能继续
选择。所有 live route（包括第三方 Provider）默认可选；没有 Military profile
时 Host 从 DSH 目录创建执行能力投影。`UNVERIFIED/CANARY/DEPRECATED` 只作为
能力或绩效 Evidence 展示，不充当权限。Host 持久化每个 exact route 的状态
revision、原因和证据；alias 未证明、价格未知和 tool-calling 未知都显式显示，
不用前端 allowlist 或假价格填充。

模型切换不会改变该角色的工具、文件权限、验证器、终止协议或父子恢复能力。
轻量化只改变执行模型与资源预算，不删除流程能力。

## 3.1 简体中文角色提示词

`Military-部门模型` 直接显示 General 和 11 个内置角色的完整提示词，不使用
隐藏 JSON 编辑器。默认文本来自
`@dsh-military/contracts/role-prompts`，针对 Flash 的短步骤、准确工具选择、
参数核对、单一终态动作和证据优先原则编写。

- General override 位于 `generalPromptOverride`，空值表示使用插件自带版本；
- 部门 override 位于 `AgentTemplateProfile.rolePromptOverride`，每次保存创建
  下一 immutable revision；
- 旧模板没有该字段时按 template ID 自动回落到自带提示词；
- 页面提供保存、逐角色恢复和全角色恢复；
- 输入限制为 32–12000 字符，正文必须包含足够的简体中文，只允许必要的英文
  技术标识和 `{{cwd}}` 模板变量；
- 辅助 lint 只扫描自然语言并跳过 fenced/inline code、路径、工具名、标识符
  和变量；用户可逐项/批量确认并撤销上一批；
- 保存时 Host 重新 lint 和应用 UTF-16 位置，生成 source/result hash、应用数、
  剩余数和确认时间的不可变回执；Client 伪造转换结果或遗漏确认会被拒绝；
- Prompt Surface 只替换 `deployment:persona` 中的可编辑角色正文。工具白名单、
  workspace path、binding/grant、证据和终态规则由 Host 随后追加，设置文本
  无法授予新工具、扩大权限或跳过验收。

编辑器的“有效提示词”来自真实 Prompt Assembly 使用的同一六层 Host 编译器，
显示可编辑正文、Host authority、工具/终态、Workspace、Evidence 和运行预算。
页面同时展示相对已保存/插件默认的语义 Diff、token 和简体中文字符估算。
确定性 Flash readiness 检查 Host 字段、路径猜测、权限暗示、停止规则、工具
存在性和 Schema 复杂度；`BLOCKED` 不能生产启用，也不会自动改用 Pro。

## 4. 默认轻量策略

General 默认：

```yaml
provider: deepseek-official
model: deepseek-v4-flash
reasoningEffort: high
maxOutputTokens: 16384
contextBudgetTokens: 128000
maximumSteps: 24
```

部门模板默认：

```yaml
model: deepseek-v4-flash
reasoningEffort: high
maxOutputTokens: 16384
contextBudgetTokens: 96000
compactionTriggerPercent: 78
retainedTailTokens: 20000
```

需要综合判断的参谋长、Museum 和 Evaluation Chair 默认使用 `max`，但仍使用
Flash；Pro 只有用户在对应模板卡中显式选择后才生效。模板显式携带
`allowCanaryModel: true`，因此 Flash 的 `CANARY` 状态不会被误当成自动 fallback。
系统不做隐式模型升级，也不会把 General 当前模型偷渡给子 Agent。

### Task 级轻量预算

General 可省略整个 `budget`，Host 会编译下列 Flash 安全默认值：

| 预算 | 默认值 | 实际执行边界 |
|---|---:|---|
| model steps | 16 | RC.2 `agent/pre-step`，另保留一个仅终态工具可见的收口 step |
| tool calls | 64 | 持久化 Capability Grant 的 `maximumUses` |
| Tactical Requests | 4 | 精确 `taskId + taskVersion` 的 Radio 事件计数 |
| child wall clock | 7200 秒 | 持久化并发 reservation 与每次 model step 准入 |
| output tokens | 16384 | 实际 LLM request 的 `maxTokens` |

显式预算只能在固定范围内取值，且与模板、Model Capability 和 Resource Policy
取最严格值，不能借设置扩大权限。`guidanceRequests: 0` 会直接从该 Task 的模型
工具面移除 `military_radio_request`，避免轻量模型调用必然失败的工具。

这些上限不通过删工具来牺牲完整能力：普通 Task 可以显式提高预算；超大 Specs
使用 Host 管理的分段 staging 和一次原子 apply，因此不要求模型在单次参数或
单次输出中承载完整大文档。

## 5. 模板修订与运行隔离

```text
templateId + revision
```

是绩效、审计和恢复的最小身份。每次可视化修改都从最新设置快照读取当前模板，
生成新的 immutable revision，并串行写回 registry；快速连续修改不会覆盖前一项
修改。已创建的 `AgentExecutionBinding` 继续使用创建时冻结的 revision，新 Agent
才使用最新 ACTIVE/CANARY revision。

每个 Binding 冻结：

- template、department 和 role；
- provider、model、reasoning 和 capability profile；
- ToolProfile、PermissionProfile、Verifier 与 API Grant revision；
- Task scope、Workspace、Lease 和预算；
- context/compaction policy；
- 父 Session 与 preset generation。

紧急撤权在下一次工具准入前收紧，而不是通过热改运行中模板实现。

历史 revision 还保留保存来源、Prompt Diff、完整 readiness、简体中文审阅回执
和当时的模型/预算。回滚创建新的 revision，不覆盖旧记录。角色页按 exact
revision 展示其 Session、model/tool 请求、observed tokens、工具成功率、模拟和
评测引用；Provider 没有价格时费用状态保持不可用。

## 6. 上下文与压缩

`contextBudgetTokens` 是 Military 行为预算，不是修改 provider 的物理 context
window。有效预算为：

```text
effectiveBudget = min(
  template.contextBudgetTokens,
  resolvedModelContextWindow - reservedOutputAndToolEnvelope
)
```

达到：

```text
floor(effectiveBudget × compactionTriggerPercent / 100)
```

后，Host 在下一次安全模型请求前创建幂等 `CompactionAttempt`。安全边界要求：

- 当前工具调用与结果已配对；
- Candidate/Specs/Git 终止事务没有进行中；
- Task Order、Acceptance、Guidance、Freeze 和未决决定已持久化；
- Inbox admission 可有序暂停。

压缩保留 identity、Task、验收条款、已接受事实、证据、工作区/Git 基线、当前
blocker、Guidance、决定和停止条件；重复日志和已外置的大文本可以裁剪。失败按
模板的 `onCompactionFailure` 升级或暂停，绝不伪造压缩成功。

## 7. 轻量模型可用性约束

设置只能调整性能与呈现，不能重新引入模型需要猜测的 Host 字段：

- Task、Candidate、Guidance、Decision 和 Specs 使用浅层模型草稿；
- identity、revision、scope、allowed tools、authority、timestamp 和 receipt
  由 Host 编译；
- 当前阶段只暴露当前可执行的工具；
- 错误返回稳定 code、一个具体原因和一个恢复动作；
- terminal mutation 先持久化领域结果与父级 receipt，再结束 turn；
- terminal success 后，同一 assistant response 的后续工具调用被闩锁拒绝；
- 大 Specs 使用 Host staging + 单次原子 apply，不以降低 token 上限删减能力。

因此，切换到 Pro 可以提高个别复杂任务的推理余量，但不是走通流程的前置条件。

## 8. 设置保存与恢复

- 所有普通字段使用 RC.2 `SettingsScope.set/unset`；
- 保存后立即读取 shared mirror，Host 未接受时显示明确失败；
- 同一模板或标签的快速修改按 Scope 串行化；
- “恢复默认”对模板创建新的 revision，不覆盖历史；
- 设置只影响后续请求或新 Agent，不改写已完成的性能归因；
- Evaluation 使用单调 `runNonce` 创建 durable Job；Settings 只保存
  `lastEvaluationRequestId`、`lastDatasetHash` 和 `lastReportId` pointer；
- SQLite/Artifact 保存 Frozen Dataset、exact-configuration shard、Report 与 Appeal，
  进程重启后重新取得 lease/fence 并只补缺失分片；
- 执行超时为 30～86400 秒，默认 1800 秒；无效日期、反向时间或非法超时直接记录
  结构化 `FAILED`，不会永久显示运行中；
- 旧版 `lastReportJson` 只用于读取迁移，新报告完成后清空，不作为报告仓库；
- 默认确定性叙述不调用模型；`COMMITTEE_MODEL` 必须显式选择且不能改变指标。

## 9. 固定安全边界

下列能力不会出现在可关闭的开关中：

- Session Workspace 隔离和路径 canonicalization；
- 远程 Git 写入、破坏性 reset 与跨工作区写入禁令；
- Engineer 原子写入、验证、本地提交、ledger 和 parent report；
- 权威宿主证据、幂等、预算结算和 capability admission；
- 用户取消优先级、父子终态恢复和重复报告去重；
- 冻结、验证、Integration 和 Completion Gate。

设置页显示这些治理事实，帮助用户理解系统，但不会把内部权限矩阵变成容易误配的
文本配置。

## 10. 验收条件

- DSH Settings 中 `Military` 与 `Agent 预设` 同级；
- General 和 11 个部门模板都有独立模型下拉框；
- 下拉框读取并核对真实 DSH 模型目录；
- Flash 是默认主力，Pro 仍可逐部门显式选择；
- 模型切换不改变工具、权限、验证、Git、恢复或审计能力；
- 所有实际可变 namespace 都有可视化控件或只读结果展示；
- 用户无需编辑 `profilesJson`、`tagsJson` 或 Evaluation JSON；
- 保存、快速连续修改、恢复默认和页面重载不丢字段；
- 设置只生成新模板 revision，运行中 Binding 不漂移；
- 普通非 Military Session 不获得 Military 运行工具或策略。
