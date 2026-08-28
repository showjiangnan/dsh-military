# 用户需求到工程设计的追踪矩阵

本矩阵把补充构想映射到权威设计、机器契约、运行门禁和验证资产，防止需求只在自然语言总纲中出现。

| ID | 需求/设计意图 | 权威设计 | 机器契约/示例 | 强制或验证机制 |
|---|---|---|---|---|
| R-01 | Bundle 命名为 `dsh-military`，表达多代理军队组织 | `docs/00`、`docs/03`、`docs/21` | `examples/cordis.patch.example.yml` | Bundle 只组合，领域逻辑在独立服务 |
| R-02 | 用户是统帅，General 是最高指挥 Agent | `docs/03`、`docs/06`、`docs/28` | `schemas/mission-intent.schema.json` | Mission Intent、Direction Ratification、用户授权事件 |
| R-03 | General 负责把用户方向转成专业结构化数据 | `docs/04`、`docs/06` | `examples/mission/mission-intent.example.yaml` | Schema、未知/假设分离、General 专属领域工具 |
| R-04 | 战术指导改为多专业参谋部 | `docs/07` | `schemas/staff-advisor-profile.schema.json` | Advisor eligibility、独立研判、主责参谋合成 |
| R-05 | 用户可在 WebUI 自定义参谋 | `docs/07`、`docs/17` | 两个 Advisor Profile 示例 | Settings namespace、revision fencing、Canary/停用状态 |
| R-06 | 参谋可配置职责、权限、技能、企业 API 和独家数据 | `docs/07`、`docs/18` | Advisor Profile Schema | Tool/Skill/API/Data Grant 交集、Credential Reference、Gateway 审计 |
| R-07 | 参谋部决定 Worker 任务与建议兵力 | `docs/05`、`docs/07` | Direction/Wave/Task Schema | Staff 形成 Force Plan；Harness 依据容量、冲突和风险最终调度 |
| R-08 | Worker 必须开启 Thinking，成功率优先 | `docs/08`、`docs/29`、ADR-0007 | Role Model Policy 类型 | `agent/request` 强制、`request/header` 对账、`off` fail closed |
| R-09 | 子 Agent 求援改为参谋部电台 | `docs/11`、ADR-0004 | Tactical Request/Guidance Schema | Broker、lease、dedupe、expiry、DLQ、taskVersion |
| R-10 | 求援必须报告身份、环境、已用私有技能 | `docs/11` | `examples/radio/tactical-request.example.yaml` | Escalation Gate、Harness 自动附加 Evidence/Environment |
| R-11 | 私有 Skill 比传统 Skill 更丰富、带状态机和版本 | `docs/12`、ADR-0006 | Tactical Skill Schema/示例 | Registry、SemVer、preconditions、stateMachine、Verifier、rollback |
| R-12 | 每次检索 3–5 个战术，再编译为指导 | `docs/07`、`docs/12`、`docs/31` | Tactical Guidance Schema | 3–5 候选召回；1 个主战术 + 最多 2 个补充；单一 Directive |
| R-13 | 后勤研究部固定三个 Agent | `docs/13`、ADR-0008 | Tactical Report/Memory/Effectiveness Schema | Harness 编排，模型 Agent 不直接变更 Task |
| R-14 | General 每次成功 compaction 后评估战术效能 | `docs/13`、`docs/16` | Effectiveness Assessment 示例 | 监听 compaction 生命周期；按 compactionId exactly-once |
| R-15 | 战术博物馆归档、研究并产生待测版本 | `docs/12`、`docs/13`、`docs/28` | Tactical Skill lifecycle | DRAFT→SIMULATION→CANARY→TESTING→STABLE；发布门禁 |
| R-16 | 空项目/头脑风暴时由工兵建立 specs 工程 | `docs/04`、`docs/09` | `templates/specs/`、Specs Maintenance Order | 项目阶段侦察；IDEATION 先 specs baseline 再实现 |
| R-17 | 每轮后工兵立即维护可持续文档工程 | `docs/09`、`docs/05` | specs 模板和追踪矩阵 | Wave Barrier 必须包含 specs maintenance receipt |
| R-18 | 无 Git 时建立本地 `main`，每轮本地 commit | `docs/09`、ADR-0005 | Git/Specs 示例 | 专用 Git Provider，`git init -b main`，commit receipt |
| R-19 | GitHub 或其他分支只能由 General 亲自执行 | `docs/06`、`docs/09`、`docs/18` | Promotion Order Schema/示例 | 用户显式授权 + General 专属工具；工兵永久无 push 权 |
| R-20 | 督战队只读监督工具真实性和异常 | `docs/10` | Inspection Report Schema | durable Tool/Event 对账；Inspector read-only Scope |
| R-21 | 异常 Agent 完成前立即冻结并上报参谋 | `docs/10`、ADR-0002 | Inspection Report/Event Schema | Completion Interlock、Guard、pre-step reject、cancel keepInbox |
| R-22 | 参谋对冻结 Agent 下达修正任务 | `docs/10`、`docs/11` | Tactical Guidance/Correction 结构 | Staff disposition + Harness release/replace；Agent 不可自解冻 |
| R-23 | 轻量模型需要非常清晰的边界和标准 | `docs/05`、`docs/08`、`docs/29` | Task Order、Acceptance Contract | 最小充分上下文、写集合、DecisionBudget、强 Verifier |
| R-24 | 计划分为方向与波次，再拆小任务 | `docs/05` | Direction/Wave/Task Schema | DAG、依赖类型、Ready frontier、Wave Barrier、版本化计划 |
| R-25 | 子任务逻辑关联和时序需科学处理 | `docs/05`、`docs/15` | Wave/Task dependency schema | requires/consumes/locks/validates/speculativeWith/joinsAt/supersedes |
| R-26 | 所有结果必须严格外置验收 | `docs/14` | Acceptance/Candidate Schema | Propose→Verify→Commit；模型无接受权 |
| R-27 | 战术汇报与记忆只吸收已验收事实 | `docs/13`、`docs/15` | Tactical Report/Memory Schema | 来源覆盖验证；Candidate 与 Accepted 明确分层 |
| R-28 | 方案可用于实际开发 | `docs/21`、`docs/22`、`docs/27`、`docs/31` | TS types、Schema、Cordis/Settings 示例 | Phase 0–8、首个垂直切片、契约校验脚本 |
| R-29 | 随 Bundle 提供固定独立 `military` preset | `docs/32`、ADR-0013 | `reference/preset/agent-presets/military/`、profile overlay、Session Binding Schema | 安装器保留现有 roots；新建会话 preset chip；已开始会话锁定；standing scope |
| R-30 | 未选择 preset 时不能使用任何会话侧 Military 能力 | `docs/32`、`docs/16` | Session Binding 示例 | scope 不可见 + actual-preset guard；普通会话 listener early return |
| R-31 | 同工作区会话互不串扰 | `docs/32`、`docs/18` | `military-session-binding.schema.json` | tenant/rootSession/mission 复合键；Military 锁不拦截普通会话 |
| R-32 | 历史会话可提炼为私有战术 | `docs/33`、ADR-0014 | Ingestion Request/Candidate Schema | 显式来源授权、快照、扫描、用户 Diff、DRAFT lifecycle |
| R-33 | 用户直接输入稀有经验可提炼 | `docs/33` | direct experience 示例 | 同一 ingestion pipeline；不得直接发布 Stable |
| R-34 | 用户管理战术标签的新增、暂停、删除、重命名 | `docs/33` | Tactical Tag Schema/示例 | 稳定 tagId、alias、PAUSED、DELETED tombstone、revision fencing |
| R-35 | 设置页管理各部门非 General Agent 模型与 Thinking | `docs/34`、ADR-0015、`docs/68` | Agent Template Profile Schema | templateId@revision；DSH live route 默认可用；adapter-owned effort 翻译 |
| R-36 | 设置上下文预算和压缩触发百分比 | `docs/34` | Worker Template 示例 | threshold=floor(budget×percent)；safe-boundary compaction attempt |
| R-37 | 用户可手动增加领域参谋 | `docs/07`、`docs/34` | Advisor + Agent Template Schema | 名册、权限交集、Canary/Active、Retire 保留历史 |
| R-38 | 显式“头脑风暴”命令并多用问答弹窗 | `docs/35`、ADR-0016 | Brainstorm Order/Decision Set Schema | Web 显示中文；协议 `/brainstorm`；General 调用 `ask_user_question` |
| R-39 | 私有战术不足时由参谋长兜底 | `docs/36`、ADR-0016 | Chief Advice Schema | Tactical Sufficiency Gate；GENERATED_REFERENCE；预算与升级 |
| R-40 | 参谋长最好让用户选择 | `docs/35`、`docs/36` | Decision Question Set | 子代理不直接弹窗；General 去重并调用 ask-user |
| R-41 | 新增军事评估委员会 | `docs/37`、ADR-0017 | Evaluation Request/Individual/Report、Administrative Event Schema | 跨会话 Job、Dataset Auditor、Examiner、Chair |
| R-42 | 用户选择时间区间评估全部 Military 会话 | `docs/37` | Evaluation Request 示例 | actual-preset 过滤、权限、冻结 dataset hash、可恢复 Job |
| R-43 | 报告含各模板与总体两个部分 | `docs/37` | Military Performance Report | Part A individual + Part B overall，机器 Schema 验证 |
| R-44 | 绩效含参与、准确、智能、完成和改进建议 | `docs/37` | Agent Template Performance Schema | 外置指标、难度校正能力指数、样本/置信、Canary 建议 |
| R-45 | General 默认模型由 `military` preset 提供 | `docs/06`、`docs/43`、ADR-0023 | General Execution Policy、preset `military-general-model-default` | 未显式选择时填充 provider/model；不使用全局未知默认 |
| R-46 | 用户在会话页面切换模型时 General 随之切换 | `docs/17`、`docs/29`、`docs/43` | Model Selection Receipt Schema | 只影响 General 后续请求；live route 建档、effort/context 动态适配；失败保留旧路由 |
| R-47 | 子代理不跟随 General 会话模型切换 | `docs/34`、`docs/43`、ADR-0023 | Agent Template Profile | Agent 创建时冻结 template revision 与 route；attempt 中不热漂移 |
| R-48 | RC.2 作为当前完整版本唯一支持基线 | `docs/16`、`docs/45`、`VERSION.md` | RC.2 compatibility matrix/report | release+commit 精确探测；其他版本不声明支持，关键 seam 缺失 fail closed |
| R-49 | preset 升级后旧会话可被精确识别并安全恢复或迁移 | `docs/38`、ADR-0018 | Generation Manifest、Migration Order、Session Binding | current→MATCHED；同进程 standing scope 可 ARCHIVE_REBOUND；archived-only 根重启→QUARANTINED/MIGRATION_REQUIRED |
| R-50 | Schema、TS、Event 和示例不漂移 | `docs/39`、ADR-0019 | Event Catalog、parity map、generator | 判别联合生成；field/required parity；生成物 freshness；Event JSONL 全覆盖 |
| R-51 | 跨会话和管理操作有身份、租户与授权 | `docs/40`、ADR-0020 | Authority Context、Authorization Receipt | principal/tenant/scope/classification/revision/expiry；deny-first 与审计 |
| R-52 | Worker 修改不直接污染主工作树 | `docs/41`、ADR-0021 | Workspace Snapshot/Lease、Candidate Patch、Integration Receipt | 独立 worktree；验证后排队；全局回归；Harness/工兵受控 local main |
| R-53 | Event、Artifact、Radio 与 Git 有物理事务设计 | `docs/42`、ADR-0022 | `reference/sql/` | CAS、outbox、dedupe、fsync/rename、compensation、migration ledger |
| R-54 | 多子代理用户问题可恢复且不并发弹窗 | `docs/44`、ADR-0024 | Decision Broker Record | 根 General 独占 ask-user；priority、dedupe、expiry、stale、多标签页 revision |
| R-55 | DSH seam 变化通过能力探测管理 | `docs/45`、ADR-0025 | Compatibility Report | READY/DEGRADED_READ_ONLY/MIGRATION_REQUIRED/UNSUPPORTED；不静默降级 |
| R-56 | Bundle 有原子安装、升级、回滚和卸载 | `docs/46`、ADR-0026 | Bundle Lifecycle Receipt | profile CAS、备份、migration、probe、rollback、数据处置与同名冲突 |
| R-57 | 私有战术有来源权利、投毒防护与撤回 | `docs/47`、ADR-0027 | Tactical Source Snapshot、Revocation Order | rights、classification、时效、矛盾/重现、派生图、quarantine/revalidation |
| R-58 | 绩效报告可复现、公平并允许申诉 | `docs/48`、ADR-0028 | Frozen Dataset、Manifest、Appeal | 难度分层、缺失机制、Mission-cluster 区间、抗刷分、superseding revision |
| R-59 | 关键状态和竞态有一致性与模型检查 | `docs/49`、ADR-0029 | Conformance Trace Schema、TLA+ reference | Golden Trace、属性测试、Fault Injection、RC.2 Fixture |
| R-60 | Thinking 优先但仍有资源硬上限 | `docs/50` | Resource Budget Policy | 多级 reservation、背压、无信息增益、用户追加授权、fail-safe disposition |
| R-61 | WebUI 处理冲突、断线、恢复和可访问性 | `docs/17`、`docs/51`、`docs/59` | Settings/evaluation 已实现；运行态 projection UI 为 Beta 门禁 | revision fencing、多标签页、Job resume、generation quarantine、E2E accessibility |
| R-62 | 军事术语只是软件隐喻并支持中性显示 | `docs/26`、`docs/52` | `military-presentation` Settings | presentation-only alias；权限/事件不变；排除现实伤害和人员处分用途 |

| R-63 | 每个子代理实例冻结实际模型、权限、Verifier 与预算配置 | `docs/34`、`docs/43` | Agent Execution Binding Schema | 创建前解析并持久化 binding；模型请求和绩效引用 bindingId；设置修改不热改实例 |
| R-64 | Preset 跨重启检测、恢复或隔离有完整可审计回执 | `docs/38` | Preset Resume Receipt Schema | Agent 发布前写入；Manifest/Binding/Receipt 三方对账；不支持的 archive rebind fail closed |
| R-65 | 资源预算执行预留与幂等结算 | `docs/50` | Budget Reservation/Usage Receipt Schema | 层级 CAS、过期回收、相同 idempotencyKey 只计一次、未预留不准入 |
| R-66 | 绩效报告支持结构化申诉和新 revision | `docs/48` | Performance Evaluation Appeal Schema | 不改写旧报告；证据化 challenge；独立评审；生成 superseding report |
| R-67 | General 模型规则保持 preset 默认并服从会话页面显式切换 | `docs/43`、`reference/preset/` | General Policy、Model Selection Receipt | 仅影响 General 后续请求；不传播至现有或新模板路由子代理 |

| R-68 | Mission 使用单写者 Command Bus | `docs/60`、ADR-0033、ADR-0040 | Command/Event/Activity contracts | tenant+mission 串行化、短事务 Saga checkpoint、receipt+outbox finalization、幂等 payload hash |
| R-69 | 上下文由 Context Compiler 生成并可审计 | `docs/61`、ADR-0034 | Context Manifest + Artifact + `context/manifest-created` | Constitution/State/Evidence/Working；摘要覆盖与遗漏；请求前内容寻址持久化和 Admin Ledger 留痕 |
| R-70 | Candidate 使用 Claim–Evidence 和 V0–V4 验收 | `docs/61`、ADR-0034 | Acceptance/Evidence | V4 不可独立接受，至少一项 V0–V3 独立证据 |
| R-71 | 模型、Thinking、范式与并行度自适应路由 | `docs/62`、ADR-0035 | Execution Strategy | Capability 交集、Plan IR、Parallelism Score、默认单 Worker |
| R-72 | Agent 使用短期 Task-bound Capability Grant | `docs/63`、ADR-0036 | Permission/Grant contracts | 限工具、资源、数据、次数、期限与撤销；输入/动作双检 |
| R-73 | 绩效评估覆盖完整决策链 | `docs/64` | Evaluation Dataset/Report | Planning/Route/Execution/Verification/Integration 分段归因 |
| R-74 | 精确支持 DSH RC.2 | `docs/45`、`docs/65`、ADR-0037 | RC.2 matrix/fixtures | commit `b150a551...`，Subagent/Command/Web/DeepSeek 适配 |
| R-75 | RC.2 continuable child 支持预留 ID 和选择性清理 | `docs/65` | AgentExecutionBinding/Activity | childId 先持久化；quiet/next-step；selective drain |
| R-76 | `/brainstorm` 支持图片证据 | `docs/35`、`docs/61`、`docs/65` | Attachment/Evidence refs | DSH admission、vision capability、分类与图片预算 |
| R-77 | Experimental Agent Team 不成为权威真源 | `docs/65`、ADR-0038 | Compatibility policy | 仅投影/实验，不替代 Mission/Radio/Task/Workspace/Verification |
| R-78 | RC.2 Session Log 不承载 Military 私有权威事件 | `docs/42`、`docs/55`、`docs/65` | Mission/Admin Ledger、Session adapter boundary | 禁止 required `military/*` append；评估/恢复只读 Military Ledger 与 Binding |

## 关键设计修正

用户构想中的部门决策被保留，但运行权威进一步收紧：

- **Military 是固定 preset，不是运行时布尔模式。** 只在空白会话组装，已开始会话不可切换。
- **管理平面可常驻，会话能力必须 scope 隔离。** 普通会话不会看到或触发 Military 模型能力。
- **参谋部负责计划和兵力建议，Harness 负责最终调度。** 模型不能绕过并发、锁、Verifier 和预算。
- **督战 Inspector 负责发现和解释，Harness 负责冻结。** 冻结/释放不是模型权限。
- **“拆得越小越好”改为最小可独立验收。** 防止协调成本超过模型收益。
- **心跳用于故障检测，不用于正常模型轮询。** 正常路径由 durable event 唤醒。
- **战术 3–5 个是召回候选数。** Advisor 编译为单一 Directive 后再交给 Worker。
- **战术提炼先成为 Candidate。** 来源会话或用户经验都必须安全扫描、审阅和版本化。
- **子代理模板按 revision 冻结。** 模型、Thinking 和上下文策略不能在 Attempt 中途漂移。
- **用户弹窗由 General 统一拥有。** Advisor/Chief 只提交问题集，避免 delegated caller 和并发弹窗。
- **绩效评估不等于主观打分。** Harness 计算数据，委员会解释并给出有置信边界的建议。


## 源码实现追踪（0.9.0-alpha.28）

| 需求 | 源码实现 | 自动证据 |
|---|---|---|
| 固定 Military preset | `packages/preset`、`packages/installer` | preset/installer tests、generation hash |
| General 默认 + 会话模型切换 | `plugin-host/general-model-default.ts`、`agent-plane.ts` | General routing test、review check |
| 子代理冻结模板 | `runtime/agents.ts`、SQLite execution binding | SQLite binding test、request policy |
| Worker 隔离执行 | `infrastructure/workspaces.ts`、Host workspace coordinator | worktree/Candidate Patch tests |
| 外置验收 | `core/verification.ts`、Worker tools | verification tests |
| 工兵 specs/local main | `infrastructure/specs.ts`、`plugin-host/specs-control.ts` | specs Git test、review check |
| 督战冻结 | `core/oversight.ts`、`plugin-host/agent-plane.ts` | state invariant/review check |
| 电台与参谋长 | `core/radio.ts`、`runtime/chief-of-staff.ts` | radio/decision tests |
| 战术提炼/标签 | `runtime/ingestion.ts`、`core/tags.ts` | ingestion/tag tests |
| 绩效评估 | `core/evaluation.ts`、`plugin-host/session-adapters.ts`、`evaluation-remote.ts`、`storage-sqlite/evaluation-records.ts`、Web 七视图 | evaluation/benchmark/UI/restart tests |
| RC.2 薄适配 | `plugin-host/rc2-adapter.ts`、`child-transport.ts`、`command-brainstorm` | RC.2 adapter boundary tests、contract snapshot |
| RC.2 Session 边界 | `plugin-host/session-events.ts`、`session-adapters.ts` | no-private-session-event review/test |
| Web 当前边界 | `packages/webui` 角色/恢复/工作区/基准/知识/绩效决策中心；无私有 Session Conversation Node | dynamic manifest/build、全量回归、真实 Profile graph/Settings restart E2E |
| 普通会话隔离 | preset standing scope + Host `isMilitaryAgent` | composition/isolation tests |
| 文档同步和发布 | `scripts/*`、`docs/docs/53–59` | validation, review, test, pack reports |


## 0.9.0 repair requirements

| ID | Requirement | Implementation | Gate |
|---|---|---|---|
| R-90 | 外部 Command failure 可恢复且不持有长事务 | short-transaction Command Saga | intent/effect/finalization crash-window tests |
| R-91 | Duplicate command returns the persisted original result after restart | durable Command Receipt | restart idempotency test |
| R-92 | Worktree absolute paths are canonicalized before grant checks | Agent plane canonical resource pipeline | absolute-path tool-hook test |
| R-93 | Candidate evidence is Harness-observed | Observed Evidence Store | spoofed evidence rejection test |
| R-94 | Integration survives commit/receipt crash windows | durable Integration reconciliation | Git crash matrix |
| R-95 | All critical control state survives restart | durable administrative state | cold-recovery suite |
| R-96 | Runtime and ledger produce identical Task states | shared Task reducer | reducer parity property test |
| R-97 | Authority and budgets are hard admission boundaries | command/activation/model/tool hooks | denial-no-side-effect tests |
| R-98 | Complex tool inputs use canonical schemas | runtime contract validator | invalid nested input corpus |
| R-99 | Exact RC.2 compilation is required for release | release:verify | official checkout gate |
| R-100 | 12 角色使用可搜索目录和单角色编辑器 | `docs/17`、`docs/67` | `RoleWorkbenchSnapshot` | 搜索/筛选、roving listbox、草稿 guard、IME 回归 |
| R-101 | 有效 Prompt 必须由真实 Host 编译器预览 | `docs/34`、`docs/67` | `EffectivePromptPreview` | 六层顺序、只读 Host 层、Prompt Assembly parity |
| R-102 | Flash readiness 离线、确定且可修复 | `docs/29`、`docs/67` | `FlashReadinessReport` | 稳定 code/位置/建议、默认 12 角色通过、BLOCKED 门 |
| R-103 | 角色工具模拟和在线 Canary 不扩大权限 | `docs/67` | `RoleSimulationReport` | actual ToolProfile、显式只读确认、不自动晋升/fallback |
| R-104 | 角色设置原子保存并处理 revision 冲突 | `docs/51`、`docs/67` | `RoleWorkbenchDocument` | semantic Diff、CAS、undo/rollback、portable import/export |
| R-105 | Session 工具链可沿权威事实诊断 | `docs/24`、`docs/67` | `MilitaryOperationsSnapshot` | RC.2 event + Host receipt、服务端脱敏、只读 timeline |
| R-106 | 恢复动作先预览、确认并幂等持久化 | `docs/24`、`docs/67` | Recovery Preview/Receipt | confirmation phrase、operationId、restart replay |
| R-107 | 提示词保存/回滚保留不可变历史和使用归因 | `docs/34`、`docs/67` | `RoleConfigurationRevision` | revision pin、readiness、Session/token/tool/evaluation refs |
| R-108 | 模型下拉由 DSH live catalog 与能力证据驱动 | `docs/29`、`docs/67`、`docs/68` | `MilitaryModelCatalogEntry` | 所有 live exact route 默认可选；status/绩效不充当权限；仅目录缺失路线拒绝 |
| R-109 | 成本和预算对普通用户可理解且不削弱治理 | `docs/50`、`docs/67` | `RoleBudgetPreset`、metrics | token/中文字符/observed usage、未知价格显式、权限不变 |
| R-110 | Specs Workspace 不接受浏览器任意路径 | `docs/41`、`docs/67` | `MilitaryWorkspaceStatus` | opaque ID、canonical/Git/lease/integration、unknown ID 拒绝 |
| R-111 | Flash 基准使用固定数据集并分离 Provider 样本 | `quality/MODEL-BENCHMARK`、`docs/67`、`docs/69` | `MilitaryBenchmarkSnapshot` | 九场景 hash、exact route、趋势 N<10 insufficient、发行 N≥50/Wilson/零安全失败 |
| R-112 | 简体中文检查必须由用户确认且跳过代码路径 | `docs/67` | `SimplifiedChineseReviewReceipt` | UTF-16 位置、Host hash/recompute、伪造拒绝、undo |
| R-113 | 知识透明度和模拟召回与真实规则一致 | `docs/47`、`docs/67` | `MilitaryKnowledgeCenterProjection` | sanitized lineage、shared resolver/renderer、no Task/model |
| R-114 | 控制中心具备键盘、IME、zoom 和高对比度合同 | `docs/51`、`docs/67` | Web ARIA/CSS contract | tabs/listbox/dialog、focus trap/return、forced-colors |
| R-115 | 绩效 Request 和唯一冻结 Dataset 同源 | `docs/37`、`docs/57`、ADR-0028 | Request、Frozen Dataset、Manifest | 全筛选进入 Builder；canonical dataset artifact/hash；确定性重跑 |
| R-116 | 绩效 TS、Schema、运行时校验和示例一致 | `docs/27`、`docs/57` | Attempt/Dataset/Individual/Report schemas | docs→package 生成、边界校验、示例 validator |
| R-117 | Attempt attribution 精确且不跨 lease 泄漏 | `docs/48`、`docs/57` | `EvaluationAttemptRecord` | Task version、Agent generation、lease sequence、bounded event window |
| R-118 | exact execution configuration 永不混组 | `docs/37`、`docs/48` | `EvaluationConfigurationSnapshot` | route/prompt/reasoning/tool/permission/bundle/DSH configuration key |
| R-119 | 难度和缺失不受执行结果反向污染 | `docs/48`、统计协议 | Attempt task/failure | pre-execution difficulty、missing reason/mechanism、bias notes |
| R-120 | 指标和工具失败按权威阶段归因 | `docs/48`、`docs/57` | Attempt outcome/failure | numerator/denominator/Evidence；schema/path/permission/runtime 分离 |
| R-121 | Provider 样本和九场景不能刷 N 或假通过 | `docs/57`、`docs/67` | Benchmark sample/snapshot | dataset+Session+scenario 去重；完整 sequence/path/receipt/terminal/wakeup |
| R-122 | 统计区间以 Mission 为独立单位 | `docs/48`、统计协议 | rate/numeric interval | Wilson envelope、固定种子 cluster bootstrap、动态充分性 |
| R-123 | Flash/Pro 用非劣比较和安全硬门 | `docs/37`、`docs/48` | Configuration Comparison | same-role/difficulty、exact route、paired Mission、promotion=false |
| R-124 | 经济性按最终 Accepted Outcome 归一化 | `docs/48`、`docs/57` | Performance efficiency/intervals | 累计失败/返工；unknown cost unavailable；quality-first Pareto |
| R-125 | Evaluation Job/分片/报告在重启后恢复 | `docs/30`、`docs/57` | Run summary、SQLite records | lease/fence、timeout、structured failure、只补缺失 shard |
| R-126 | 报告历史和申诉形成不可变谱系 | `docs/37`、appeal checklist | Report revision、Appeal | Host Dataset membership、new Dataset、superseding Report |
| R-127 | 绩效中心提供七个可理解视图 | `docs/17`、`docs/37` | `EvaluationCenterSnapshot` | 总览/比较/九场景/漏斗/Pareto/Evidence/历史申诉 |
| R-128 | 委员会模型可选且不能改变事实 | `docs/37`、`docs/57` | narrative mode/settings | deterministic default、aggregate-only、no tools、strict JSON fallback |
| R-129 | 绩效 v2 有纵向测试、发行与本机验收 | `quality/TEST-MATRIX`、`docs/57` | Release reports/checksums | generate/typecheck/test/docs/RC2/repro/profile/3-boot/browser |
| R-130 | General 项目执行不能以正文代码绕过部门流程 | `docs/06`、`docs/68` | General workflow obligation | intent→Mission→Task→status→spawn 单阶段门、stop interlock、71fe fixture |
| R-131 | DSH 已接入的官方和第三方模型默认可用于 Military | `docs/29`、`docs/43`、`docs/68` | catalog-derived capability、adapter effort translation | no-reasoning/custom effort/DEPRECATED route、General/部门/私有技能回归 |
| R-132 | 部门模型和参数保存后必须即时且持久生效 | `docs/51`、`docs/67`、`docs/68` | Settings CAS、multiline prompt validator、serialized runtime projection、authoritative readback | CR/LF/TAB draft、NUL 拒绝、watcher/save race、stale poll、third-party route、budget clamp、React reload |
| R-133 | 每条执行请求与任意 open Task 精确区分 | `docs/69`、ADR-0039 | WorkflowObligation | request hash、stage、nextTool、wake cursor、多 open Task regression |
| R-134 | Task Version 与执行 Attempt/Activation/Dispatch 分离 | `docs/69`、ADR-0039 | execution lifecycle contracts | 三次 Rework、start/heartbeat/settlement、no false RUNNING |
| R-135 | Stop、Task/Mission Cancel、Freeze 与 Identity termination 语义独立 | `docs/24`、`docs/69` | lifecycle coordinator + Operations `CANCEL_MISSION` | target/reason、preview/CAS/expiry、Kernel command、late/duplicate/out-of-order settlement、child resource cleanup |
| R-136 | Radio/Decision continuation 绑定 exact Task/Attempt | `docs/11`、`docs/44`、`docs/69` | Radio/Decision records | delivery/ack、TTL、dead-letter、resume tests |
| R-137 | Verification 不得绕过 Integration 宣布 Task 完成 | `docs/14`、`docs/41`、`docs/69` | Candidate/Verification/Integration state machines | accepted/conflict/stale/regression/completion tests |
| R-138 | SQLite 写锁不得跨外部异步工作且 repository 不得绕过 writer | `docs/30`、`docs/42`、ADR-0040 | `mission_command_operations` + guarded database handle | async callback rejection、standalone `run/exec` short transaction、maintenance boundary、Saga restart/finalization tests |
| R-139 | Workspace 与 Outbox 在崩溃后保持唯一真源 | `docs/41`、`docs/42`、`docs/69` | workspace state + transactional outbox | adopt/quarantine、ordering/retry/dead-letter/offset tests |
| R-140 | Direction/Wave/DAG barrier 真正控制派遣 | `docs/05`、`docs/69` | Mission Scheduler | unknown dependency/cycle/write conflict/Wave barrier tests |
| R-141 | 已持久化 Workbench 必须无损跟随内置模板升级 | `docs/30`、`docs/67`、`docs/68` | exact runtime history + package revision base | revision 6→8、custom stale→current+1、历史缺失/内容不符 fail closed |
| R-142 | Legacy Agent Template 镜像不得覆盖 Workbench 真值 | `docs/46`、`docs/66`、`docs/67` | Settings revision/CAS + runtime-head mirror | reset base、mirror conflict、APPLIED ordering、restart |
| R-143 | Workbench 升级保持用户意图且可重复执行 | `docs/30`、`docs/51`、`docs/67` | `PLUGIN_MIGRATION` revision history | General/Engineer/Worker 保持、逐字段 user delta、第二次启动零新增 revision |
| R-141 | 轻量模型只提交 Task 相对路径和浅层 draft，并获得唯一可执行纠错动作 | `docs/58`、`docs/69` | Task-rooted workspace tools + unified error envelope | path/symlink/operation-status/schema/terminal-latch、nextTool/correctedShape、secret/host-path redaction tests |
| R-142 | 模型能力四轴分离且 exact adapter Dispatch 可审计 | `docs/29`、`docs/69` | capability bridge + dispatch receipt | native/bridge/canary/catalog/policy tests |
| R-143 | 角色设置区分 Desired 与 Applied | `docs/51`、`docs/69` | workbench reconcile state | partial apply failure、retry、rollback、multi-tab fence tests |
| R-144 | Runtime Center 和所有 Web feature 使用统一 query 真值层 | `docs/17`、`docs/69`、ADR-0042 | Runtime snapshot/query client | hierarchy parent links、staleness、abort/dedupe/revision/multi-tab tests |
| R-145 | Artifact hash 不等于读取授权 | `docs/18`、`docs/40`、`docs/69` | Artifact Reference ACL | tenant/workflow/audience/classification/retention/legal hold/key rotation/GC tests |
| R-146 | 真实 Flash acceptance 不得由确定性门冒充 | `docs/57`、`docs/67`、`docs/69`、ADR-0042 | Provider sample/acceptance export | N=50、Wilson、零安全失败、offline verifier tests |
| R-147 | 本地和分布式 Production Plane 不得互相冒充 | `docs/42`、`docs/69`、ADR-0041 | provider descriptors/readiness | queue ordering、topology rejection、capacity/telemetry/signed backup tests |
