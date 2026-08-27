# 术语表

| 术语 | 英文/标识 | 精确定义 |
|---|---|---|
| 统帅 | Supreme Commander / User | 提供原始目标、约束、风险偏好和外部授权的用户 |
| 将军 | General Agent | 主会话 Thinking Agent，负责战略转译、方向批准、战略升级和用户沟通 |
| 参谋部 | Staff Department | 多个用户可配置专业 Advisor 组成的计划和战术部门 |
| 主责参谋 | Lead Advisor | 对一次会商或战术请求负责最终合成、保留异议并输出结构化建议的参谋 |
| 专业参谋 | Specialist Advisor | 在特定领域独立研判、提供证据和建议的参谋 |
| 快速反应部队 | Work Agents / Workers | 执行单一 Task Order 的 Thinking-enabled Agent |
| 工兵部 | Engineer Corps | 专门建立和维护 specs、追踪矩阵及受限本地 Git 提交的 Agent 部门 |
| 督战队 | Oversight Corps | 确定性 Oversight Controller 与只读 Inspector Agent 的组合；可用中性名“监督与质量保障部” |
| 参谋部电台 | Staff Radio | 结构化战术请求、租约、去重、路由、版本校验与投递基础设施 |
| 后勤保障与研究部 | Logistics & Research | 轨迹总结、效能评估、战术博物馆三个固定 Agent 及其 Harness 编排 |
| Mission | Mission | 一次用户方向的版本化全局执行聚合 |
| Mission Intent | Mission Intent | General 对用户目标、约束、已知、假设、未知、完成条件和授权边界的结构化转译 |
| Direction | Direction | 围绕一个可独立结果域组织的多 Wave 计划 |
| Wave | Wave | 在同一计划、环境和同步屏障下执行的一批 Ready Task |
| 波次屏障 | Wave Barrier | Wave 退出前必须通过的集成、风险、specs、Git、报告和验收条件 |
| Task Order | Task Order | 分配给一个 Agent、具有冻结上下文和独立验收合同的最小执行命令 |
| 最小可独立验收单元 | Minimum Independently Verifiable Unit | 在模型认知负担与系统协调成本之间取得平衡的叶子 Task |
| Task Version | taskVersion | 目标、范围、环境、依赖或验收合同变化时递增的执行合同版本 |
| Revision | revision | 聚合事件状态的 CAS 修订号，不等同于 Task Version |
| Candidate | Candidate Submission | Worker/工兵提出的候选结果、Artifact、证据与声明；尚未被接受 |
| Blocker | Blocker | 可复现、已调查、带证据且需要修正或指导的阻塞 |
| Completion Interlock | Completion Interlock | 阻止 Agent 在未提交 Candidate/Blocker、未满足工具与证据纪律时正常完成的确定性联锁 |
| Completion Gate | Completion Gate | 判断 Task 是否满足交付与验收标准的门禁 |
| Escalation Gate | Escalation Gate | 判断一个未完成阻塞是否已调查充分、值得消耗参谋指导资源的门禁 |
| Acceptance Contract | Acceptance Contract | 定义 Artifact、检查、不变量、禁止副作用、回归和证据覆盖的版本化验收合同 |
| Verifier | Verifier | 编译、测试、Schema、规则、证据、回归或领域检查的外置验证器 |
| Inspection Report | Inspection Report | 只读 Inspector 对工具、声明、范围、歧义和异常的结构化报告 |
| Freeze | Freeze | Harness 暂停 Agent 新步骤和写工具、保留证据与 Inbox 的权威状态 |
| Correction Order | Correction Order | 参谋部根据 Inspection/Verification 发给被冻结或返工 Agent 的版本化修正命令 |
| Tactical Request | Tactical Request | 子 Agent 经 Escalation Gate 发送的身份、环境、技能、尝试、证据与明确决策问题包 |
| Tactical Guidance | Tactical Guidance | 参谋综合私有战术后编译成的单一可执行指令 |
| 私有战术 | Tactical Skill / Procedure | 带场景、前置/排除、状态机、步骤、预期观察、Verifier、停止和回滚的版本化战术知识 |
| 战术轨迹 | Tactical Trajectory | 从已验收事件、Artifact、决策和阻塞生成的可追溯执行轨迹 |
| 战术效能 | Tactical Effectiveness | 战术、模型、粒度和指导对外置验收结果的统计与解释 |
| 战术博物馆 | Tactical Museum | 固化历史版本、失败边界与效能证据，并提出下一待测战术的研究 Agent |
| Tactical Report | Tactical Report | Harness 从 accepted/rejected 事实确定性生成的结构化战术汇报 |
| Tactical Memory | Tactical Memory | 轨迹 Agent 基于 Tactical Report 生成、经来源覆盖验证后供 General 消费的记忆投影 |
| Mission Ledger | Mission Ledger | 跨 Agent、跨 Session、不可变且可 CAS 追加的全局领域事件账本 |
| Session Log | DSH Session Log | 单 Agent 模型可见事实与生命周期的持久来源 |
| Artifact Store | Artifact Store | 内容寻址保存 Diff、测试、日志、截图、文档、API receipt 等证据的存储 |
| specs 工程 | specs engineering | 工兵维护的需求、架构、ADR、计划、验收、运维和追踪文档集合 |
| Promotion Order | Promotion Order | 用户明确授权后，由 General 执行远端或非 `main` Git 动作的审计命令 |
| Agent Scope | Agent Scope | 每个 Agent 独立的 persona、工具、模型策略、权限与服务注册边界 |
| Effective Reasoning | effective reasoning | 经过 Adapter materialize 并持久记录在请求头中的实际推理强度 |
| Stale | Stale | 对旧 Task Version、旧环境、旧 Advisor generation 或已变化 Artifact 产生，因而不得生效 |
| Lease | Lease | 对 Task、Radio Request 或资源的有时限独占处理权 |
| Idempotency Key | idempotencyKey | 防止相同命令因重试重复产生副作用的稳定键 |
| Dead Letter Queue | DLQ | 反复失败、过期或无法路由的战术请求隔离区 |
| 固定 Military preset | `military` preset | 仅在空白会话选择、开始后锁定的 DSH Agent Plane 组合 |
| Preset Generation | `presetGeneration` | `preset.yml` 与 `agent.cordis.yml` 的内容寻址组合身份 |
| Generation Archive | Generation Archive | 为历史 Session 跨进程恢复保留的不可变 preset 资产 |
| Military Session Binding | MilitarySessionBinding | Session、actual preset、generation、root General、tenant 和 RC.2 基线的持久绑定 |
| General Model Default | GeneralExecutionPolicy | 固定 preset 提供的根 General 默认 provider/model、reasoning 和 context policy |
| Session Model Override | ModelSelectionReceipt | 用户通过会话页面选择并只作用于 General 后续请求的模型路由事实 |
| Authority Context | MilitaryAuthorityContext | Principal、Tenant、角色、Scope、所有权和数据分类准入上下文 |
| Policy Profile | Tool/Permission/API/... Profile | 可版本化、可撤销的工具、权限、API、驻留、脱敏、Verifier 和模型能力契约 |
| Workspace Snapshot | WorkspaceSnapshot | Task 开始时 Git、文件和环境的不可变基线 |
| Workspace Lease | WorkspaceLease | Agent 对隔离 Workspace 与路径的有时限权限 |
| Candidate Patch | CandidatePatch | Worker 在隔离 Workspace 产生、等待验收与集成的内容寻址修改 |
| Integration Order | IntegrationOrder | 将已接受 Patch 应用到受控 local `main` 的权威命令 |
| Integration Receipt | IntegrationReceipt | 应用、冲突、回归或 stale 的不可变集成结果 |
| Decision Broker | DecisionBrokerRecord | delegated child 问题到根 General 用户弹窗的持久状态机 |
| Tactical Source Snapshot | TacticalSourceSnapshot | 提炼来源、权利、分类、时效和安全扫描的不可变快照 |
| Knowledge Revocation | KnowledgeRevocationOrder | 撤回来源并隔离派生战术、重验结果和通知用户的命令 |
| Evaluation Dataset Manifest | EvaluationDatasetManifest | 绩效评估纳入/排除、难度、缺失、权重和 dataset hash 的冻结事实 |
| Resource Reservation | Resource Reservation | 在昂贵工作开始前占用模型、并发、工具、时间或存储额度 |
| Compatibility Probe | CompatibilityReport | 对固定 RC.2 seam 和部署能力的启动探测结果 |
| Quarantine | `QUARANTINED` | 因 generation、权限、资产或兼容事实不足而禁止模型/写工具的安全状态 |
| Transactional Outbox | Transactional Outbox | Event 同事务记录待投递消息，消费者幂等执行的跨系统一致性模式 |
| 中性术语模式 | `terminologyMode=neutral` | 只改变 UI 显示词、不改变机器 ID、权限和状态的 presentation 设置 |
