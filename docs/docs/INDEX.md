# 设计文档索引

| 编号 | 文档 | 主题 |
|---:|---|---|
| 00 | [完整设计总纲](00-executive-design.md) | 总体定位、五平面、闭环、不变量 |
| 01 | [设计原则](01-design-principles.md) | 权威分离、证据、事件、粒度原则 |
| 02 | [系统上下文](02-system-context.md) | 系统边界、外部参与者和部署面 |
| 03 | [组织模型](03-organizational-model.md) | 用户、将军、参谋、Worker、工兵、督战、研究 |
| 04 | [Mission 生命周期](04-mission-lifecycle.md) | 启动、侦察、规划、执行、关闭 |
| 05 | [方向—波次—任务规划](05-direction-wave-task-planning.md) | 最小可独立验收单元、DAG、并发与屏障 |
| 06 | [General Agent](06-general-agent.md) | 主 Agent 职责、工具、记忆和升级 |
| 07 | [战术参谋部](07-staff-department.md) | Advisor Profile、会商、路由和权限 |
| 08 | [Worker 部队](08-worker-forces.md) | Task 执行协议、Thinking、证据和停止条件 |
| 09 | [工兵、specs 与 Git](09-engineer-corps-and-specs.md) | 文档工程、本地 main、Promotion Order |
| 10 | [督战队](10-oversight-corps.md) | 只读 Inspector、确定性冻结和纠正 |
| 11 | [参谋部电台](11-staff-radio.md) | 战术请求、Broker、租约、去重、投递 |
| 12 | [私有战术](12-tactical-skills.md) | 战术结构、检索、合成、版本与生命周期 |
| 13 | [后勤保障与研究部](13-logistics-research.md) | 轨迹、战术效能、博物馆和 General Memory |
| 14 | [验证与验收](14-verification-and-acceptance.md) | Completion Gate、Verifier、Evidence Graph |
| 15 | [事件溯源与状态](15-event-sourcing-and-state.md) | Ledger、事件、投影、状态机、恢复 |
| 16 | [DSH 集成](16-dsh-integration.md) | Cordis、Preset、Agents、Hooks、Tools、Skill、Compaction |
| 17 | [WebUI](17-webui.md) | Preset、Settings Cards、Conversation Nodes、控制台 |
| 18 | [安全与权限](18-security-and-permissions.md) | 最小权限、企业 API、凭据、会话隔离 |
| 19 | [可观测性与指标](19-observability-and-metrics.md) | Trace、SLO、模板绩效、指导提升和异常率 |
| 20 | [测试与评估](20-testing-and-evaluation.md) | 单元、隔离、回放、基准和负向测试 |
| 21 | [包拓扑](21-package-topology.md) | Service/Provider/Consumer、Preset 和依赖边界 |
| 22 | [实施路线图](22-implementation-roadmap.md) | Phase 0–10、退出条件和首个垂直场景 |
| 23 | [风险登记册](23-risk-register.md) | 风险、影响、缓解、触发和责任 |
| 24 | [运行手册](24-operations-runbook.md) | 启停、冻结、恢复、回滚和事故操作 |
| 25 | [参考来源](25-reference-sources.md) | DSH 基线、官方文件与事实映射 |
| 26 | [历史经验的工程抽象](26-historical-design-abstraction.md) | 可借鉴机制与不应照搬的边界 |
| 27 | [API 与数据契约](27-api-and-data-contracts.md) | Command/Event/Query/Artifact 与错误语义 |
| 28 | [治理与变更控制](28-governance-and-change-control.md) | 授权、Change Order、验收冻结和覆盖 |
| 29 | [模型路由与 Thinking](29-model-routing-and-reasoning-policy.md) | 角色策略、模板、fallback、上下文和评测 |
| 30 | [失败恢复与混沌](30-failure-recovery-and-chaos.md) | Saga、崩溃窗口、死锁和故障注入 |
| 31 | [实现蓝图](31-implementation-blueprint.md) | 首个切片、伪代码、工具和测试 |
| 32 | [固定 Military Preset 与会话隔离](32-military-preset-and-session-isolation.md) | 创建期固定 preset、scope、子代理继承和同 cwd 隔离 |
| 33 | [外部战术提炼与标签治理](33-tactical-ingestion-and-tag-governance.md) | 会话/经验提炼、标签生命周期、Diff 审阅和来源 |
| 34 | [部门 Agent 模板与上下文策略](34-department-agent-templates-and-context-policy.md) | 模型、Thinking、预算、压缩比例和模板 revision |
| 35 | [头脑风暴与用户决策](35-brainstorm-command-and-decision-dialogues.md) | /brainstorm、ask-user、决策漏斗和 specs handoff |
| 36 | [参谋长兜底](36-chief-of-staff-fallback.md) | 技能充分性、生成参考、问题转交和权限 |
| 37 | [军事评估委员会](37-military-evaluation-committee.md) | 跨会话、逐模板、难度校正和双部分报告 |
| 38 | [Preset generation 升级与恢复](38-preset-generation-upgrade-and-resume.md) | 内容寻址归档、重启恢复、迁移与隔离 |
| 39 | [契约真源与代码生成](39-contract-source-of-truth-and-code-generation.md) | Event Catalog、Schema/TS parity、生成门禁 |
| 40 | [身份、租户与授权](40-principal-tenant-authorization-model.md) | Principal、Authority Context、跨会话和数据分类 |
| 41 | [Workspace 集成与合并](41-workspace-integration-and-merge-protocol.md) | 隔离 worktree、Candidate Patch、回归与 local main |
| 42 | [物理存储与迁移](42-physical-storage-and-migration-design.md) | SQLite、CAS、Outbox、Artifact、恢复和 migration |
| 43 | [General 模型与会话策略](43-general-model-and-session-policy-precedence.md) | preset 默认、用户覆盖、子代理模板隔离 |
| 44 | [Decision Broker 状态机](44-decision-broker-state-machine.md) | 根 General 问题中继、去重、过期和恢复 |
| 45 | [RC.2 兼容探测](45-compatibility-probe-and-feature-matrix.md) | 精确基线、Feature Probe、fail-closed 和 Fixture |
| 46 | [安装、升级、回滚与卸载](46-install-upgrade-rollback-uninstall.md) | Profile CAS、generation、迁移、数据处置 |
| 47 | [战术知识供应链](47-tactical-knowledge-supply-chain.md) | 来源权利、投毒、时效、派生图和撤回 |
| 48 | [绩效统计、公平性与申诉](48-evaluation-statistics-and-fairness.md) | Dataset、难度校正、缺失数据、双评委和申诉 |
| 49 | [一致性与模型检查](49-conformance-and-model-checking.md) | Golden Trace、属性、TLA+、Fault Injection |
| 50 | [资源预算与准入控制](50-resource-budget-and-admission-control.md) | 多级预算、reservation、背压和循环停止 |
| 51 | [WebUI 冲突与恢复 UX](51-webui-interaction-and-conflict-ux.md) | revision、多标签页、断线、隔离和可访问性 |
| 52 | [产品术语与安全边界](52-product-terminology-and-safety-boundary.md) | 中性术语、现实用途排除和非胁迫表达 |
| 53 | [源码架构与包参考](53-source-code-architecture-and-package-reference.md) | 完整源码拓扑、服务图、包职责与 RC.2 适配边界 |
| 54 | [构建、测试、安装与运维](54-build-test-install-and-operations.md) | 构建流水线、测试门禁、安装步骤与运行操作 |
| 55 | [代码审查、安全与 RC.2 一致性](55-code-review-security-and-rc2-conformance.md) | 自动审查规则、修复结论和兼容性证据 |
| 56 | [RC.2 已知限制与迁移边界](56-known-rc2-limitations-and-migration-boundary.md) | 目标环境 E2E、generation 恢复和未来升级约束 |
| 57 | [绩效评估运行时](57-performance-evaluation-runtime.md) | 数据集重建、委员会执行、报告与申诉闭环 |
| 58 | [Worker Workspace 与子代理运行时](58-worker-workspace-and-child-spawn-runtime.md) | Task 绑定、worktree lease、RC.2 child setup 与回收 |
| 59 | [Web Client 打包与界面能力](59-web-client-packaging-and-surfaces.md) | RC.2 lazy client factory、Settings 与 Conversation Nodes |
| 60 | [Mission Kernel 2.0 与 Command Bus](60-mission-kernel-2-and-command-bus.md) | 单写者、Command、Outbox、恢复与双日志 |
| 61 | [Context Compiler 与 Evidence Graph](61-context-compiler-and-evidence-graph.md) | 四层上下文、RC.2 reasoning 预算、Claim–Evidence、V0–V4 |
| 62 | [自适应执行 Router](62-adaptive-execution-router-and-parallelism.md) | Capability、Plan IR、范式选择和并行度 |
| 63 | [Agentic Zero Trust](63-agentic-zero-trust-and-capability-grants.md) | 短期 Grant、内容污染和注意力预算 |
| 64 | [可观测性与决策链评估](64-observability-and-decision-chain-evaluation.md) | Trace、数据最小化与配置组合绩效 |
| 65 | [RC.2 兼容与适配迁移](65-rc2-compatibility-and-adapter-migration.md) | Subagent、Command、Web、DeepSeek 与 Team 边界 |
| 66 | [Legacy → RC.2 升级运行手册](66-legacy-to-rc2-upgrade-runbook.md) | 备份、迁移、Fixture、回滚和数据边界 |
| 67 | [Military 控制中心、Flash 工作台与可访问性](67-military-control-center-flash-workbench-and-accessibility.md) | 15 项设置、诊断、恢复、工作区、知识、评测与浏览器交付 |
| 68 | [General 全流程、DSH 全模型与设置持久化](68-general-workflow-live-models-and-settings-persistence.md) | Host 工作流义务、live catalog 可用性、reasoning 适配、原子保存与 71fe 回归 |
