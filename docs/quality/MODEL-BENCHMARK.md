# 模型与推理强度基准模板

| Task Type | Model | Reasoning | N | First-pass | Final | False completion | Mean rework | P95 latency | Tokens/accepted |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| pre-fix `/brainstorm` tool contract | `deepseek-v4-flash` | max | 1 | 0% | 0% | 0% | N/A | N/A | N/A |

该基线来自用户提供并已脱敏的 Session export（归档 SHA-256
`a9048cd488db29a03982a5835f466558f2d1697f3b07ea1e097fb8a91ab2a273`）：
11 次 Military 调用中 7 次失败。失败不是无效 JSON，而是插件暴露 34 个
Military 工具、17 个结构字段退化为空 Schema、Brainstorm Mission 重复创建、
角色越权工具可见以及 `Map` 穿越 RC.2 JSON 边界。

修复后的确定性门验证：General 完整角色上限为 15 个 Military 工具，实际每轮
再按阶段剪枝；Worker/Engineer 只看到当前 Task 与阶段允许的操作；Candidate、
Tactical Request、Decision、Guidance 和 Specs 输入均为浅层草稿，identity、
revision、authority、时间和幂等键由 Host 编译。`military_get_context` 同时
返回 Mission 与 Brainstorm，重复 `military_mission_start` 返回 `EXISTING`，
Task identity/版本由 Host 生成。148 项确定性测试和三启动 RC.2
installed-Profile E2E 覆盖首调用、一次纠错、文件写改、终态闩锁、父级 receipt、
崩溃重试与恢复；Task 级 step、tool、Radio、wall-clock 与 output 预算也在真实
请求/准入边界验证，而非仅保留为配置字段。

真实 Provider 的修复后样本仍由用户重启 DSH Web 后执行，因此
`deepseek-v4-flash-rc2` 维持 `CANARY`，而不是虚假标记 `VALIDATED`。General
和 11 个内置部门模板作为本轮轻量主力路径显式设置
`allowCanaryModel: true`；该模型不会成为其他路线的隐式 fallback。Pro 保持
显式可选。只有形成足量真实 Provider 样本后才晋升 capability profile。

## 必测能力

- 严格遵守单一 Task Order；
- 正确调用工具；
- 不把未读内容当事实；
- Blocker 质量；
- 证据映射；
- 接收 Tactical Directive 后的修正能力；
- 长上下文下的约束保持；
- 冻结/取消响应；
- 多语言和代码任务。

## 轻量主力外部验收矩阵

| 角色/阶段 | 必测观察 |
|---|---|
| General 建立 Mission | 首次选择正确上下文/建任务工具，不猜内部 ID |
| General 派遣 | 使用 Host 返回的 Task，重复派遣不产生第二个 Agent |
| Worker 文件执行 | 相对路径读写/edit 成功，越界路径一次纠正 |
| Worker 终态 | Candidate/Blocker 只能二选一，成功后无第二次工具执行 |
| Engineer Specs | 小规格一次 apply；大规格 staging 后一次 apply |
| Staff/Radio | requestId 来自 lease，Guidance 只提交浅层诊断和步骤 |
| 父 General 恢复 | 子终态 receipt 自动触发检查和整合，不轮询 Session |
| 重启恢复 | 相同终态草稿返回原 receipt，不重复 Git、artifact 或 report |

确定性合同门与真实 Provider 门分别记录。确定性 PASS 证明 Host、Schema 和
生命周期不会制造同类错误；它不等价于某个可变线上模型别名已经通过统计验证。

模型名称不能被直接当作能力等级；路由只使用本地评测结果和提供方声明的硬能力。

## 固定数据集工作台

当前数据集：

```text
version: military-flash-core-v1
sha256: 76ea0817a8daab513ed9661b61965e0524e5aa15007ddcc1c16797b17d8a50d0
```

九个场景固定为只读分析、创建文件、编辑多文件、Specs 原子事务、Schema 一次
纠正、父级唤醒、路径拒绝、重复终态闩锁和重启恢复。每次 deterministic run
同时固定：

```text
Bundle version
Preset generation
DSH release/commit
role configuration revision
exact provider/model
reasoning
ToolProfile revision
context/output budget
dataset hash
```

General 的 `general-host-authority@0` 是不可编辑、不可选择的 Host 内建权限边界，
不是持久化 PermissionProfile 的第零版；固定门将它作为唯一合法 sentinel。
部门角色仍必须引用正数 revision 的持久化 PermissionProfile。这样默认 General
不会被误判为缺少治理，同时伪造的 General 权限名和部门 `@0` 都会失败关闭。

`militaryBenchmark/snapshot` 读取数据集、历史 deterministic run、Provider
sample、稳定性分组和可评估 Session；`execute` 只接受
`RUN_DETERMINISTIC` 或 `ASSESS_PROVIDER_SESSION`。Provider 评估读取已经发生的
RC.2 Session/Host receipt，不会代替用户发起付费请求，也不会把模型文字当证据。

每个 Provider sample 记录：

- 首调用工具命中；
- Schema 首次通过；
- 是否发生一次有效纠正；
- 是否形成权威终态；
- 子报告是否在直接父 Session 形成 wake/steer 证据；
- Host observed 写 receipt 数；
- input/output tokens、延迟和价格可用状态；
- exact route 或 alias 未证明状态。

稳定性按 `exact provider/model + scenarioId` 分组。N<5 一律为
`INSUFFICIENT_SAMPLE`；N≥5 且通过率达到 80% 才能显示
`OBSERVED_STABLE`。该标签仍是观察结论，不自动修改 capability profile。

## 路由与模型切换基准

General 模型基准必须分别测量：

```text
preset default route
user session override route
post-compaction route
resume route
```

每个样本记录 effective request/header、ModelCapability profile、上下文占用、reasoning、工具成功率和最终验收。切换后不把前后 route 混为一个模板指标。

子代理基准固定 Template revision；禁止使用 General 当前模型作为隐式 fallback。模型候选只有在 RC.2 tool calling、reasoning、上下文、数据驻留和负向幻觉测试均通过后才能进入 VALIDATED profile。
