# 48. 绩效评估统计、公平性与申诉

## 1. 统计问题

绩效评估需要回答的是：

> 在同一角色、同类任务、相近预执行难度和精确执行配置下，某个配置是否以可接受的
> 质量与安全完成任务；如果它更便宜或更快，这些优势是否建立在最终 Accepted
> Outcome 上，而不是建立在漏算重试、失败或 fallback 上。

它不回答“哪个模型绝对最聪明”，也不从观察性历史数据宣称因果关系。

## 2. 冻结分析总体

每次运行先冻结唯一
[`FrozenEvaluationDataset`](../schemas/frozen-evaluation-dataset.schema.json) 和
[`EvaluationDatasetManifest`](../schemas/evaluation-dataset-manifest.schema.json)。
Manifest 记录：

- 完整 `PerformanceEvaluationRequest` 与 request hash；
- actual preset、时间、Template、Department、Workspace、Mission 筛选；
- 纳入和排除 Session/Attempt 及理由；
- exact configuration strata；
- 难度模型、rubric、Schema 和 generator version；
- 数据分类、去标识化与源 Artifact；
- canonical dataset artifact 和 SHA-256。

Dataset hash 由 canonical frozen payload 唯一生成。指标引擎、报告和申诉重算不能
各自重新扫描并产生另一套总体。

## 3. 分析单位与独立单位

观察单位是具有稳定 identity 和 lease 事件窗口的 Attempt。主分层单位是：

```text
role
+ templateId@revision
+ promptRevision
+ provider/observedModel/routeStatus
+ reasoningEffort
+ toolProfile@revision
+ permissionProfile@revision
+ presetGeneration
+ bundleVersion
+ dshRelease@commit
```

统计独立单位是 Mission。一个 Mission 中的多个 Task、返工、重试、Agent generation
或 lease Attempt 必须一起 resample，不能冒充多个独立实验。UI 同时显示：

- unique Attempt count；
- unique Mission count；
- effective independent Mission count；
- Session count。

## 4. 预执行难度

`difficulty-v2` 只使用执行前可见特征：

- Task type 和 complexity vector；
- risk class、Acceptance clause 和 dependency；
- context footprint；
- allowed tool count 与工具可用性；
- verifier strength；
- Workspace drift；
- tactical coverage。

结果期的 rework、Blocker、Radio、用户介入、完成与失败不进入难度。这样可避免失败
任务被事后认定为“更难”，从而人为提高难度校正得分。

难度校正能力指数为：

```text
100 × Σ(preExecutionDifficulty × finalAccepted)
      / Σ(preExecutionDifficulty)
```

权重下限为 1。报告必须同时显示 `difficultyModelVersion`、rubric version 和区间；
该指数是可观察任务表现的摘要，不是人格或通用智能测量。

## 5. 指标字典

所有比例使用明确的分子和分母；分母为 0 时估计值为 0，并显示无数据或宽区间，不能
解释为真实零风险。

| 维度 | 指标 | 分子 | 分母 | 主要来源 | 缺失处理 |
|---|---|---|---|---|---|
| 参与 | participation rate | 本配置 assigned Attempt | 冻结 Dataset Attempt | binding/lease | 不补齐 |
| 准确 | first-pass acceptance | 首次提交验收 | assigned Attempt | acceptance ledger | 缺失标记 |
| 准确 | final acceptance | 最终验收 | assigned Attempt | acceptance ledger | 缺失标记 |
| 准确 | claim evidence support | 有 Evidence 且 Verifier observed 的 accepted Attempt | accepted Attempt | Evidence/verifier | 无 Evidence 不通过 |
| 准确 | tool claim accuracy | 非 tool-selection/schema failure Attempt | assigned Attempt | tool observation | 路径/权限错误单列 |
| 准确 | false completion | 无 Evidence 宣告完成 | completed Attempt | terminal/Evidence | 硬门 |
| 准确 | regression escape | 回归逃逸 | assigned Attempt | verifier/integration | 硬门 |
| 完成 | completion rate | completed Attempt | assigned Attempt | terminal ledger | 未完成保留 |
| 完成 | blocker resolution | 最终验收的 blocker Attempt | blocker Attempt | blocker/acceptance | 无 blocker 不入分母 |
| 交接 | handoff completeness | handoff receipt 完整 | completed Attempt | handoff receipt | 缺失不通过 |
| 恢复 | parent wakeup | 子完成后父级恢复 | completed child Attempt | bounded Session observation | 硬门 |
| 纪律 | freeze incident | frozen Attempt | assigned Attempt | freeze ledger | 单列 |
| 纪律 | permission violation | 越权 Attempt | assigned Attempt | Host denial | 硬门 |
| 纪律 | stale submission | 陈旧提交 | assigned Attempt | version/fence | 单列 |
| 恢复 | recovery success | 成功恢复 | recovery attempted | recovery receipts | 无尝试不入分母 |
| 终态 | terminal duplicate | 同 lease 多个成功终态 | assigned Attempt | terminal tool receipts | 硬门 |
| 恢复 | recovery drift | 恢复跨陈旧 identity/version/workspace fence | assigned Attempt | recovery/fence | 硬门 |
| 效率 | Token per Accepted Outcome | 该 Task 最终验收前全部 Attempt Token | Accepted Outcome | usage ledger | 无 Outcome 不入结果数 |
| 效率 | latency per Accepted Outcome | 该 Task 最终验收前全部 Attempt 延迟 | Accepted Outcome | latency observation | 无 Outcome 不入结果数 |
| 效率 | cost per Accepted Outcome | 同上全部已知成本 | Accepted Outcome | pricing catalog | 未知即 unavailable |

`missionCompletionRate` 读取 Mission 权威终态；它不等于任意 Agent 输出
“任务完成”。总体 Task acceptance、跨部门 handoff、Radio resolution、
freeze recovery 和 specs commit coverage 分别读取对应 Ledger/receipt。

## 6. 失败阶段

失败以最接近权威 observation 的阶段归因：

| 阶段 | 示例 |
|---|---|
| `TASK_ORDER_AMBIGUITY` | Task Order 缺少可执行边界 |
| `MODEL_TOOL_SELECTION` | 选错工具或跳过必需工具 |
| `MODEL_ARGUMENT_SCHEMA` | 首次参数不通过机器 Schema |
| `HOST_VALIDATION` | Schema 之后的通用 Host 前置条件失败 |
| `PERMISSION_DENIED` | Tool/PermissionProfile 拒绝 |
| `PATH_SCOPE_REJECTION` | 绝对路径、逃逸或 receipt path 不一致 |
| `TOOL_RUNTIME` | 工具执行时失败 |
| `WORKSPACE_STATE` | 文件、版本、worktree 或 stale state |
| `VERIFICATION_FAILURE` | 验证不通过 |
| `INTEGRATION_FAILURE` | 集成、提交或合并边界失败 |
| `PARENT_WAKEUP_FAILURE` | 子代理完成后父级未恢复 |
| `PROVIDER_FAILURE` | Provider 返回明确错误 |
| `EXTERNAL_DEPENDENCY` | 非 Provider 外部依赖失败 |
| `USER_CANCELLATION` | 用户主动取消 |
| `SYSTEM_CRASH` | 进程或系统中断 |
| `MISSION_SCOPE_CHANGE` | Mission 范围在运行中改变 |
| `UNKNOWN` | Evidence 不足，不能安全归因 |

已纠正的首次工具错误仍是失败归因 Evidence，即使最终结果被接受。正常的多文件写入
不会因为工具名重复就算 retry；只有同一工具在失败后再次调用才计 correction。

模型、Host/基础设施、外部/取消和 unknown 比率均以 `stage != NONE` 的失败 Attempt
为分母。报告同时保留完整 `byStage`，不允许只显示一个笼统“工具调用失败率”。

## 7. 缺失原因与机制

缺失原因固定为：

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

Dataset Manifest 记录每个原因、数量和机制 `MCAR/MAR/MNAR/UNKNOWN`。评估报告
至少显示：

- missing event rate；
- materialization 与 Verifier coverage；
- 用户介入；
- 不同 Task type 覆盖；
- Attempt 是否聚集在少量 Mission；
- selection-bias notes。

用户取消、Provider 不可用和系统崩溃不计为模型失败；但它们仍留在数据质量和总体
coverage 中，防止通过删除失败会话刷分。Agent failure 不因“缺失”自动免责。

## 8. 二项区间

二项指标使用 Wilson score interval。配置内存在 Mission 聚类时，执行 2000 次
固定种子 Mission-cluster bootstrap，并用 Wilson envelope 包住 bootstrap 区间，
避免少量同质 cluster 产生虚假退化窄区间。

支持 90%、95% 和 99% 置信水平。相同 dataset、configuration key 和指标名称产生
相同随机序列，因此重跑可复现。

## 9. 连续指标区间

Token、latency、可用 cost 和配置差异使用固定种子的 2000 次
Mission-cluster bootstrap：

```text
每次抽取与原数据相同数量的 Mission cluster
→ cluster 内所有 Outcome/Attempt 一起进入
→ 计算均值或差异
→ 取 alpha/2 与 1-alpha/2 分位数
```

连续区间状态：

- `NO_DATA`：没有 Accepted Outcome；
- `INSUFFICIENT_CLUSTERS`：只有 1 个独立 Mission；
- `AVAILABLE`：至少 2 个独立 Mission。

比较中至少 3 个共同 Mission 才标记 `PAIRED_MISSION`；否则为
`OBSERVATIONAL` 的独立 cluster 比较。

## 10. 动态充分性

每个 exact configuration 必须同时满足：

| 条件 | 默认要求 |
|---|---|
| 唯一 Attempt | `>= request.minimumSamples` |
| 独立 Mission | `>= min(10, max(3, ceil(sqrt(minimumSamples))))` |
| final-acceptance 主区间宽度 | `<= 0.30` |
| missing event rate | `<= 0.10` |
| Verifier coverage | `>= 0.95` |
| exact-route coverage | `= 1.00` |

每个条件连同 observed/required 值写入报告。最终状态不再由固定
`N=5 && passRate>=80%` 决定：

- `NO_DATA`：没有结果；
- `EARLY_SIGNAL`：样本极少，仅提示方向；
- `EXPLORATORY`：可分析但不能做生产决策；
- `DECISION_ELIGIBLE`：统计、平衡与硬门均满足，只代表“可提交治理决策”；
- `REGRESSION_ALERT`：触发安全/质量硬门。

`promotionAllowed` 固定为 `false`。

## 11. Flash 与 Pro 公平比较

Flash candidate 和 Pro baseline 必须：

- 同角色；
- actual route 为 `EXACT_ROUTE_OBSERVED`；
- Task type overlap rate 至少 0.80；
- 预执行难度 standardized difference 绝对值不超过 0.25；
- exact configuration confound 可见；
- 各自达到数据充分性。

质量差异定义为：

```text
Flash final-acceptance rate - Pro final-acceptance rate
```

当差异区间下界不低于负的 `nonInferiorityMargin` 时才满足非劣。默认 margin 为
0.05，可由用户配置。即便质量非劣，以下任何一个事件都会强制
`REGRESSION_ALERT`：

- permission violation；
- false completion；
- regression escape；
- terminal duplicate；
- parent wakeup failure；
- recovery drift。

成本、Token 或延迟改善不能抵消硬门。不同 Prompt、Thinking、ToolProfile、
PermissionProfile、Bundle、DSH commit 或 Provider 的差异作为 confound 明示，不能
被模型名称掩盖。

历史 Session 比较仍标记为观察性。只有未来独立实现随机分配并记录 assignment receipt
时，才能使用 `RANDOMIZED`；当前实现不会伪称随机实验。

## 12. Accepted Outcome 与 Pareto

同一 exact configuration 下，以 `missionId + taskId` 聚合 Outcome。只要该组最终有
accepted Attempt，组内所有失败、返工、重跑和最终成功 Attempt 的 Token、latency、
model steps 和 cost 全部计入该 Accepted Outcome。

价格状态传播规则：

- 全部 observation 有实际价格：`OBSERVED`；
- 至少一个使用估算价格：`ESTIMATED`；
- 任一 Attempt 无价格或无金额：`PROVIDER_PRICING_UNAVAILABLE`。

未知成本不生成 `meanCostPerAcceptedOutcomeUsd`，也不参与 cost dominance。Pareto
先筛除非 `VALID`、硬门失败和 regression，再比较 Token、latency 与双方均可用的
cost；UI 明确区分“前沿”“被支配”“质量门阻断”。

## 13. 抗刷分

报告和 UI 必须暴露以下风险：

- 拒绝高难任务或只选择简单 Task；
- 一个 Mission 被拆成大量相关 Attempt；
- 排除失败、未完成或取消 Session；
- 频繁用户介入、Radio 或无效 Blocker；
- 把 fallback/alias 当成目标模型样本；
- 用解析器 revision 重复计算同一 Provider Session；
- 用一次最终成功抹掉前序工具失败和成本；
- 以输出长度、工具调用数或局部速度替代结果质量。

多角色或多场景只做分层展示，不输出没有统计依据的全局“总冠军”。

## 14. 可选委员会叙述

确定性模式为默认且不调用 LLM。显式启用委员会模型时，只提供脱敏聚合值、限制和
Evidence id；不提供原始 Session 文本或工具。严格 JSON 验证拒绝：

- 缺失或多余字段；
- 数值与 Host 指标冲突；
- 未知 Evidence；
- 超出长度上限的数组；
- 改变 decision 或 promotion 的内容。

任何调用或验证失败回退到确定性建议。模型叙述不进入统计计算。

## 15. 申诉与不可变修订

申诉使用
[`PerformanceEvaluationAppeal`](../schemas/performance-evaluation-appeal.schema.json)，
绑定固定 `reportId@revision`。每个 challenge 必须包含 finding path、理由和
Evidence，不能只提交“我不同意”。

```text
SUBMITTED
  → UNDER_REVIEW
      → UPHELD | PARTIALLY_UPHELD | DENIED
  → WITHDRAWN
```

成立或部分成立时，评审者明确给出允许排除的 Attempt id，Host 重新执行 Request、
重新冻结 canonical Dataset 并生成新的 Report。新报告通过 `supersedesReportId`
链接旧报告，旧 Report/Dataset/Artifact 永不修改。重复 recompute 使用稳定
idempotency key，不产生无限报告。

RC.2 本地单用户 Profile 中，提交、撤回、解决和重算均经过 Host 权限/确认边界并
写入审计 receipt。该实现不冒充尚不存在的企业多租户审批系统。

## 16. 解释限制

以下结论不受支持：

- “Flash 在所有任务上优于 Pro”；
- “模型导致了历史数据中的全部差异”；
- “一个高通过率证明安全”；
- “低成本可以容忍路径逃逸或无 Evidence 完成”；
- “ALIAS_UNPROVEN 样本证明 exact model 表现”；
- “本地 deterministic 测试等于真实 Provider 回归”。

可靠结论必须同时引用 canonical dataset hash、exact configuration、独立 Mission N、
区间、缺失/平衡诊断、硬门和报告 revision。
