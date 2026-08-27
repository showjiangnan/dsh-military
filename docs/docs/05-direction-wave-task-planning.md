# 方向—波次—任务规划科学

## 1. 三层定义

### Direction：方向

围绕一个较大成果域组织的多波次计划，必须有独立结果、用户价值、范围、接口、风险、假设和完成标准。

### Wave：波次

在同一计划版本、环境基线和同步屏障内执行的一批任务。Wave 不是简单时间盒，而是带进入条件和退出 Barrier 的执行批次。

### Task Order：任务命令

分配给一个 Agent 的最小可独立验收单元。只有一个主要结果、有限写集合、冻结输入和独立验收合同。

## 2. 为什么不能无限拆小

任务过大时，轻量模型面对过多选择、上下文和未决依赖；任务过小时，系统支付过高的 Agent 启动、上下文打包、电台、文件锁、合并、验收和局部最优成本。

因此采用 **Minimum Independently Verifiable Unit**。

## 3. 叶子任务准则

建议同时满足：

1. 一个主要动词，例如实现、修复、验证、迁移或绘制；
2. 一个主交付物或紧密耦合 Artifact 集；
3. 通常不超过三个独立关键决策；
4. 写集合可显式声明，通常限制在一个模块或界面边界；
5. 输入能压缩成一个 Task Context Packet；
6. 一份 Acceptance Contract 可独立接受或拒绝；
7. 失败可明确归类为 rework、blocker 或 strategic；
8. 不依赖其他 Agent 未验收的私有结论。

任一明显不满足即考虑拆分。

## 4. 反向合并准则

以下任务不应拆开：

- 必须一起修改才能编译或运行；
- 共享不可分割写集合；
- 单独无法形成有效验收；
- 任务间交换上下文大于实际工作；
- 多 Agent 会对同一契约做冲突解释。

## 5. 复杂度向量

```yaml
semanticDecisions: 0..5
unknownDependencies: 0..5
writeDomains: 0..5
toolFamilies: 0..5
acceptanceAmbiguity: 0..5
integrationFanOut: 0..5
contextFootprint: small|medium|large
```

默认拆分触发：任一维度 4/5、两个以上维度为 3、上下文 large、无法声明写集合，或验收只能说“整体看起来不错”。阈值必须通过真实模型评测校准。

## 6. 依赖类型

| 类型 | 含义 | 调度规则 |
|---|---|---|
| `requires` | 硬前置 | 前置 ACCEPTED 后 Ready |
| `consumes` | 读取 Artifact | Artifact 版本冻结后 Ready |
| `locks` | 独占资源/写集合 | 冲突任务不并行 |
| `validates` | 本任务验证另一个结果 | 被验证任务先提交 Candidate |
| `speculativeWith` | 互斥探索 | 可并行，Barrier 选择 |
| `joinsAt` | 在集成 Task 汇合 | 所有必需分支接受后执行 |
| `supersedes` | 新任务替代旧任务 | 旧版本结果 stale |

计划 DAG 必须无环。返工循环属于 Task 状态机，不写入 DAG。

## 7. 波次形成算法

1. 从下一可交付增量出发，而不是按部门分任务；
2. 识别硬依赖与接口；
3. 创建可独立验收叶子 Task；
4. 计算读/写集合、工具、环境和 Verifier；
5. 将 Ready 且无冲突 Task 放入同一 Wave；
6. 设置集成 Task 或 Barrier；
7. 预留返工容量；
8. 只详细展开当前与下一 Wave；
9. Wave 后以真实证据重规划。

## 8. Worker 数量

```text
workerCount = min(
  readyNonConflictingTasks,
  configuredConcurrency,
  workspaceCapacity,
  verifierCapacity,
  advisorSupportCapacity,
  modelAndApiQuota,
  riskAdjustedLimit
)
```

Verifier 和 Advisor 容量经常是瓶颈。可初始预留 20%～30% 并发用于返工、阻塞和集成，随后按指标校准。

## 9. Task Context Packet

```yaml
identity:
  missionId:
  directionId:
  waveId:
  taskId:
  taskVersion:
objective:
whyItMatters:
inputs:
  artifacts: []
  specs: []
  acceptedFacts: []
scope:
  readPaths: []
  writePaths: []
  forbiddenPaths: []
tools:
  allowed: []
  requiredEvidence: []
acceptanceContractRef:
privateTactics: []
environmentSnapshotRef:
stopConditions: []
escalationConditions: []
budgets: {}
```

不要把整个 Mission 原始会话、所有参谋讨论或其他 Worker 私有日志直接塞给 Worker。

## 10. 调度与时序

- Ready 由依赖和 Artifact 版本确定；
- 同一写集合使用锁或隔离 Workspace；
- speculative tasks 的未选结果不能进入事实记忆；
- integration Task 负责合并，不让多个 Worker互相临时协调；
- Task lease 有过期和 generation；
- Worker crash 后先副作用对账，再重新派发。

生产 `MissionScheduler` 对每次派发执行确定性准入：验证 Direction/Wave 状态、DAG
无环、未知依赖、前置 Task 终态、Wave barrier、读写锁、Workspace/Verifier 容量和
预算。它持久化 `wave/opened`、`wave/barrier-satisfied`、
`mission/completed|cancelled` 事件；Trajectory、Effectiveness 和 Runtime Center
只读取这些权威事件，不从模型正文或缺省状态推断进度。

## 11. Wave 进入条件

- Direction/Wave 批准；
- DAG 校验；
- 每个 Task 有验收合同；
- 环境、权限、Artifact 和战术版本冻结；
- 工兵确认 specs；
- 资源与验证能力可用。

## 12. Wave 退出屏障

- 必需 Task 全部 ACCEPTED；
- 集成验证通过；
- 无未决 critical Oversight；
- Radio 请求已解决、关闭或升级；
- 工兵完成 specs 维护和本地 main commit；
- Tactical Report/指标已写入 Ledger；
- 下一 Wave 已依据实际结果复核。

## 13. 粒度优化目标函数

任务分解不是最大化 Task 数量，而是在质量约束下最小化每个已接受成果的期望总成本：

```text
E(task) = C_context
        + C_model
        + C_tools
        + C_coordination
        + C_verification
        + P_rework × C_rework
        + P_failure × C_recovery
```

拆分一个 Task 只有在满足以下条件时才有净收益：

```text
Σ E(childTask)
+ C_join
+ C_crossTaskCommunication
< E(originalTask)
```

并且拆分后：

- 每个子 Task 可独立验收；
- 不产生无法表达的隐式状态；
- 合并点和所有权明确；
- 关键契约不会被多个 Worker 各自解释；
- 最终质量下限不降低。

因此，Planning Engine 应记录“为何拆分”与“为何未继续拆分”，而不是只输出任务列表。

## 14. 轻量模型的决策预算

对于相对轻量的模型，Task 的主要风险通常不是字数，而是同时存在的独立决策数量。可为每个 Task 估计：

```text
DecisionBudget = architecturalChoices
               + unresolvedInterfaces
               + ambiguousRequirements
               + recoveryBranches
               + externalSideEffectChoices
```

默认建议：

- `0–2`：适合单一 Worker；
- `3`：需要明确 Tactical Directive 或进一步冻结上下文；
- `4+`：优先拆分、补充 specs、先做侦察或升级参谋；
- 高风险不可逆选择即使只有一个，也应提升到 General/Staff，而不是留给 Worker。

这些阈值是初始假设，必须按具体模型、任务类型和真实外置验收数据校准。

## 15. Wave 调度的多目标约束

Wave Scheduler 同时优化：

```text
maximize:
  accepted_value_on_critical_path
  verifier_utilization
  information_gain_from_speculation

minimize:
  write_conflicts
  stale_work_probability
  advisor_queue_pressure
  context_repackaging
  integration_fan_out
  unverified_work_in_progress
```

硬约束优先于优化目标：依赖、权限、数据驻留、Workspace、锁、预算、Verifier 和 Wave Barrier 不得被“更高并发”覆盖。

关键路径任务可获得更强模型、优先参谋和预备容量；非关键 speculative Task 必须设置停止条件和选择 Barrier，避免探索结果无限积累。

## 16. 自适应粒度校准

系统按 `(model, reasoning, taskType, complexityBucket)` 维护：

- first-pass acceptance；
- final acceptance；
- rework 次数；
- false completion；
- guidance 请求率；
- join/integration 失败率；
- 上下文和协调成本；
- latency per accepted outcome。

Planning Engine 可据此调整拆分阈值：

- 大 Task 反复返工：降低 DecisionBudget 或 WriteDomain 阈值；
- 小 Task join 失败或协调占比过高：合并紧耦合 Task；
- Radio 请求集中在同一接口：先创建接口/契约 Task；
- Verifier 队列成为瓶颈：减少同时进入 VERIFYING 的 Task；
- Worker 成功但集成失败：增加 joinsAt Task、契约冻结和 Wave Barrier；
- 大量 Task 无信息增益：提高 speculative Task 的准入门槛。

调整产生版本化 Planning Policy，并通过基准与 Canary 使用，不直接在活动 Wave 中无痕改变合同。

## 0.3.0：Workspace、预算与 Integration 依赖

Task 计划新增：

- `workspaceMode`：READ 或 isolated WRITE；
- `baseWorkspaceSnapshotId`；
- 预计 Patch/Artifact 范围；
- `budgetPolicyRef` 与 reservation；
- `integrationTarget` 和 global regression profiles；
- 外部 drift 处置；
- 需要的 Authority/Policy revision。

写 Task 的完成条件不是 Candidate 被接受或 Verification 单独通过，而是：

```text
Candidate Submitted
→ Verification Accepted
→ Task VERIFIED / INTEGRATION_PENDING
→ Integration Applied
→ Global Regression Passed
→ local main Receipt
→ specs Trace Updated
→ Task COMPLETED
```

可以在同一 Wave 并行执行不冲突的隔离 Task，但 Integration 依据写集合、base snapshot 和依赖有序提交。
