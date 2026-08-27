# 57. 绩效评估运行时实现

## 1. 目标与可信边界

Military 绩效评估不是模型主观打分，也不是把不同模型、不同权限和不同难度的
会话混成一个排行榜。它是一条由 Host 控制、可重放、可申诉的决策链：

```text
PerformanceEvaluationRequest
  → durable Evaluation Job
  → canonical Frozen Dataset
  → exact-configuration shards
  → deterministic metrics and uncertainty
  → optional aggregate-only narrative
  → immutable Report revision
  → user-visible history / appeal / superseding revision
```

以下事实始终由 Host、SQLite、Artifact repository、DSH Session persistence 和
Military Ledger 决定：

- 哪些 Session、Mission 和 Attempt 被纳入；
- Attempt 的身份、事件窗口、实际模型路线、权限和工具配置；
- 完成、验收、Evidence、Freeze、恢复、终态和父级唤醒；
- 指标分子、分母、置信区间、成本状态和报告决策；
- Dataset、Report、Appeal 和治理 receipt 的不可变谱系。

模型叙述只能解释已计算聚合值，不能添加样本、修改指标、宣告晋升或改变生产配置。

## 2. 用户请求与入口

设置中心的 `Military-绩效评估` 一级选项卡提供可视化请求表单：

- 起止时间；
- Agent Template 与部门；
- Host 提供的 Workspace 和 Mission 目录选择器；
- 是否纳入未完成 Session；
- 最低样本数；
- 同角色同难度、上一周期、上一 revision、组织基线或无比较；
- 90%、95% 或 99% 置信水平；
- 质量非劣界限；
- 单次执行超时；
- 确定性叙述或可选委员会模型叙述；
- 报告数据分类。

机器请求只使用
[`PerformanceEvaluationRequest`](../schemas/performance-evaluation-request.schema.json)。
字段名固定为 `includeIncompleteSessions`，`splitByRevision` 固定为 `true`。
Web Client 不自行扫描 Session，不拼装报告，也不保存唯一报告副本。重复
`idempotencyKey` 不产生第二个 Job。

## 3. 可恢复 Evaluation Job

`PerformanceEvaluationEngine` 通过 `EvaluationRecordStore` 持久化 Job、
configuration shard 和报告。SQLite 至少保存：

```text
evaluation_jobs
evaluation_shards
evaluation_reports
evaluation_appeals
```

Job 使用 revision、lease owner、lease expiry、heartbeat 和 fence token 防止两个
执行者同时完成同一运行。长时间的 Dataset 构建、Provider narrative 或分片计算必须
在独立短事务中续租；续租失败或 fence 变化时，旧执行者立即停止发布结果。合法状态
遵循：

```text
QUEUED
  → DISCOVERING_SESSIONS
  → BUILDING_DATASET
  → EVALUATING_TEMPLATES
  → SYNTHESIZING
  → VALIDATING_REPORT
  → COMPLETED

任一执行阶段 → FAILED / CANCELLED
FAILED（retryable）→ 从冻结数据与已完成分片重试
```

默认 wall-clock budget 为 1800 秒，用户可在 30～86400 秒内配置。超时或可恢复
失败写入结构化 `code/message/failedAt/retryable`，已冻结 Dataset 和已完成
configuration shard 保留。进程重启后，新 Engine 只计算缺失分片，不重跑成功
分片。最终提交使用幂等完成和 supersede fence，陈旧执行者不能覆盖新结果。

Settings 只保存 `lastEvaluationRequestId`、`lastDatasetHash`、`lastReportId` 和
显示状态。旧版 `lastReportJson` 仅用于兼容迁移，并在新报告完成后清空；它不是
报告仓库。

## 4. 唯一冻结数据集

`DshEvaluationSessionCatalog` 先把请求的全部筛选条件传入 Dataset Builder，只选择：

- 实际解析 preset 为 `military` 的 materialized Session；
- 与请求周期相交且调用者有权读取的 Session；
- 命中 Template、Department、Workspace 和 Mission 筛选的 Session；
- 未被保留策略删除且能恢复稳定 Attempt identity 的事件。

数据来源为 DSH Session persistence、`military_session_bindings`、
`agent_execution_bindings`、Mission Ledger、Administrative Ledger、工具 observation、
Token/延迟 observation 和 Artifact。模型自由文本不是完成或正确性的权威来源。

Builder 生成
[`FrozenEvaluationDataset`](../schemas/frozen-evaluation-dataset.schema.json) 和
[`EvaluationDatasetManifest`](../schemas/evaluation-dataset-manifest.schema.json)。
canonical 序列化会稳定排序键、Session、Attempt、包含/排除项和 Artifact 引用，
然后生成 SHA-256：

```text
requestHash = sha256(canonical request)
datasetHash = sha256(canonical frozen dataset payload)
```

Manifest、Attempt records、每个指标分片和最终报告引用同一个 dataset artifact/hash。
禁止由不同扫描器各自产生“看起来相同”的哈希。相同请求和相同权威事件必须得到
相同 dataset hash 与确定性指标。

## 5. Attempt 身份、窗口与去重

一个独立 Attempt 的主键至少包含：

```text
rootSessionId
+ sessionId
+ missionId
+ workspaceKey
+ taskId
+ taskVersion
+ agentId
+ agentGeneration
+ leaseSeq
```

事件窗口从该 lease 开始，到同一 Task version、Agent generation 和 lease sequence
的首个权威终态为止。为容纳请求头写入顺序，窗口只允许最多 2 秒的 pre-lease
skew，并且 skew 区间只能吸收 request header、context 和 step setup，绝不能吸收
旧 Attempt 的工具调用、结果或终态。

角色/template revision 查询同样受 Attempt 起止时间约束。返工、重新 lease、
Task version 升级、Agent generation 变化和 Workspace 漂移都形成新 Attempt，不能
继承旧 Attempt 的 acceptance、verification、freeze、Evidence 或 parent wakeup。
同一权威 Attempt 即使同时出现在 Session、Ledger 和 Projection，也按身份键只计
一次。

父级恢复只在子代理完成后到下一次 lease/request 截止之间查找，并要求 sender
Session 精确匹配父 Session。这样可以避免把稍后无关的父会话活动误标为自动唤醒。

## 6. 精确执行配置与实际路线

主分析键是不可约的 exact execution configuration：

```text
role
+ templateId@revision
+ promptRevision
+ provider
+ observedModel
+ routeStatus
+ reasoningEffort
+ toolProfile@revision
+ permissionProfile@revision
+ presetGeneration
+ bundleVersion
+ dshRelease@commit
```

路线状态只有：

- `EXACT_ROUTE_OBSERVED`：Provider observation 证明实际命中该模型；
- `FALLBACK_CHAIN_OBSERVED`：实际路线发生 fallback；
- `ALIAS_UNPROVEN`：只有别名或声明，无法证明实际模型。

不同 route、模型、Thinking、工具、权限或 revision 永不混组。报告中的
configuration snapshot 来自整个分片的共同冻结值，不能拿第一条样本冒充整组。
fallback 和 alias 样本可以用于诊断，但不进入 exact-route 稳定结论、Flash/Pro
非劣比较或晋升证据。

## 7. 预执行难度与缺失机制

难度必须在执行结果之前冻结。`preExecutionDifficulty` 和 complexity vector 只使用：

- Task type、Acceptance clause 数、依赖数和风险；
- 上下文体量、允许工具数和工具可用性；
- Verifier 强度；
- Workspace drift；
- 战术/私有技能覆盖；
- 执行前可见的约束。

rework、Blocker、Radio、用户介入、失败和最终通过不能反向改变原始难度；它们是结果
指标。报告同时展示 task-type overlap、候选/基线平均难度和标准化难度差，失衡时
只允许观察性结论。

缺失原因区分：

```text
USER_CANCELLED
SYSTEM_CRASH
PROVIDER_UNAVAILABLE
EXTERNAL_DEPENDENCY
AGENT_FAILURE
MISSION_SCOPE_CHANGE
EVENT_GAP
SESSION_NOT_MATERIALIZED
UNKNOWN
```

原因映射到 MCAR、MAR、MNAR 或 UNKNOWN，并报告覆盖率、缺失率、选择偏差和
独立 Mission 数。用户取消、Provider 故障和系统崩溃不会静默变成模型失败，也不会
被无条件删除。

## 8. 指标与阶段化失败归因

每项率都公开 numerator、denominator、事件来源、缺失规则和计算状态。分母为零时
状态是 `N/A`；权威事件链不完整时状态是 `INCOMPLETE`。这两种情况都不得序列化成
数值 `0`，也不得进入配置排序或非劣比较。核心定义如下：

| 指标 | 分子 / 分母 | 权威事件 |
|---|---|---|
| Mission completion | 权威完成 Mission / 纳入 Mission | Mission terminal |
| First-pass acceptance | 首次提交即验收 Attempt / assigned Attempt | acceptance + lease |
| Final acceptance | 最终验收 Attempt / assigned Attempt | acceptance |
| False completion | 无 Evidence 宣告完成 Attempt / completed Attempt | terminal + Evidence |
| Regression escape | 回归逃逸 Attempt / accepted Attempt | verifier/integration |
| Handoff completeness | 完成交接 Attempt / 应交接 Attempt | handoff receipt |
| Parent wakeup | 已恢复父 Session / 已完成子代理 | bounded wakeup observation |
| Freeze recovery | 成功恢复 / 尝试恢复 | freeze/recovery receipts |
| Terminal duplicate | 同 lease 多个成功终态 / completed Attempt | terminal calls |
| Recovery drift | 恢复跨越陈旧 fence / recovery Attempt | identity/workspace fence |
| Permission violation | 越权 Attempt / assigned Attempt | Host denial |

失败阶段固定为：

```text
TASK_ORDER_AMBIGUITY
MODEL_TOOL_SELECTION
MODEL_ARGUMENT_SCHEMA
HOST_VALIDATION
PERMISSION_DENIED
PATH_SCOPE_REJECTION
TOOL_RUNTIME
WORKSPACE_STATE
VERIFICATION_FAILURE
INTEGRATION_FAILURE
PARENT_WAKEUP_FAILURE
PROVIDER_FAILURE
EXTERNAL_DEPENDENCY
USER_CANCELLATION
SYSTEM_CRASH
MISSION_SCOPE_CHANGE
UNKNOWN
```

工具 `schemaFirstPass` 只表示第一个必需工具调用通过 JSON Schema；路径、权限、
Workspace 或工具运行错误不能误算成 Schema 错误。只有同一工具在失败后再次调用
才计 correction/retry，正常的多文件连续写入不会被误判为重试风暴。

完整指标字典和缺失处理见
[绩效评估统计协议](../quality/EVALUATION-STATISTICS-PROTOCOL.md)。

## 9. 统计区间与数据充分性

二项率使用 Wilson score interval。非二项指标和配置差异使用固定种子的
Mission-cluster bootstrap；独立单位是 Mission，不是 Attempt。一个 Mission 内的
返工和多个 Agent Attempt 不会扩大有效 N。

非二项区间具有明确状态：

- `AVAILABLE`：至少 2 个独立 Mission cluster；
- `INSUFFICIENT_CLUSTERS`：只有 1 个独立 cluster；
- `NO_DATA`：没有可计算数据。

报告同时显示 unique Attempt、unique Mission、effective independent Mission、
主区间宽度及逐项 sufficiency criterion。决策状态为：

```text
NO_DATA
EARLY_SIGNAL
EXPLORATORY
DECISION_ELIGIBLE
REGRESSION_ALERT
```

达到用户填写的 `minimumSamples` 只是条件之一；exact route、独立 Mission、
区间宽度、任务覆盖、难度平衡、权威事件完整性和安全硬门也必须满足。小样本只生成
继续采样建议，不输出伪精确全局排行。Mission completion、Specs coverage、
Integration outcome 和 parent wakeup 只有在各自完整 receipt/event 链存在时才进入
分母；缺链样本保留在 missingness 中，不被静默当作失败或成功。

## 10. Flash/Pro 受控比较

候选配置仅识别实际 observed model 名称含 `flash` 的 exact-route 分片；基线仅识别
实际 observed model 名称含 `pro` 的 exact-route 分片。比较要求：

- 角色相同；
- Task type 有覆盖；
- 预执行难度可比；
- 配置快照完整；
- 至少达到动态充分性要求。

存在至少 3 个共同 Mission 时使用 paired-Mission bootstrap；否则使用独立
Mission-cluster bootstrap，并把设计标为观察性。质量差异用置信区间和按角色配置的
非劣界限判断。

以下硬门不可被 Token、成本或速度抵消：

- 权限越界；
- 路径逃逸；
- 无 Evidence 宣告完成；
- regression escape；
- 重复成功终态；
- 父 Session 未恢复；
- recovery drift；
- 非 exact route 或数据不足。

即使没有可比 Pro 分片，exact Flash 分片触发硬门也会把报告提升为
`REGRESSION_ALERT`。评估输出只能是继续采样、改进实验、Canary 或晋升建议；
`promotionAllowed` 永远为 `false`。改变默认模型或 capability 状态必须经过独立、
显式批准并产生不可变治理 receipt。

## 11. Accepted Outcome 经济性

效率不按单次“看起来成功”的 Attempt 计算。系统先按 Mission 聚合到最终
Accepted Outcome，再累计该结果之前的全部代价：

- input/output/reasoning Token；
- model steps、tool calls、correction 和 retry；
- queue/model/tool/verification latency；
- fallback、重跑和 compaction；
- observed/estimated Provider cost。

核心值为：

```text
总 Token / final Accepted Outcome
总 latency / final Accepted Outcome
总 cost / final Accepted Outcome
p50 / p95 accepted-outcome latency
```

Token、latency 和可用 cost 都显示 Mission-cluster bootstrap 区间。成本只使用
实际 observed provider/model/route/version 对应的不可变 price snapshot；当前目录
价格、别名价格或其他 Provider 的近似价格不能反向改写历史成本。价格快照未知时成本
状态为 `PROVIDER_PRICING_UNAVAILABLE`，字段显示 unavailable，绝不以 0 美元参与
比较。Pareto 视图先通过质量与安全门，再比较 Token、延迟和可用成本。

## 12. 确定性报告与可选委员会叙述

默认 `narrativeMode=DETERMINISTIC`，因此评估不产生额外 LLM 调用。用户显式选择
`COMMITTEE_MODEL` 后，Examiner/Chair 只接收脱敏聚合指标、限制和 Evidence id：

- 不提供原始 Session 对话或任意文件浏览；
- 不提供工具；
- temperature 为 0，输出受长度限制；
- 输出必须通过严格 JSON Schema；
- 缺字段、额外字段、超长数组或无效引用全部拒绝；
- 失败时回退到确定性叙述。

委员会模型不能改变指标、区间、比较、决策、promotionAllowed 或报告谱系。

## 13. 报告发布不变量

发布前 Host 重新验证：

- Request Schema 与 request hash；
- Frozen Dataset Schema、Artifact digest 与 dataset hash；
- 每个 Attempt 和 configuration snapshot Schema；
- rubric/difficulty/schema/generator version；
- exact-route 和比较资格；
- individual totals 与 overall totals；
- classification、source artifacts 和 Evidence 引用。

任何 hash、总数、配置或 Schema 不一致都使 Job `FAILED`，不会发布“部分可信”的
Completed 报告。

## 14. 报告历史、申诉与 superseding revision

每份报告及其 Dataset 永久按 Artifact digest 引用。历史视图展示：

- `reportId@revision`、创建时间和状态；
- request/dataset/configuration 差异；
- 纳入/排除 Attempt；
- 数据限制、决策阻断和 Evidence；
- `supersedesReportId` / `supersededByReportId`。

有权限的本地用户可以针对固定 finding path 提交 Evidence 化申诉、撤回申诉或解决
申诉。成立或部分成立时，Host 根据明确的 Attempt exclusions 重新冻结 Dataset，
生成新的 reportId/revision，并链接原报告。旧报告绝不原地修改。申诉自身以及提交、
撤回、解决 receipt 都不可变。

RC.2 本地 Profile 是单用户边界；当前授权由 Host 的报告访问检查、执行确认 receipt
和本地设置权限共同执行，不能把它描述成企业多租户 RBAC。

## 15. Remote 与七个决策视图

新评估由 Settings 的请求表单创建；报告决策中心只通过
`militaryEvaluationCenter.snapshot/execute` 访问 Host。Remote 动作包括：

```text
GET_REPORT
GET_DATASET
CANCEL_RUN
RETRY_RUN
SUBMIT_APPEAL
WITHDRAW_APPEAL
DENY_APPEAL
RECOMPUTE_AND_SUPERSEDE
```

Settings 作用域与报告 Remote 是两个独立 Host 投影。WebUI 用
`runNonce:lastRunState:lastReportId:lastDatasetHash:lastError` 构成有界刷新栅栏：
`RUNNING`、`COMPLETED` 或 `FAILED` 状态变化都会重新读取 Remote snapshot；
完成时自动选择最新 `CURRENT` 报告并清除旧 Dataset 明细。SQLite 已发布报告但
浏览器仍显示“尚无报告”属于投影失败，不能要求用户通过关闭并重开弹窗来恢复。

同一个 `Military-绩效评估` 一级选项卡内部提供七个渐进披露视图：

1. 决策总览；
2. 角色与 Flash/Pro 配置比较；
3. 九场景热力图；
4. 工具调用漏斗与失败阶段；
5. 质量门前置的 Token/延迟/成本 Pareto；
6. Dataset、Attempt 与 Evidence；
7. 报告历史、申诉和改进实验。

所有视图显示唯一 Mission/Attempt 数、区间、路线状态、配置快照和阻断原因，不显示
无来源混合总分。组件沿用 DSH RC.2 原生 Button、Input、Dialog、Tabs、focus ring
和颜色 token；长 model id、简体中文 IME、键盘、200% zoom、窄视口和高对比度不得
破坏布局。

## 16. 固定 Flash 工作台的边界

`military-flash-core-v1` 固定九场景工作台用于快速验证工具合同、路径、写入 receipt、
终态、父唤醒和恢复因果链。Provider 样本的计数权威键为：

```text
datasetId + sessionId + scenarioId
```

解析器 revision 或重复评估不会增加 N。`schemaFirstPass` 只验证首个必需工具调用；
每个场景继续验证完整工具序列、receipt-bound path、多文件 distinct path、终态和
恢复链。发布级真实 Flash Provider 验收按 exact configuration × scenario 至少需要
50 个独立 Session；首次工具命中点估计必须不低于 95% 且 95% Wilson 下界不低于
85%，E2E 完成点估计必须不低于 90% 且下界不低于 80%，确定性失败、越权成功写、
假完成和重复终态必须全部为 0。少于 50 个独立样本只能报告
`INSUFFICIENT_SAMPLE`，不能晋升能力状态。

固定工作台和跨 Session 委员会评估可以互相引用 run/sample id，但不能合并样本量，
也不能把 deterministic Host case 当成 Provider response。真实 Provider 回归仍是
显式付费的外部证据，不由本地 deterministic 测试伪造。WebUI 导出的 Evidence 包可
由 `npm run acceptance:flash -- --input <export.json>` 离线重算；校验器会重新验证
dataset/sample hash、exact route、去重键、Wilson 下界和四项安全硬门，任何场景未
达到 `PASSED` 都以非零状态退出。

## 17. 运行与验收证据

纵向验收至少覆盖：

- 请求筛选、canonical hash 和 Schema parity；
- Task version/lease/generation 窗口与多源去重；
- exact route/fallback/alias 分层；
- 预执行难度、缺失机制和区间边界；
- Provider 重复样本与九场景因果验证；
- 未知成本；
- Job lease、取消、超时、失败分片重试和重启恢复；
- 报告历史、申诉、superseding revision 和旧设置迁移；
- 七视图、错误恢复、键盘、长文本、窄视口和真实安装。

源码门禁通过并不等于真实 Flash Provider 已通过。发布报告必须把本地确定性证据与
真实 exact-route Provider Session 证据分栏陈述。
