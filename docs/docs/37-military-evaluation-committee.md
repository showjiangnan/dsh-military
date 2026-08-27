# 37. 军事评估委员会与绩效决策中心

## 1. 产品目标

军事评估委员会是独立于单次 Mission 验收的跨会话分析系统。用户选择时间和范围后，
它回答三个实际问题：

1. 每个 exact Agent configuration 在什么任务、难度和数据条件下表现如何；
2. DeepSeek Flash 是否在同角色、同难度和相同治理条件下达到 Pro 的质量底线；
3. 在质量与安全合格后，哪种配置以更低 Token、延迟或成本产生最终 Accepted
   Outcome。

结果是可审查、可重放、可申诉的建议，不是自动修改生产模型的控制器。

## 2. 与其他评估的边界

| 分析 | 对象 | 主要证据 | 输出 |
|---|---|---|---|
| Tactical Effectiveness | Skill/Guidance version | compaction、Task、Verifier | 战术保留/改进建议 |
| Flash Workbench | 九个固定工具场景 | Host/Schema gate、Provider Session | 工具流程兼容性 |
| Agent Performance | exact Agent configuration | Frozen Dataset、Attempt、Evidence | individual performance |
| System Overall | Military 组织协作 | Mission、handoff、Radio、Freeze | overall report |

Skill 成功不能替代 Agent 绩效；高 Agent 通过率也不能证明某个 Skill 的因果贡献。
固定工作台不能冒充真实生产时间窗的委员会数据。

## 3. 委员会组成

### 3.1 Dataset Auditor

Dataset Auditor 完全由 Harness 确定性执行：

- 应用完整 Request 筛选和 actual preset 检查；
- 重建 Attempt identity、lease 窗口和 configuration snapshot；
- 对账 Session、Binding、Ledger、Tool、Evidence、Token 和 Artifact；
- 冻结预执行难度、缺失原因和数据质量；
- 去重并生成 canonical Dataset Artifact/hash；
- 计算指标、区间、失败阶段和比较资格。

它是数值事实的唯一来源。

### 3.2 Individual Examiner

每个 exact configuration 是一个可恢复 Job shard。默认 Examiner 是确定性规则，
根据指标、限制和失败阶段生成中文分析与建议。用户显式启用委员会模型时，模型只
接收脱敏聚合值和 Evidence id：

- 不读取原始 Session；
- 没有工具；
- temperature 0；
- 输出长度受限；
- 严格 JSON 字段集合；
- 失败时回退确定性叙述。

Examiner 不能改写 Host 指标、区间、decision 或 promotion 状态。

### 3.3 Committee Chair

Chair 读取已验证 individual performance 和 configuration comparison，合成：

- 总体 Mission/Task 结果；
- 部门交接、Radio、Freeze 和 specs 指标；
- Flash/Pro 比较；
- 回归告警和决策阻断；
- 3～5 个证据化改进实验；
- unsupported conclusions。

Chair 同样默认为确定性实现。即使使用模型叙述，也不能把小样本写成确定排名。

## 4. 用户运行流程

`Military-绩效评估` 表单提供：

```text
时间范围
Template / Department
Workspace / Mission 目录
是否纳入未完成 Session
minimum samples
comparison baseline
confidence level
non-inferiority margin
timeout
narrative mode
classification
```

创建后 UI 显示 durable Job：

```text
QUEUED
DISCOVERING_SESSIONS
BUILDING_DATASET
EVALUATING_TEMPLATES n/N
SYNTHESIZING
VALIDATING_REPORT
COMPLETED / FAILED / CANCELLED
```

Job 不依赖当前聊天 Turn。刷新、断线或 DSH Web 重启后仍可查看；retryable failure
可以从已冻结 Dataset 和已完成 shard 恢复。

## 5. 纳入规则

Session 只有满足以下条件才被纳入：

- materialized Session 的实际 preset 是 `military`；
- 与请求时间范围相交；
- 命中 Template、Department、Workspace 与 Mission 筛选；
- 调用者有报告和源数据读取权；
- 未被保留/删除策略移除；
- Agent Binding、Task version、generation 和 lease sequence 可恢复；
- 严重 event gap 已明确标记，不能伪造完整观察。

普通 Session 即使文本提到 “Military” 或使用相同 cwd，也不能纳入。
`includeIncompleteSessions=false` 时，未完成 Session 进入排除清单而不是悄悄消失。

## 6. Attempt 与配置单位

Attempt identity：

```text
root Session + Session + Mission + Workspace
+ Task id/version + Agent id/generation + lease sequence
```

主分析 configuration：

```text
role + template/revision + prompt revision
+ provider + observed model + route status + reasoning
+ ToolProfile/revision + PermissionProfile/revision
+ preset generation + Bundle version + DSH release/commit
```

不同 revision、route、权限或工具配置永不混组。actual route 状态区分 exact、
fallback chain 和 alias unproven；后两者只做诊断。

## 7. 报告的五个维度

### 7.1 参与

- eligible/assigned/completed Attempt；
- unique Mission/Session；
- accepted contribution；
- Task type coverage；
- consultation。

活动量不作为质量分。

### 7.2 准确与完成

- first-pass/final acceptance；
- Evidence support；
- false completion；
- regression escape；
- blocker resolution；
- handoff completeness；
- parent wakeup。

所有值来自 Ledger、Verifier 和 receipt，模型自述不算 Evidence。

### 7.3 难度校正能力

`Difficulty-adjusted Capability Index` 使用预执行 difficulty 加权的 final
acceptance，并展示 Mission-cluster 区间、rubric 和 difficulty model version。
结果期的 rework/Blocker/Radio 不得反向提高难度。

### 7.4 可靠性与恢复

- Freeze incident；
- permission violation；
- stale submission；
- recovery success；
- terminal duplicate；
- recovery drift。

权限越界、无 Evidence 完成、回归逃逸、重复终态、父级不恢复和恢复漂移是硬门。

### 7.5 Accepted Outcome 效率

- 全部 input/output/reasoning Token；
- queue/model/tool/verification latency；
- model step、tool call、correction、retry；
- fallback/compaction；
- observed/estimated/unknown cost；
- 每个最终 Accepted Outcome 的均值和 p50/p95。

失败与返工成本不会因最终成功而消失；未知价格不会显示为零。

## 8. 数据质量和统计状态

二项率显示 Wilson/clustered interval；连续值与差异使用 Mission-cluster bootstrap。
同一 Mission 的多个 Attempt 作为一个 cluster。报告逐项显示：

- unique Attempt 和 unique Mission；
- minimum samples；
- 主区间宽度；
- missing event rate；
- Verifier coverage；
- exact-route coverage；
- task-type/difficulty balance；
- selection-bias notes。

决策状态是 `NO_DATA`、`EARLY_SIGNAL`、`EXPLORATORY`、
`DECISION_ELIGIBLE` 或 `REGRESSION_ALERT`。样本不足可以给收集建议，不能输出强
排名。

## 9. Flash/Pro 决策

只有 observed model 名称命中 Flash/Pro 且 route 为 exact 的分片进入比较。候选和
基线必须同角色，任务类型与预执行难度可比。报告展示：

- comparison design；
- 双方 Attempt/Mission N；
- final-acceptance 区间；
- 差异区间与 non-inferiority margin；
- covariate balance；
- exact configuration confound；
- safety incidents；
- Accepted Outcome Token、latency 和可用 cost。

至少 3 个共同 Mission 才标记 paired-Mission；其余历史数据明确标记观察性。
硬门先于成本收益。`DECISION_ELIGIBLE` 只表示证据可提交治理评审；
`promotionAllowed=false`，用户仍需显式创建 Canary/Active revision 和治理 receipt。

## 10. 报告结构

### Part A：Individual Performance

每个 exact configuration 包含：

- 完整 configuration snapshot；
- sample、participation、accuracy、completion；
- capability、reliability、efficiency；
- data-quality criteria 与 failure attribution；
- analyses、recommendations、limitations；
- Evidence refs 与状态。

### Part B：Overall Performance

- Mission completion；
- Task final acceptance；
- cross-department handoff；
- Radio resolution；
- Freeze recovery；
- specs commit coverage；
- configuration comparisons；
- report decision、blockers 与 recommendation；
- priority recommendations；
- unsupported conclusions。

Schema：

- [`performance-evaluation-request.schema.json`](../schemas/performance-evaluation-request.schema.json)
- [`evaluation-attempt-record.schema.json`](../schemas/evaluation-attempt-record.schema.json)
- [`frozen-evaluation-dataset.schema.json`](../schemas/frozen-evaluation-dataset.schema.json)
- [`agent-template-performance.schema.json`](../schemas/agent-template-performance.schema.json)
- [`military-performance-report.schema.json`](../schemas/military-performance-report.schema.json)

## 11. 七视图决策中心

绩效评估不再只有一个大 JSON 或混合分数。一个一级选项卡内提供：

1. 决策总览：状态、Mission/Attempt、区间、阻断；
2. 角色/模型比较：Flash/Pro、route、configuration、非劣；
3. 九场景热力图：固定工作台与 Provider 观察分栏；
4. 工具漏斗：选择、Schema、Host、路径、运行、验证、集成、父唤醒；
5. Pareto：质量门之后的 Token/延迟/成本；
6. 数据与 Evidence：Dataset hash、Attempt、纳入/排除、引用；
7. 历史/申诉/实验：不可变 report lineage 和 recompute。

Workspace/Mission 来自 Host 目录，不要求用户手输专业 ID。高级统计渐进披露；默认
界面保持简体中文和 DSH RC.2 原生视觉、键盘、focus 与响应式行为。

## 12. 申诉

用户针对固定 `reportId@revision` 和 finding path 提交 challenge，可附 Evidence、
撤回或由有权限的本地评审者解决。旧 Dataset/Report 永不修改。成立或部分成立时：

```text
明确 authorized exclusions
→ 重新执行原 Request
→ 冻结新 Dataset
→ 生成新 Report
→ 新 Report supersedes 旧 Report
```

重复操作幂等，历史视图可比较 revision、排除项、dataset hash 和 decision 变化。

## 13. 安全与隐私

- 跨 Session 读取和 Artifact Evidence 在 Host 边界授权；
- 只纳入 actual Military Session；
- Restricted 数据按报告 classification 脱敏；
- 委员会模型不读取原始 Session，也不能使用工具；
- Web Client 不获得 SQLite handle、任意文件路径或 Provider credential；
- Dataset 与 Report 的 retention、撤回和派生影响可追踪；
- 报告不能包含 Secret、完整用户提示或无必要客户数据。

RC.2 本地部署是单用户 Profile 边界，不虚构多租户 RBAC。

## 14. 失败与恢复

- Dataset 构建失败：Job `FAILED`，不发布报告；
- 单 configuration shard 失败：持久化失败，重试只补缺失 shard；
- wall-clock timeout：结构化 retryable failure；
- DSH 重启：从 SQLite lease/fence 与 Artifact 恢复；
- stale worker：无法通过 fence 完成；
- committee model 失败：确定性叙述回退；
- report/schema/hash 不一致：拒绝发布；
- appeal recompute 冲突：稳定 idempotency key 返回同一谱系结果。

## 15. 改进建议

建议必须映射到可执行对象和成功指标：

| 观察 | 允许建议 |
|---|---|
| Worker schema first-pass 低 | 缩短工具提示、提供参数模板、增加 contract fixture |
| 路径错误高 | 强化 receipt-bound relative path、PATH_REJECTION 演练 |
| false completion | 收紧 Acceptance、Evidence 和 terminal gate |
| parent wakeup 低 | 修复 completion notification 与 bounded wakeup |
| recovery drift | 冻结 identity/version/fence、恢复前重校验 |
| Flash 质量非劣但样本不足 | 受控 Canary 继续收集同类 Mission |
| 成本低但质量硬门失败 | 先修质量，禁止晋升 |
| Provider cost unknown | 更新带版本的价格目录，不填 0 |

委员会不能自动修改模型、Template Prompt、ToolProfile、PermissionProfile 或 capability。

## 16. 反偏差规则

- 不奖励输出长度或工具调用数量；
- 不让被评配置决定自己的指标；
- 不混合不同 Template/Prompt/Tool/Permission revision；
- 不删除失败、取消或未完成而不留排除理由；
- 不把 fallback/alias 样本归给目标模型；
- 不把同一 Provider Session 的解析器重跑计成新样本；
- 不用成本改善抵消硬门；
- 不从观察性报告声称随机实验或因果结论；
- 不在小样本下输出全局排行榜。

## 17. 验收

实现完成必须证明：

- 同一 Request/权威事件重跑得到相同 Dataset hash 与指标；
- Request、Dataset、Attempt、Individual、Report 全部通过运行时 Schema；
- lease/version/generation 窗口不泄漏旧事件；
- exact route 与 fallback/alias 分层；
- Mission cluster、Wilson/bootstrap 和未知成本边界正确；
- Job 在失败、超时和进程重启后只重跑缺失 shard；
- 申诉产生新 Dataset/Report 并保留原谱系；
- 七视图可理解、可键盘操作且在窄视口不溢出；
- 本地 deterministic 证据与真实付费 Provider 回归分栏陈述。

详细算法见[绩效评估统计、公平性与申诉](48-evaluation-statistics-and-fairness.md)，
运行时状态和数据边界见[绩效评估运行时实现](57-performance-evaluation-runtime.md)。
