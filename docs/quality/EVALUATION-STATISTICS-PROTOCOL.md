# 绩效评估统计协议

## 1. 冻结与复现

- 请求、Dataset、Attempt、Individual 和 Overall Report 必须通过发布 JSON Schema。
- 完整 `PerformanceEvaluationRequest` 进入唯一 Dataset Builder。
- canonical Dataset Artifact、Manifest、metric shard 和 Report 使用同一
  `datasetHash`。
- Session、Attempt、included/excluded item、configuration 和 Artifact 引用稳定排序。
- 固定 dataset/configuration/metric seed 的 bootstrap 必须可复现。

## 2. 身份、窗口与去重

- Attempt identity 是 root Session、Session、Mission、Workspace、Task id/version、
  Agent id/generation 和 lease sequence 的组合。
- 只读本 lease 到首个权威终态；最多 2 秒 pre-lease skew 只吸收 request/setup。
- Acceptance、Evidence、Freeze、terminal 和 tool result 不得跨 Attempt 泄漏。
- 同一 Attempt 的 Session/Ledger/Projection observation 只计一次。
- Provider 样本按 dataset + Session + scenario 计数；parser revision 不增加 N。

## 3. 分层

不得混合以下任一维度：

```text
role
template/revision
prompt revision
provider/observed model/route status
reasoning effort
ToolProfile/revision
PermissionProfile/revision
preset generation
Bundle version
DSH release/commit
```

只有 `EXACT_ROUTE_OBSERVED` 进入模型稳定性和 Flash/Pro 决策。

## 4. 难度

- 只使用 Task type、complexity、risk、Acceptance、dependency、context、tool
  availability、Verifier、Workspace drift 和 tactical coverage 等预执行特征。
- rework、Blocker、Radio、用户介入和结果不改变难度。
- 能力指数是 difficulty-weighted final acceptance，必须显示 rubric、模型版本和区间。

## 5. 比例指标

| 指标 | 分子 | 分母 |
|---|---|---|
| first-pass acceptance | 首次提交验收 Attempt | assigned Attempt |
| final acceptance | 最终验收 Attempt | assigned Attempt |
| false completion | 无 Evidence 宣告完成 | completed Attempt |
| regression escape | 回归逃逸 Attempt | assigned Attempt |
| handoff completeness | 完成交接 | completed Attempt |
| parent wakeup | 父级恢复 | completed child Attempt |
| recovery success | 成功恢复 | recovery attempted |
| permission violation | 越权 Attempt | assigned Attempt |
| terminal duplicate | 同 lease 多成功终态 | assigned Attempt |
| recovery drift | 跨陈旧 fence 恢复 | assigned Attempt |

分母为零时不作正面推断。每个指标保留 numerator、denominator、来源和 Evidence。

## 6. 失败归因

使用 `TASK_ORDER_AMBIGUITY`、`MODEL_TOOL_SELECTION`、
`MODEL_ARGUMENT_SCHEMA`、`HOST_VALIDATION`、`PERMISSION_DENIED`、
`PATH_SCOPE_REJECTION`、`TOOL_RUNTIME`、`WORKSPACE_STATE`、
`VERIFICATION_FAILURE`、`INTEGRATION_FAILURE`、`PARENT_WAKEUP_FAILURE`、
`PROVIDER_FAILURE`、`EXTERNAL_DEPENDENCY`、`USER_CANCELLATION`、
`SYSTEM_CRASH`、`MISSION_SCOPE_CHANGE`、`UNKNOWN`。

首个工具调用只有 JSON Schema 验收结果影响 `schemaFirstPass`。路径、权限、运行和
Workspace 错误必须进入各自阶段。纠正后的错误仍保留；正常多文件调用不算 retry。

## 7. 缺失

分别报告 `USER_CANCELLED`、`SYSTEM_CRASH`、`PROVIDER_UNAVAILABLE`、
`EXTERNAL_DEPENDENCY`、`AGENT_FAILURE`、`MISSION_SCOPE_CHANGE`、
`EVENT_GAP`、`SESSION_NOT_MATERIALIZED` 和 `UNKNOWN`，并标注
`MCAR/MAR/MNAR/UNKNOWN`。不得通过静默排除失败或未完成 Session 降低缺失率。

## 8. 区间

- 二项率：Wilson score interval；存在多 Mission 时用 2000 次固定种子
  Mission-cluster bootstrap，并取 Wilson envelope。
- 连续值：2000 次固定种子 Mission-cluster bootstrap。
- 连续区间状态：0 cluster=`NO_DATA`，1 cluster=`INSUFFICIENT_CLUSTERS`，
  至少 2 cluster=`AVAILABLE`。
- 置信水平：0.90、0.95 或 0.99。
- 至少 3 个共同 Mission 才标记 paired-Mission comparison。

## 9. 数据充分性

配置必须同时满足：

```text
unique Attempt >= minimumSamples
unique Mission >= min(10, max(3, ceil(sqrt(minimumSamples))))
final-acceptance interval width <= 0.30
missing event rate <= 0.10
Verifier coverage >= 0.95
exact-route coverage = 1.00
```

逐项发布 observed/required/passed。状态只允许 `NO_DATA`、`EARLY_SIGNAL`、
`EXPLORATORY`、`DECISION_ELIGIBLE`、`REGRESSION_ALERT`。

## 10. Flash/Pro

- 同角色、Task type overlap >= 0.80、难度 standardized difference <= 0.25。
- 质量差异为 Flash final acceptance 减 Pro final acceptance。
- 区间下界 >= `-nonInferiorityMargin` 才非劣。
- permission violation、false completion、regression escape、terminal duplicate、
  parent wakeup failure、recovery drift 任一出现即硬门失败。
- 所有历史比较标记观察性；没有随机 assignment receipt 不得宣称随机实验。
- `promotionAllowed=false`。

## 11. Accepted Outcome 经济性

- 以 missionId + taskId 聚合最终 Accepted Outcome。
- 累计该 Outcome 前全部失败、返工、重试的 Token、latency、steps 和 cost。
- 价格状态传播为 `OBSERVED`、`ESTIMATED` 或
  `PROVIDER_PRICING_UNAVAILABLE`。
- 任何成本缺失都不输出均值、不以 0 参与 Pareto。
- Pareto 先通过数据、质量和安全门，再比较 Token、latency 和双方可用 cost。

## 12. 申诉与叙述

- Report/Dataset 不可变；申诉重算生成新 Dataset 和 superseding Report。
- challenge 必须绑定 report revision、finding path 和 Evidence。
- deterministic narrative 为默认。
- committee model 只读脱敏聚合值，无工具，不能改指标/decision/promotion；严格
  JSON 失败时回退确定性叙述。

## 13. 发布检查

- 输出唯一 Attempt/Mission N、区间、缺失、平衡、route 和 configuration。
- 不输出跨角色混合排行榜或无来源总分。
- 本地 deterministic 结果与真实 Provider exact-route 样本分栏。
- 所有比较说明观察性/paired 状态、限制和 unsupported conclusions。
