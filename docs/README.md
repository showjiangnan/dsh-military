# dsh-military：验证驱动的多代理组织 Bundle

> 源码实现：`0.9.0-alpha.25`；文档契约：`0.9.0-draft`
> 完整支持基线：`dsh@0.1.1-rc.2`，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`  
> 固定公开 preset：`military`  
> 文档语言：中文；机器契约使用稳定英文标识。

## 1. 项目定位

> **0.9.0-alpha.25 的 Web 边界：** 当前源码实现侧栏独立
> `Military 设置中心` 入口、原生弹窗、七个左侧一级选项卡、General/11 部门
> 单角色工作台、模型目录、简体中文提示词/辅助检查、Prompt 预览、Flash
> readiness/模拟、revision/回滚、成本、诊断/恢复、Specs 工作区、固定评测，
> 以及 Request→Integration Runtime Center、七视图知识中心、供应链透明度和
> 模拟召回。Mission/Task/Radio/Decision 等运行视图通过插件自有
> Remote/Projection 实现；RC.2 没有外部
> required Session Event 注册面，因此源码不会把 `military/*` 私有事件写入
> DSH Session Log。


`dsh-military` 是面向 DeepSeek Harness 的多代理组织、控制、验证、知识治理和绩效评估 Bundle。用户是统帅，主会话 General 是最高协调 Agent；专业参谋部形成 Direction、Wave 和最小可独立验收 Task，Thinking-enabled Worker 与工兵在隔离 Workspace 中执行，Harness 独占验收、冻结、集成、权限和持久状态。

它不是普通 Swarm，也不是让多个模型自由聊天。核心闭环是：

```text
用户方向
→ General Mission Intent
→ Staff Direction / Wave / Task
→ Worker 或 Engineer 在隔离工作区执行
→ Candidate + Evidence
→ 外置 Verification
→ 受控 Integration 到 local main
→ specs、战术报告与已认证记忆
→ General 汇报
```

## 2. 固定 Military preset

用户在 DSH WebUI **新建空白会话**时选择：

```text
preset id: military
显示名称: Military 模式
```

选择后，该会话才能看到 Military persona、工具、命令、Completion Interlock、自动压缩、子代理编排和 Military Mission Ledger。未选择的 Standard/Code/Minimal 会话不获得任何会话侧 Military 能力，即使它们使用同一个工作目录。

会话开始后 preset 锁定。Military 子代理通过 `composeFrom()` 继承父 Agent 的同一 preset generation。

## 3. General 模型规则

General 的初始模型来自 `military` preset：

```text
preset default
→ 用户会话模型选择覆盖
→ 能力、Thinking、数据驻留和预算准入
→ 有效 request/header
```

用户可以在会话页面切换 General 的后续 provider/model。该操作：

- 不改变 actual preset；
- 不重写历史；
- 不改变运行中子 Agent；
- 不改变已冻结的 Department Template revision；
- 不允许降级到 Thinking `off` 或不合规模型；
- 生成可审计的 `ModelSelectionReceipt`。

除 General 外，各部门 Agent 的模型、Thinking、上下文预算和压缩比例由 Settings 中的版本化模板管理。

## 4. 组织结构

| 组织称谓 | 软件角色 | 核心职责 |
|---|---|---|
| 统帅 | 用户 | 目标、约束、风险接受和外部授权 |
| 将军 | General Agent | Mission Intent、战略协调、用户问题、最终汇报 |
| 参谋部 | 专业 Advisor 部门 | 独立研判、会商、Direction/Wave/Task 与战术指导 |
| 参谋长 | Chief of Staff | 私有战术不足时生成明确标注假设的参考意见 |
| 快速反应部队 | Worker Agents | 执行一个最小可独立验收 Task |
| 工兵部 | Engineer Agents | specs、受控 Integration、local `main` Git 纪律 |
| 督战队 | Inspector + Oversight Controller | 只读对账；Harness 冻结与释放 |
| 参谋部电台 | Radio Broker | 求援门禁、去重、租约、路由和 stale 防护 |
| 后勤保障与研究部 | Trajectory、Effectiveness、Museum | 轨迹、效能、归档和待测战术研究 |
| 军事评估委员会 | Dataset Auditor、Examiner、Chair | 逐模板和总体绩效评估 |

部署可把军事显示词切换为中性术语，机器 ID 和权限语义保持不变。

## 5. 0.9.0-alpha.25 的源码实现与工程收敛

本版在 0.2.0 组织设计之上补齐了实施前的关键契约：

1. **内容寻址 preset generation。** 重启后先验证原 generation；current 可恢复，archived-only 根 Session 在 RC.2 公共 seam 下隔离并显式迁移。
2. **单一契约真源。** Event Catalog 生成判别联合 Schema、TypeScript 和 Golden JSONL；共享字段执行 Schema/TS parity。
3. **身份、租户和授权。** 所有跨会话、设置、战术、评估和外部动作使用 Authority Context 与 Authorization Receipt。
4. **隔离 Workspace Integration。** Worker 不直接污染主工作树；Candidate Patch 通过验证和全局回归后才进入 local `main`。
5. **物理存储与事务。** SQLite 短事务 Command Saga、CAS、ordered
   Transactional Outbox、Workspace/Execution state、Artifact commit 和
   migration ledger。
6. **General 模型优先级。** preset 默认 + 用户会话覆盖，子代理模板路由不跟随切换。
7. **持久 Decision Broker。** delegated child 只提交问题集，根 General 有序调用 `ask_user_question`。
8. **RC.2 能力探测。** 完整版本固定 RC.2；关键 seam 缺失时 fail closed。
9. **安装/升级/回滚/卸载。** profile revision CAS、generation archive、数据库迁移和可审计数据处置。
10. **战术知识供应链。** 来源权利、Prompt Injection 隔离、矛盾/时效校验、派生图和撤回影响分析。
11. **可复现绩效评估。** canonical Frozen Dataset、exact Attempt/configuration、
    预执行难度、缺失/失败阶段、Mission-cluster 区间、Flash/Pro 非劣硬门、
    Accepted Outcome 经济性、可恢复分片、不可变申诉谱系和七视图决策中心。
12. **Golden Trace 与模型检查。** 关键并发状态、故障窗口、TLA+ 参考和 RC.2 Fixture。
13. **资源硬预算。** 多级 reservation、背压、无信息增益检测和预算耗尽处置。
14. **WebUI 控制中心。** 当前实现 Desired/Applied 角色设置、诊断/恢复、
    Workspace、Request→Integration Runtime Center、固定评测、知识透明度/
    模拟召回和键盘/IME/高对比度合同。
15. **产品安全边界。** 军事名称仅是软件组织隐喻，支持中性显示，不用于现实伤害或人员处分。

## 6. 核心不变量

- actual preset 不为 `military` 的 Session 看不到和不能调用 Military 会话能力；
- 旧 Session 不得因重启而静默使用新的 preset generation；
- General 模型切换只影响 General 后续请求；
- Worker、Engineer、Advisor、Chief 和 General 的 effective reasoning 不得为 `off`；
- 模型只能提出 Candidate、Blocker、Advice、QuestionSet 和 Report；Harness 才能改变权威状态；
- FROZEN Agent 不能执行写工具；
- 未验收结果不得进入 General 的确认事实记忆；
- Worker 写入必须来自隔离 Workspace，local `main` 只接收已验收并通过集成回归的 Patch；
- 所有跨会话读取必须有 tenant、principal、scope 和数据分类准入；
- 战术必须可追踪来源、权利、版本、Verifier 和撤回影响；
- 绩效基础指标由 Harness 计算，委员会模型不能覆盖确定性事实；
- 预算耗尽不能关闭验证、越权换模型或伪造完成；
- 工兵无远端 Git 写权限；远端动作由用户明确授权后的 General 执行。

## 7. 阅读路径

### 架构与执行

1. [完整设计总纲](docs/00-executive-design.md)
2. [固定 preset 与会话隔离](docs/32-military-preset-and-session-isolation.md)
3. [Direction—Wave—Task](docs/05-direction-wave-task-planning.md)
4. [General](docs/06-general-agent.md)
5. [参谋部](docs/07-staff-department.md)
6. [Worker](docs/08-worker-forces.md)
7. [工兵、specs 与 Git](docs/09-engineer-corps-and-specs.md)
8. [验证与验收](docs/14-verification-and-acceptance.md)

### 实施收敛

1. [Preset generation 升级与恢复](docs/38-preset-generation-upgrade-and-resume.md)
2. [契约真源与生成](docs/39-contract-source-of-truth-and-code-generation.md)
3. [身份与授权](docs/40-principal-tenant-authorization-model.md)
4. [Workspace 集成](docs/41-workspace-integration-and-merge-protocol.md)
5. [物理存储与迁移](docs/42-physical-storage-and-migration-design.md)
6. [General 模型优先级](docs/43-general-model-and-session-policy-precedence.md)
7. [Decision Broker](docs/44-decision-broker-state-machine.md)
8. [RC.2 兼容探测](docs/45-compatibility-probe-and-feature-matrix.md)
9. [Bundle 生命周期](docs/46-install-upgrade-rollback-uninstall.md)
10. [知识供应链](docs/47-tactical-knowledge-supply-chain.md)
11. [绩效统计与公平性](docs/48-evaluation-statistics-and-fairness.md)
12. [一致性与模型检查](docs/49-conformance-and-model-checking.md)
13. [资源预算与准入](docs/50-resource-budget-and-admission-control.md)
14. [WebUI 冲突与恢复 UX](docs/51-webui-interaction-and-conflict-ux.md)
15. [产品术语与安全边界](docs/52-product-terminology-and-safety-boundary.md)


### 专业内核与 RC.2

1. [Mission Kernel 2.0 与 Command Bus](docs/60-mission-kernel-2-and-command-bus.md)
2. [Context Compiler 与 Evidence Graph](docs/61-context-compiler-and-evidence-graph.md)
3. [自适应执行 Router](docs/62-adaptive-execution-router-and-parallelism.md)
4. [Agentic Zero Trust](docs/63-agentic-zero-trust-and-capability-grants.md)
5. [可观测性与决策链评估](docs/64-observability-and-decision-chain-evaluation.md)
6. [RC.2 兼容与适配迁移](docs/65-rc2-compatibility-and-adapter-migration.md)
7. [Legacy → RC.2 升级运行手册](docs/66-legacy-to-rc2-upgrade-runbook.md)
8. [Military 控制中心、Flash 工作台与可访问性](docs/67-military-control-center-flash-workbench-and-accessibility.md)
9. [General 全流程、DSH 全模型与设置持久化](docs/68-general-workflow-live-models-and-settings-persistence.md)
10. [执行活性、Flash 外部验收与生产可信度](docs/69-execution-liveness-flash-and-production-readiness.md)

### 源码实现与发布

1. [源码架构与包参考](docs/53-source-code-architecture-and-package-reference.md)
2. [构建、测试、安装与运行](docs/54-build-test-install-and-operations.md)
3. [代码审查、安全与 RC.2 一致性](docs/55-code-review-security-and-rc2-conformance.md)
4. [RC.2 已知限制与迁移边界](docs/56-known-rc2-limitations-and-migration-boundary.md)
5. [绩效评估运行时](docs/57-performance-evaluation-runtime.md)
6. [Worker Workspace 与子代理创建](docs/58-worker-workspace-and-child-spawn-runtime.md)
7. [Web Client 打包与页面能力](docs/59-web-client-packaging-and-surfaces.md)

## 8. 工程目录

```text
dsh-military-docs/
├── docs/                    # 00–67 主题设计、内核与 RC.2 运行参考
├── adr/                     # 38 个架构决策
├── contracts/               # Event Catalog、生成映射和 parity 映射
├── schemas/                 # 72 个 JSON Schema Draft 2020-12
├── examples/                # 合法实例、Golden Ledger 和 Conformance Trace
├── reference/types/         # 可编译 TypeScript 参考契约
├── reference/preset/        # preset、generation archive、安装适配
├── reference/sql/           # SQLite 参考迁移
├── reference/tla/           # 并发状态模型
├── reference/dsh-rc2/       # 精确兼容矩阵
├── templates/               # specs、报告和提炼审阅模板
├── diagrams/                # Mermaid 架构图
├── quality/                 # SLO、威胁、统计和一致性协议
├── checklists/              # 实施、验收、升级和发布门禁
└── scripts/                 # 生成、hash、汇编和全量校验
```

## 9. 全量校验

```bash
python scripts/generate_contract_artifacts.py --check
python scripts/generate_error_artifacts.py --check
python scripts/compute_preset_generation.py --check
python scripts/update_indexes.py --check
tsc -p reference/types/tsconfig.json
python scripts/build_single_spec.py
python scripts/validate_artifacts.py --write-manifest
python scripts/validate_artifacts.py
```

校验区分：语法、Schema 示例、生成物新鲜度、Schema/TS parity、事件覆盖、preset generation、RC.2 约束、状态不变量、SQL、Trace、文档链接、TypeScript 和 Manifest。

## 10. 实施状态

本目录已与 `dsh-military 0.9.0-alpha.25` 源码和 release artifact 同步。默认发布
门禁覆盖本地 strict 与精确 RC.2 checkout 声明编译、构建、148 项测试、
SQLite/Git/preset/私有 Skill 供应链故障恢复、静态与语义审查、13 个 package
的 pack/publint、空 DSH Home 安装、真实 Loader 激活和三次 Profile 启动 E2E。
[实施就绪矩阵](IMPLEMENTATION-READINESS.md) 与
[Contract Freeze 清单](checklists/contract-freeze.md) 记录完整门禁。当前
确定性 RC.2 Fixture 已证明：

```text
Military/Standard Session 隔离
→ General preset 默认模型与会话切换
→ 一个 Worker 隔离 Workspace
→ Worker 首请求 write/edit 与 Engineer 首请求 9-tool 合同
→ Candidate → Verify → Integrate → local main
→ specs receipt
→ continuable child report 自动恢复父 General
→ 用户取消 settlement 不消耗父模型请求
→ Flash 浅层 Specs draft → Host 权威编译 → 精确路径 commit
→ 终态 durable mutation → parent receipt → General 自动恢复
→ 同一 assistant response 的 terminal latch 阻止后续工具调用
→ General + 11 部门模型目录下拉 → 新模板 revision → reload 保持
→ General + 11 部门简体中文提示词 → 编辑 revision → 单项/全量恢复
→ 角色目录 → 六层有效 Prompt → Flash readiness → 离线模拟/显式 Canary
→ Session 诊断 → 恢复预览/确认 → 幂等 operation receipt
→ Host workspace ID → canonical/Git/lease/integration 可视化
→ 固定九场景 dataset → 完整 sequence/receipt → Provider 去重
→ 趋势 N<10/宽区间不判稳定 → 发行 N≥50/Wilson/零安全失败
→ canonical 绩效 Dataset → exact configuration → Mission-cluster 区间
→ Flash/Pro 质量硬门 → Accepted Outcome Pareto → immutable Report/Appeal
→ 来源导入/清洗/Flash 分块提炼 → 审批 → immutable DRAFT Skill
→ 生命周期晋升 → exact-version Task 召回 → 渐进式详情 → Usage/Result
→ sanitized pipeline/lineage → 无 Task 模拟召回 → 与真实 recall 同 delivery block
→ 补充版本继承来源谱系 → 任一来源撤回 → 隔离和影响报告
→ Bundle 元数据/文件哈希/引用闭包/符号链接完整性 fail closed
→ .DS_Store 原地保留但不阻塞 Specs/Worker/Integration
→ 重启后 generation 精确恢复
```

外部 Provider 网络/凭据与足量真实样本、未纳入本机矩阵的浏览器和跨平台行为、
生产 SLO 仍属于部署验收，不在源码测试中伪造。

## 11. 使用边界

`dsh-military` 是软件工程多代理编排 Bundle。军事组织词汇是角色和流程隐喻，不提供现实军事、武器、目标选择、人员监控或自动人事处分能力。详见[产品术语、军事隐喻与安全边界](docs/52-product-terminology-and-safety-boundary.md)。

- [RC.2 全量修复闭环与发布门禁](quality/RC2-FULL-REPAIR-CLOSURE.md)
- [ADR-0033](adr/0033-mission-atomic-evidence-and-rc2-release-gate.md)
