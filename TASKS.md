# dsh-military RC.2 完整修复任务

## 需求来源

- 用户要求以本地官方 DeepSeek Harness `dsh-v0.1.1-rc.2`
  (`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`) 为唯一插件开发基线。
- 2026-08-24 初始完整性审计确认：源码结构存在，但精确 RC.2
  类型检查、干净 Profile 安装、真实 Loader 激活、崩溃一致性、运行时恢复和
  release gate 均未通过。
- 2026-08-24 真实 `deepseek-v4-flash` Session
  `session-937d9c28-f123-421b-8e75-7bbc1216ff79` 暴露模型侧工具合同缺陷：
  34 个 Military 工具无角色剪枝、17 个结构参数退化为 `{}`、Brainstorm
  Mission 无法发现且重复启动冲突、Mission Snapshot 含 `Map` 导致 RC.2
  JSON 边界失败。用户要求修复后重新安装到本机 DSH Web Profile，并以新会话
  实测 Flash 的工具识别精度和工作流效果。
- 2026-08-24 后续真实 Session
  `session-cb4c670f-07b4-43f0-a551-0124aef46be6` 暴露宿主执行边界缺陷：
  Session `workspaceKey` 虽正确绑定到 `/Users/example/project`，Workspace、
  Specs 与 Git 却使用 Web 进程级 `repositoryRoot`，导致插件源码目录被错误
  `git init` 并留下未提交规格；路径拒绝被无条件预算结算覆盖成
  `unknown reservation`；Specs validation 合同要求模型猜部署白名单且失败写入
  不回滚；Workspace Snapshot ID 被误当 Artifact ID；General 绕过 ToolProfile
  获得全局 `bash` 并忙等；`maximumSteps`、no-progress 与用户中止没有收敛到
  实际 Agent/Task 状态。用户要求全部修复、审计通过后重装并重启本机 DSH。
- 2026-08-24 修复后真实 `deepseek-v4-flash` 外部验收 Session
  `session-573e3540-e5c1-43c6-8a27-81a339736ce2` 仍出现工具调用错误。该
  Session 是新的最高优先级失败证据；必须重建实际 request header、工具参数、
  宿主拒绝、重试与终止链路，修复此前确定性回归未覆盖的真实 Provider 差异，
  不得将上一轮离线 PASS 解释为 Flash 已通过外部验收。
- 2026-08-25 `0.9.0-alpha.4` 外部验收 Session
  `session-c21a6c55-3bab-4cab-bbb1-1af5394e7ff2` 仍报告工具调用错误，并暴露
  continuable 子 Agent 完成后父会话已停止、没有自动恢复检查结果，以及子
  Agent 文件写入异常。必须将附件作为不可信运行数据重建父子 Session、report
  delivery、turn stopping、ToolProfile、Workspace/Lease、写入、验证与最终
  状态时间线，同时审计同一链路中尚未被用户直接发现的确定性缺陷。
- 2026-08-25 清空旧 Military SQLite/Session 状态后的 `0.9.0-alpha.5`
  外部验收 Session `session-4844eb48-4ed9-4edc-a4de-1d5ecb14c6d3` 仍出现
  大量工具调用错误，尤其集中在工兵文件创建、读取、修改与提交链路。必须按
  真实 request header、模型参数、RC.2 文件工具行为、Military admission、
  Workspace scope、文件系统效果和父级报告逐步重放；同时将合同压缩到轻量模型
  能一次理解、一次纠正且不需要推测 Host 内部状态的规模。
- 2026-08-25 用户要求将 `deepseek-v4-flash` 等轻量模型从“可试用”提升为
  Military 的默认主力路径，Pro 等重量模型仅作为可选项；必须在不削弱完整
  Mission、部门协作、验证、提交和恢复能力的前提下，消除轻量模型仍需猜测
  Host 内部 ID、深层合同、阶段选择和终止语义的问题。同时需要在 DSH 设置
  弹窗中新增与“Agent 预设”同级的独立 Military 导航，以模型目录驱动的下拉框、
  开关、数字框和分组表单覆盖全部常用设置，特别是各部门模型与推理强度，不能
  再要求普通用户编辑配置文本。
- 2026-08-25 用户确认现有外部资料提炼不能停留在内存 Request、启发式句子
  截取和不可召回的 DRAFT；要求完整开发为 Host-owned、SQLite 持久化、真实
  脱敏和 Prompt Injection 隔离、Flash 分块提炼、来源证据绑定、用户可视化
  Diff 审批、DRAFT→Simulation→Canary→Testing→Stable 晋升、任务自动召回、
  使用效果记录、来源撤回和影响分析的私有技能供应链。模型不得伪造用户审批，
  Pro 只能作为显式高风险升级路径，最终应从统一 TacticalProcedure 权威模型
  提供受治理的 DSH Skill 编译视图。
- 用户提供 Claude Agent Skills 官方创建/编写指南作为外部参考：最终编译视图
  应生成顶层 `SKILL.md`（受约束的 `name`/`description`）、完整版本快照、
  一层引用的渐进式披露资源和可执行验证脚本；主文件保持精简，确定性操作优先
  脚本，真实评测覆盖轻量/均衡/重量模型。该参考只定义 Skill 包形态，不替代
  DSH RC.2 API、Military 来源权利、用户审批、租户隔离或生命周期治理。
- 2026-08-26 用户要求 Military 设置中心入口改为与“知识与技能”相邻的侧栏
  入口，点击后使用弹窗展示；弹窗左侧必须是七个指定的 Military 一级选项卡。
  “Military-部门模型”必须显示 General 和全部部门角色的插件自带简体中文
  提示词，允许编辑，并提供逐角色及一键全量恢复自带提示词。
- 2026-08-26 用户进一步要求 Military 设置中心和知识入口与 DSH 原生设置
  按钮使用完全一致的样式与点击域，避免多入口在展开或收起侧栏中扰乱排版。
- 2026-08-26 用户接受设置与运行治理的十五项深化方案并要求完整交付：
  角色目录/单角色编辑、有效提示词预览、Flash 就绪检查、角色工具模拟、
  提示词版本历史、能力驱动模型目录、成本预算可视化、Session 诊断时间线、
  安全恢复操作、Specs 工作区浏览、固定评测基准、事务化设置与冲突处理、
  简体中文辅助检查、知识透明与模拟召回、无障碍/i18n 浏览器硬化。全部能力
  必须保持七个既定一级选项卡、Host 权威边界和轻量模型优先策略，并同步维护
  文档工程、测试、安装与回滚说明。
- 本清单记录对上述初始缺陷的修复闭环；当前 `FINAL-GATE-REPORT.json`、
  `SEMANTIC-RELEASE-AUDIT.json` 与 `RELEASE-REPORT.json` 均为 PASS。

## 当前实现概况

- 13 个 package，包含 Bundle、Preset、Installer、WebUI、Host、Tools、
  Contracts、Core、Runtime、Infrastructure、SQLite、Testkit 与命令插件。
- 精确官方 checkout typecheck、本地 build、148 项测试和 747 项文档工程检查
  全部通过。
- 所有 DSH 依赖、兼容报告、Preset generation、Installer 和 release gate
  固定到同一个 RC.2 release/commit。
- Bundle 与 Installer 形成自包含 npm 闭包，并已从 tarball 安装到空 DSH Home。
- Host、Preset、Web Client 和全部 Loader entry 在真实 RC.2 Web Profile 激活。
- Mission command admission、领域操作、receipt 与 outbox 共享 SQLite UoW；
  幂等和关键运行态均可跨进程恢复。
- `0.9.0-alpha.5` 已包含三份真实 Session 暴露的模型侧工具合同、父子恢复、
  文件写入和宿主执行边界修复；P0.7—P0.18 与 P1.5—P1.7 的源码和确定性
  回归已闭环。
- `0.9.0-alpha.6` 后续审计发现：Engineer 成功事务没有真正结束 turn、RC.2
  在同一 assistant response 内仍会继续执行终止工具后的调用、General spawn
  缺少稳定幂等键、Task 草稿允许模型决定授权工具和无效路径、默认部门模板仍
  全部硬编码为 Pro、Worker 终态没有确定性父级 receipt、复杂 Military Schema
  与静态工具面仍超过轻量模型的可靠识别范围。上述问题进入本轮最高优先级修复。
- `0.9.0-alpha.7` 已将上述确定性缺陷闭环，并新增与 Agent 预设同级的
  Military 可视化设置中心；General 与 11 个部门默认使用 Flash，Pro 为显式
  可选路线。Task 的 step、tool、Radio、wall-clock 和 output 预算均已连接
  真实执行边界，大规格仍通过 Host staging/事务保留完整能力。
- 私有技能供应链已统一为 Host-owned SQLite 流程：Raw Vault、sanitize/
  injection gate、Flash 分块、Candidate、用户审批、版本晋升、真实 Task 召回、
  Usage、撤回、影响图和完整 Skill bundle 编译视图均可跨重启恢复；Knowledge
  Center 只展示脱敏 projection，模拟召回只持久化输入 hash 和字符数。

## P0：安装、启动和数据正确性阻断项

- [x] **P0.1 精确迁移到 DSH 0.1.1-rc.2**
  - 更新所有 package peer/dev dependency、版本报告、Preset generation、
    Installer、兼容探针和文档中的运行时基线。
  - 删除运行时代码中的废弃基线硬编码和伪造版本报告。
  - 将 exact checker 改为 RC.2，修复 `result.map(resolve)`，使用官方构建声明。
  - 精确 RC.2 typecheck 零诊断；本地 stub 不再作为发布证据。

- [x] **P0.2 修复 RC.2 Cordis Host/Preset 服务拓扑**
  - Host 不再强制等待 RC.2 Web 主机平面不存在的 `compaction`。
  - 可选服务通过 `ctx.get()` 读取；所有 `ctx.<service>` 都有对应 inject。
  - Agent Plane 在 Preset scope 正确注入 `compaction` 与 `tokenMeter`。
  - 改用 RC.2 `tokenMeter.measure(session).totalTokens`。
  - 增加真实 Loader composition test，确认所有 Bundle/Preset entry ACTIVE。

- [x] **P0.3 修复 RC.2 类型/API 合同**
  - 使用 branded `ReasoningEffortId`。
  - 修正 Schemastery default export。
  - 补齐 Context module augmentations 和 package 依赖。
  - 所有 Tool handler 返回合法、可序列化的 `JsonValue`。
  - Web Client 采用 RC.2 React/动态依赖/manifest 规则。

- [x] **P0.4 建立可安装的 npm 依赖闭包**
  - 选择并实现单一自包含 Bundle，或建立全部运行时 package 的可发布闭包。
  - `dsh plugin --profile <clean> add <artifact>` 不访问不存在的内部包。
  - Installer 与 Bundle 可以从 release 产物在空 DSH Home 中安装。
  - 标准 Profile 只添加 Bundle；Bundle 暴露内嵌 Installer 命令，不再重复添加
    plain dependency。Profile 与独立 Installer 均通过 `pnpm peers check`。

- [x] **P0.5 Mission Kernel 原子事务与持久化幂等**
  - command admission、领域变更、receipt 和 outbox/副作用记录共享原子提交点。
  - `(tenant, mission, idempotencyKey)` 持久化唯一，保存 payload hash 与 receipt。
  - operation 失败不留下不可恢复的 accepted-only 状态。
  - 重启后重复提交返回 durable duplicate receipt，且不重复副作用。
  - 故障注入和重启回归测试通过。

- [x] **P0.6 运行时恢复与关键状态持久化**
  - Task、candidate、verification 与 Mission projection 可从 SQLite/ledger 恢复。
  - Capability Grant、Policy、Template、Budget、Authorization、Radio、
    Decision Broker、Appeal、Compaction Attempt 等生产关键状态持久化或可证明
    从权威记录无损重建。
  - 插件重启后可继续未完成 Mission，不依赖旧进程 Map。

- [x] **P0.7 完整公开模型侧工具 Schema**
  - 所有会被运行时 canonical Schema 严格校验的输入都向模型公开真实结构，
    不再以无约束 `{}` 代替。
  - `military_task_create` 使用 Flash 可稳定生成的浅层模型合同；Mission、
    Direction、Wave、Task identity、版本和安全默认值由 Host 确定性编译。
  - 数组、枚举、嵌套对象和必填字段在 RC.2 request header 中完整可见。
  - Schema 校验失败一次返回完整、可操作的问题列表，不再逐字段猜测。

- [x] **P0.8 修复 Brainstorm Mission 生命周期与上下文发现**
  - `/brainstorm` 创建的 Mission 可以通过 `military_get_context` 读取其
    missionId、revision、状态和当前 Brainstorm Order。
  - `military_mission_start` 对已绑定 Session 幂等返回现有 Mission，不创建
    冲突 projection。
  - Brainstorm 模型提示明确现有 Mission 已建立以及后续正确工具顺序。

- [x] **P0.9 修复所有工具输出的 RC.2 JSON 边界**
  - `military_staff_read_mission` 将 `ReadonlyMap` 投影为稳定 JSON 数组或对象。
  - 每个 Military 工具的成功输出均通过 `snapshotJsonValue` round-trip 测试。
  - 正确 Mission ID 不再产生 `undefined canonical value`。

- [x] **P0.10 按角色收窄模型可见工具面**
  - 根 General 不再看到 Engineer、Inspector、Research 等不可调用工具。
  - Department Agent 只看到其不可变 ToolProfile 允许的 Military 和内置工具。
  - General 不会再选择 `military_specs_read` 等执行端必然拒绝的工具。

- [x] **P0.11 统一 Session Workspace、Specs 与 Git 路由**
  - 所有项目文件、Workspace Snapshot、Specs 读写和本地 Git 操作以当前
    Military Session 的不可变 `workspaceKey` 为权威根，不使用 Web 进程 cwd。
  - 多 Session/多工作区并存时互不串写；任务创建不得在插件源码目录隐式
    `git init`。
  - Specs 工具从调用 Agent 的 Session binding 解析工作区；错误或缺失绑定
    必须 fail closed 并返回可操作错误。

- [x] **P0.12 修复工具拒绝、预算结算和 General ToolProfile 边界**
  - Pre-execute 未建立 reservation 的 deny/block 调用不得进入 settlement；
    原始路径/权限拒绝原因不得被 `unknown reservation` 覆盖。
  - General 与 Department Agent 一样执行不可变 ToolProfile；默认 General
    看不到或不能执行 `bash`、任意文件工具等 Profile 外工具。
  - 被拒绝调用仍可记录宿主观察 evidence，但不会消耗 Capability Grant 或预算。

- [x] **P0.13 Specs 模型合同与事务原子性**
  - deployment-owned validation 不再要求模型猜自由字符串；由 Host 注入或
    通过精确枚举公开。
  - 所有 order、scope、validation 和 commit 前置条件在第一次真实写入前完成。
  - validation/commit/abort 任一步失败时，工作区文件、index 和 HEAD 恢复到
    调用前状态；不留下部分写入。

- [x] **P0.14 执行预算、无进展与用户中止强制收敛**
  - `ExecutionStrategy.maximumSteps`、Task `modelSteps` 和
    `maximumNoProgressTurns` 接入 RC.2 Agent 模型循环的真实停止边界。
  - General 不使用 shell sleep 轮询子 Agent；等待通过 continuable subagent/
    job 或 Military 状态机制。
  - 用户中止根/子 Session 后，关联 Task/Agent 状态确定性收敛为
    `CANCELLED`/`ABORTED`，并释放未结预算、租约和并发占位。

- [x] **P0.15 修复 573e3540 真实 Flash 工具调用失败**
  - 将附件作为不可信运行数据解析，按时间线还原模型可见工具 Schema、每次
    tool call 参数、RC.2 adapter 归一化结果、Military admission/handler
    返回、模型重试和最终停止原因：16 个公开工具、5 次调用、3 次错误，全部
    错误均为请求头外的 `bash`/`glob`；Session JSONL 171 行、归档 SHA-256
    `77317ad998fa821b24943c60b81b7bf5e525405f3b220b38704cd06a948f75a7`。
  - 区分模型生成错误、公开 Schema/描述缺陷、工具名或参数序列化差异、RC.2
    生命周期适配错误和 Host 侧错误恢复缺陷；确定根因为隐藏 Schema 后仍残留
    正向工具提示、Brainstorm 发现路由矛盾、拒绝缺少角色恢复路径，以及
    `military_status` 重复返回 33 个历史模板修订；已建立脱敏 fixture。
  - 修复后运行 Flash 合同、Session 回放、exact RC.2 typecheck、完整测试与
    release gate；`0.9.0-alpha.4` 已完成本地 Profile 重装和启动核验。

- [x] **P0.16 完整取证 c21a6c55 父子 Session**
  - 安全解析附件，记录归档哈希、文件清单、父子 Agent/Session identity、
    request header、模型输出、工具参数、Host 结果、report delivery、
    stop/abort、Workspace 与文件系统变化。
  - 区分模型错误、公开合同错误、RC.2 continuable/report 语义错误、Military
    生命周期错误、租约/路径错误和状态投影错误；每个确定性失败进入脱敏 fixture。
  - 归档 SHA-256 为
    `f9695113696be49d0345f0f4df9a912594add69e22697a8bd2bd8f990032a617`；
    5 份 JSONL 全部有效，共 71 次工具调用、14 次错误。已证明 Specs commit
    `6caf5b0` 成功后才发生 `STEP_BUDGET_EXHAUSTED:9>8`，旧父会话结论错误。

- [x] **P0.17 子 Agent 完成后确定性恢复父 General**
  - 父 General 为等待 continuable 子 Agent 而结束当前 turn 时，子 Agent 的
    关键完成/失败报告必须通过 RC.2 支持的 delivery 触发下一步，而不是永久
    停在无消费者状态。
  - 显式用户取消仍为终态，不能被迟到子报告重新唤醒；重复/乱序报告必须幂等，
    并在父恢复后确定性检查子结果、Task 与 evidence。
  - 所有部门 profile 修订为 4 并允许 scoped `report`；普通/关键报告均映射
    `next-step`。纯用户取消 settlement wake 在 `agent/pre-step` 前消费，不发
    模型请求；同批真实用户输入或有效报告不受影响。

- [x] **P0.18 修复子 Agent 文件写入与 Workspace 执行链**
  - 从真实请求还原文件工具 Schema、execution cwd、Workspace lease、路径
    canonicalization、Capability Grant、实际文件效果与返回值。
  - Worker/Engineer 只能在绑定工作区执行允许的写入；合法写入成功并产生宿主
    evidence，非法路径一次返回可操作错误，任何失败不得留下部分文件或错误状态。
  - 本地 main cwd 与 execution root 相同时接受 RC.2 可选/相对路径；隔离
    worktree 继续要求绝对路径。Specs 改为 Host 编译浅层 draft，Git 展开所有
    untracked 文件，commit receipt 写入 Mission Ledger 并自动报告父 General。

- [x] **P0.19 审计同链路潜在失败并发布修复版**
  - 覆盖父子完成/失败/取消竞态、迟到报告、重复交付、子 Agent 无工具或错误工具、
    写入后验证、Task/lease/budget 收敛、重启恢复和新 Session 请求合同。
  - 完整测试、精确 RC.2 类型检查、repair/semantic/review/docs/release gate
    全部通过后，使用新版本重装本机 Profile、重启并验证 HTTP 与实际安装内容。
  - `0.9.0-alpha.5` 已通过 95 项测试、740 项文档检查、完整
    `release:verify` 与三启动 RC.2 E2E；同一发布包已安装到本机 Web Profile，
    Installer receipt、Preset generation、peer closure、HTTP 200 与运行进程均已核验。

- [x] **P0.20 完整取证 4844eb48 新 Session**
  - 安全解析附件并固化归档哈希、父子 Session 拓扑、实际模型路由、每轮可见
    Tool Schema、模型原始参数、Host 归一化/拒绝、文件系统效果、Git 状态、
    report/settlement 与最终 Task/Agent 状态。
  - 每个失败必须分类为模型参数错误、公开工具合同错误、RC.2 文件工具语义、
    Military admission/path/scope、Specs/Git 事务或父子生命周期错误，并进入
    脱敏 fixture；不得只按错误文本打补丁。
  - 已安全验证 6 个 JSONL、12,293 行、73 次调用与 10 次真实错误并固化
    `4844-session-regression.json`。该归档全部实际使用 `deepseek-v4-pro/high`
    （不是 Flash）；首个子请求提示竞态、3 次越界搜索、目录读取、固定 11
    文件骨架、`.DS_Store` 阻塞及 3 次 Engineer 重工均已定位。

- [x] **P0.21 贯通工兵文件创建、读取、修改、验证与提交**
  - 工兵获得完成 Task 所需且仅限 Workspace/Task scope 的文件工具；省略路径、
    相对路径、绝对路径、已有文件与新文件的规则与 RC.2 实际 Schema 一致。
  - 将读、写、edit、Specs apply、Git diff/commit、receipt/report 组合成一条
    确定性状态机；失败必须原子回滚并给出一个可执行恢复动作，成功不得被后续
    step、budget、lease 或 report 误判为失败。
  - Engineer 现以 `military_specs_apply_order` 作为唯一创建/替换/验证/本地
    提交/ledger/report 事务；目录读取递归、缺失目录为空状态、单文档无需固定
    骨架。Worker 的真实 RC.2 `write`+`edit` 已在隔离 worktree E2E 通过。

- [x] **P0.22 为轻量模型重构工具选择与参数合同**
  - 每个角色只看到当前阶段必要工具；描述中给出互斥选择、最小必填参数、路径
    来源和成功后的唯一下一步，不暴露 Session/binding/内部 authority 等诱导字段。
  - Host 尽可能接管 identity、revision、scope、validation、commit 与 receipt；
    模型错误一次返回短小、稳定、无冲突的 machine-readable correction。
  - 新增 Flash/轻量模型静态合同预算、首调用参数、一次纠错、文件 edit 和完整
    Engineer 纵向回归，防止靠 Pro 模型推理能力掩盖合同缺陷。
  - RC.2 `registerContinuableSetup` 现于子 Agent 发布前同步安装提示/Schema
    对齐；Engineer 首请求固定为 9 个工具，Worker 为最多 14 个，并按 Task
    `allowedTools` 进一步约束模型面与 Capability Grant。真实 RC.2 首请求
    捕获已证明 Engineer 不再收到 write/edit/bash/jobs 幽灵指导。

- [x] **P0.23 全链路审计、发布、清空状态重装与重启**
  - 覆盖新建/已有文件、无 Git/脏 Git、相对/绝对路径、重复调用、取消、重启、
    迟到报告和父恢复；精确 RC.2 typecheck、完整测试、repair、semantic、
    review、docs 与 release gate 全部通过。
  - 生成下一版可重复 tarball，安装到本机 Web Profile，清空本次失败产生的
    Military 运行状态，重启 DSH 并验证新 SQLite 无旧 Mission/Task、HTTP 200、
    Loader/Preset/browser entry 与实际安装版本。
  - `0.9.0-alpha.6` 已通过 101 项测试、740 项文档检查、精确 RC.2 typecheck、
    semantic/review/release 全门与三启动纵向 E2E；两份 tarball 可重复。
    本机 Profile 及全部内嵌包均为 `alpha.6`，新 SQLite 的 Mission、Task、
    Agent binding 与 event 均为 0；UI 实测只新建 1 条当前空会话绑定。Web
    HTTP 200 且 Military browser entry 已激活，旧运行状态已移至可恢复的
    macOS 废纸篓备份。

- [x] **P0.24 统一终止事务、同轮闩锁、父级 receipt 与派遣幂等**
  - Candidate、Specs apply、Blocker、Radio/Questions 终态必须以同一 Host
    事务持久化结果、投递父级 receipt 并调用 `concludeTurn()`；Specs 成功不再
    被 completion interlock 误判为缺少终止工具。
  - 在 RC.2 同一 assistant response 中，第一个成功终止动作之后的所有后续
    Military 调用都由单调闩锁拒绝为 `TURN_ALREADY_CONCLUDED`，新 step 才清除。
  - General 派遣使用 Host 编译的稳定 idempotency key；重试不得创建第二个
    binding、grant、worktree 或 child Session，失败不得留下半成品绑定。

- [x] **P0.25 建立 Host 编译的 Task 与浅层工具合同**
  - 模型只提交任务意图、目标和工作区相对路径；Host 规范化 scope、按角色派生
    `allowedTools`、终止工具、label、identity、revision、时间戳和幂等字段。
  - 在 Task 注册前拒绝绝对路径、`..`、空写范围、角色/任务类型不匹配和缺少
    成功终止能力；无效草稿可以一次纠正，不污染不可变 Task key。
  - Candidate、Tactical、Guidance、Decision 与 observation 工具改为浅层
    模型输入、Host 编译完整 canonical artifact，降低必填字段数和嵌套深度。

- [x] **P0.26 使轻量模型成为默认且受治理的部门执行路径**
  - 默认 General、Worker、Engineer、Staff 和特殊部门模板使用可配置的轻量
    模型；Pro/重量模型保留为显式下拉选项和失败升级路径，不删除任何能力。
  - 路由同时尊重 provider、model、reasoning effort 与模板状态；CANARY 可在
    有限预算下显式运行，ACTIVE 自动路由仍要求满足 capability gate。
  - `military_status` 显示实际部门模型/推理强度/状态；Session 选模不得被
    `minimumReasoning` 静默覆盖，模型别名和选中值必须可审计。

- [x] **P0.27 阶段化工具面、紧凑上下文与确定性纠错**
  - 每次请求只暴露当前角色和阶段可执行的最小工具集合；进入 finalization 后
    不再向模型展示会被 Host 拒绝的操作工具，但后续合法阶段仍保留完整能力。
  - 子 Agent 上下文和恢复工具移除 binding/grant/reservation 等内部 ID，
    `get_order`、blocker 和 observation 的 Task/version 全由 Host 推导。
  - Schema 错误只返回首批可执行修正；相同无效调用重复出现时强制进入单一恢复
    动作，避免轻量模型在无进展循环中消耗预算。

- [x] **P0.28 新增独立 Military 可视化设置中心**
  - 在 DSH 主侧栏注册与“知识与技能”相邻的 Military 设置入口，点击打开原生
    Modal，不把 Military 塞在 Agent Presets 页面或要求用户编辑 JSON/YAML。
  - 左侧按“Military-部门模型、Military-执行与成本、Military-Specs 工作区、
    Military-安全与恢复、Military-战术与标签、Military-绩效评估、
    Military-显示与进阶”提供七个固定一级选项卡。
  - 覆盖 Host 暴露的全部用户可配置项，支持保存、外部变化同步、恢复默认值和
    不丢失未知未来字段；各部门可独立选 provider/model/reasoning。

- [x] **P0.29 统一并持久化私有技能供应链状态机**
  - 删除生产/测试两套 Ingestion 行为漂移，以一个 Host-owned pipeline 处理
    Source、Snapshot、Job、Chunk、Candidate、Review、Procedure Version、
    Promotion、Usage、Lineage 和 Revocation。
  - 所有状态和幂等索引写入 SQLite；状态迁移与 outbox/receipt 原子提交，
    DSH 在 SNAPSHOTTING、EXTRACTING、PENDING_REVIEW、PROMOTING 任意阶段
    崩溃后均能从最后 durable state 恢复。

- [x] **P0.30 建立轻量模型可用的来源导入与提炼合同**
  - UI/Host 先创建 `sourceHandle`；General 只提交 sourceHandle、目标、可选
    标签提示和目标 Skill，Host 派生用户、授权、分类、时间、ID、Hash、预算和
    幂等键，不再暴露 canonical 深层 Request。
  - 提供当前 Job 状态和修订请求的浅层工具；一个状态响应只给出当前状态、
    候选摘要和唯一 nextAction，Flash 不猜 Candidate/hash/内部状态。

- [x] **P0.31 实现真实 sanitize、分块 Flash 提炼与证据聚合**
  - Raw Vault 与 Sanitized Artifact 分离；在任何模型调用前完成 Secret/PII
    清洗和 Prompt Injection PASS/WARN/FAIL 隔离，未授权 confidential/
    restricted 内容不得路由到外部模型。
  - Host 生成稳定 chunk/hash/范围；Flash 以浅层 Claim 合同分块提取，Host
    去重、合并证据、计算置信度、检测版本/冲突并编译完整 TacticalProcedure；
    离线确定性 extractor 只作为显式 fallback，不冒充语义提炼。

- [x] **P0.32 实现真实用户审批、生命周期晋升与任务自动召回**
  - General 只能建议/请求修订，不能调用批准工具伪造用户；用户审批记录身份、
    Candidate hash、Diff hash、scope 和 immutable receipt，并与 DRAFT 发布
    原子提交。
  - 实现 DRAFT→SIMULATION→CANARY→TESTING→STABLE、暂停、回滚、隔离和
    exact-version 召回；Host 从 Task/Workspace/依赖自动派生检索条件，只向
    Flash 投放少量适用性卡片，DRAFT 永不进入生产 Task。
  - Stable/允许版本编译为完整版本快照：顶层 `SKILL.md` 仅含有效
    `name`/`description` 和精简工作流，扩展内容使用距主文件一层的
    `references/`、`examples/`、`scripts/`；校验名称、描述、500 行预算、
    正斜杠路径、引用闭包和脚本可执行性。

- [x] **P0.33 新增 Military“知识与技能”操作中心**
  - 在 Military 产品 UI 中提供来源资料、提炼任务、待审候选、私有技能库、
    模拟召回、版本与晋升、撤回与影响七个视图；设置页只保留模型、预算、
    可见范围、数据保留、Canary 和召回策略。
  - 支持粘贴文本、历史/当前 Session 和 Artifact 导入；Candidate 显示来源、
    扫描、Claim Evidence、现有 Skill Diff、风险和验证计划，并可编辑后批准、
    退回或拒绝，全程无需编辑 JSON。

- [x] **P0.34 建立角色目录与单角色编辑器**
  - “部门模型”改为可搜索、按职责分组和按状态过滤的角色目录；一次只挂载一个
    模型/推理/预算/提示词编辑器，12 个角色仍可无损配置。
  - 角色切换、关闭弹窗和切换一级选项卡时保护未保存草稿，并提供明确的保存、
    放弃和恢复默认入口；键盘及 IME 操作不误触。
  - 列表显示模型、验证状态、草稿和就绪摘要，不依赖用户展开专业配置文本。

- [x] **P0.35 提供 Host 编译的“有效提示词”预览**
  - 只读展示用户可编辑的角色提示词与不可变的 Host、工具、Workspace、
    Evidence、终止和运行时约束分层结果，不允许前端伪造执行提示词。
  - 提供当前草稿与已保存/插件默认版本的逐层 Diff、token 与中文字符估算，
    并清楚标识不可编辑边界和最终进入模型的顺序。
  - 预览由实际 Prompt Assembly 使用的同一编译器生成并具备契约回归。

- [x] **P0.36 建立确定性的 Flash 就绪检查**
  - 检查工具是否可用、Host 字段/ID 泄漏、路径猜测、含糊或多个终止动作、
    缺少停止规则、长度预算、权限暗示和复杂 Schema 等轻量模型风险。
  - 每条问题给出稳定代码、严重级别、定位、简体中文解释和可执行修正建议；
    检查完全离线、可重复且不调用付费模型。
  - 保存和派遣链路记录就绪报告；严重问题阻断生产启用但不扩大权限或静默切换
    Pro，默认提示词必须达到通过状态。

- [x] **P0.37 实现角色工具模拟与显式在线 Canary**
  - 一键离线预检使用实际角色、工具面和 Schema，确定性模拟发现、一次调用、
    错误纠正、终止与父级回执，不消耗模型额度。
  - 在线 Canary 只能由用户明确点击，先显示 provider/model、只读/安全范围、
    token 上限与费用估算；不会自动晋升、自动 fallback 或写入工作区。
  - 结果保留原始选择、Host 归一化、Schema 结果、终止行为、tokens、费用与
    延迟，并可关联模型能力状态和评测样本。

- [x] **P0.38 实现事务化设置、冲突处理与安全导入导出**
  - 模型、推理、预算和提示词共享一个带 revision 的草稿；保存前显示语义
    Diff，Host 一次性校验并原子写入，失败不产生部分状态且支持撤销。
  - 检测多标签页和外部设置 revision 冲突，提供基于字段的 rebase、采用外部
    版本或保留草稿，不以最后写入静默覆盖。
  - 导出/导入只包含可移植配置；预览并校验版本后才提交，排除凭据、绝对路径、
    receipt 和运行数据。

- [x] **P0.39 建立 Session 诊断时间线**
  - 按单一时间线展示角色/模板/模型、可见工具、原始工具选择、Schema 校验、
    Host 字段补全、Grant、路径判定、receipt、终止及父级唤醒。
  - 汇总错误、自动纠正、tokens、费用和延迟，可按角色、任务、工具、严重度
    过滤，并对敏感字段执行 Host 端脱敏。
  - 诊断读取权威事件和 receipt，不允许 UI 推断成功、补写完成状态或修改历史。
  - 新增 `militaryOperations` Host RPC，将 live/cold RC.2 Session 事件与
    observed receipt 投影为单一时间线；支持角色、Task、工具、严重度和阶段
    过滤，模型原始参数在 Host 端执行凭据/绝对路径脱敏与长度限制。

- [x] **P0.40 将安全与恢复页接入真实受治理操作**
  - 可视化 SQLite/WAL、备份、Preset/插件版本、活动 Mission/Task/子代理、
    孤儿 worktree、receipt、Grant 和 outbox 健康状态。
  - 提供唤醒、重新投递、reconcile、释放已证明过期资源、备份、验证及恢复
    预览等幂等 Host 操作；高风险动作需要作用域确认和审计 receipt。
  - 禁止原始 SQLite 编辑、手工标记完成和无法证明安全的删除；重启及失败注入
    回归验证数据一致性。
  - 健康面板已读取 SQLite/WAL、受治理备份、Preset、Mission/Task、live child、
    worktree/lease、receipt、Grant 与 outbox；验证、VACUUM INTO 备份、
    reconciliation、过期 claim/资源释放和父级唤醒均先预览并要求精确确认短语，
    结果以 operationId 幂等 receipt 跨 Host 重启恢复。

## P1：安全、治理和真实产品行为

- [x] **P1.1 路径授权先于 Capability Grant 消耗**
  - 参数解析、路径 canonicalization、worktree/scope/deny 检查完成后才允许
    reservation/consume。
  - 拒绝路径不会消耗 Grant；并发执行具备明确 settlement/rollback。

- [x] **P1.2 修复剩余语义发布门**
  - Git integration order/receipt 持久化并在启动时 reconciliation。
  - Verification 解析实际观察到的权威 evidence/receipt。
  - Runtime 与 ledgers 使用单一 Task reducer。
  - Authority、Budget reservation/settlement 接入所有执行入口。
  - Canonical schema 在 handler 前执行运行时验证。
  - 特殊部门自动化被实际组合。
  - Inspector 使用明确的 session/agent identity。
  - Model、Tool、Mission command、Agent spawn、Radio 与 Rework 均执行
    Authority/预算 admission；Model 与 Tool 使用宿主观察值结算，崩溃后可从
    RC.2 Session 事件补结算。
  - 特殊部门采用 SQLite outbox、租约恢复和确定性 child dispatch key；同一
    source event 在重启与重试中不会重复提交已接受的 RC.2 初始 prompt。

- [x] **P1.3 WebUI RC.2 反应性与 HMR 生命周期**
  - 使用 RC.2 注入 store 和 `useSyncExternalStore` 的稳定 snapshot。
  - 外部 Settings 变化会同步到所有编辑表单。
  - 注册项在 fiber dispose/HMR 后被移除。
  - 真实 browser bundle build 与组件行为测试通过。

- [x] **P1.4 建立真实端到端测试**
  - Loader 从测试 `cordis.yml` 启动真实 RC.2 Profile。
  - 选择 `military` Preset，启动 Session，运行至少一个 Tool、一个 continuable
    subagent、一次 Settings 修改和一次 Web Client 注册。
  - 覆盖 Mission → Task → Worker → Verification → Integration。
  - 覆盖关闭、重启、恢复、重复 command 和失败注入。

- [x] **P1.5 建立 Flash 工具识别与真实会话回归门**
  - 将故障 Session 的调用链脱敏固化为 regression fixture。
  - 覆盖 `/brainstorm → context → Task → Engineer specs handoff`，不出现
    Schema 猜测、角色拒绝、Mission 冲突或 JSON 序列化错误。
  - 失败基线已写入实际 benchmark；修复后的真实 Provider 样本尚未由用户
    运行，因此 Flash profile 保持 `CANARY` 并关闭自动 fallback，不虚假标记
    `VALIDATED`。内置模板显式允许该 Canary 作为本轮外部验收主力。
  - request header 中 Military 工具数、Schema 深度和必填信息满足轻量模型
    可识别性约束。

- [x] **P1.6 建立 Snapshot 引用与错误恢复合同**
  - `environmentSnapshotRef` 使用可区分的 Workspace Snapshot 类型，并提供
    明确读取/解析工具，或只向模型公开可直接读取的 Artifact refs。
  - Flash/Pro 在收到路径、权限、策略和状态错误时得到稳定、短小、可操作的
    machine-readable 错误，不需要读取插件源码猜内部实现。
  - 新回归重放 `cb4c670f` 的七类失败，确认除明确模型路径错误外均在 Host
    边界被预防或一次纠正。

- [x] **P1.7 清理错误运行副作用并保护插件源码**
  - 可恢复地移除本次错误创建的顶层 `.git` 和未提交
    `specs/apache-helicopter.md`，保留审计备份与校验和。
  - 增加保护测试，任何 Session 工作区不是插件源码根时，插件源码树的
    Git 状态和文件摘要在 Mission 前后保持不变。

- [x] **P1.8 落实轻量模型预算、超大规格分段与死字段治理**
  - 为轻量模板设置行为上可执行的 context/output/step/no-progress 预算；
    大规格写入采用 Host 分段/事务策略，不能靠降低上限破坏完整能力。
  - 实际落实或删除 `ToolProfile.maxParallelCalls`、`timeoutOverrides` 等死字段，
    并以并发、超时、重启和迟到结果回归证明语义。

- [ ] **P1.9 扩展 Flash 根会话与子部门评测**
  - 评测覆盖 General 根会话以及 Worker/Engineer/Staff 子部门的首调用、一次
    纠错、文件写改、终止、父恢复和结果整合。
  - 分离确定性合同门与真实 Provider 外部验收；记录实际 provider/model/alias、
    reasoning、工具面摘要和响应观察值，不能用 N=1 或可变别名冒充稳定验证。

- [x] **P1.10 完成私有技能权利、撤回和效果闭环**
  - 实际落实 owner/license/allowed-use/audience/derivative/retention/
    dependency/temporal policy；UNKNOWN 权利只能生成 user-private DRAFT。
  - 建立 Source→Candidate→Version→Guidance/Task→Usage/Result 派生图；撤回
    后禁止新召回、隔离受影响版本并生成可审计影响报告。
  - 每次技能使用记录 exact version、匹配原因、模型、工具证据、Verifier、
    返工/回滚、tokens、成本和结果，驱动晋升、降级和重新验证。

- [x] **P1.11 建立提示词版本历史与可审计回滚**
  - 每次保存生成不可变 revision，记录时间、角色、模型/推理/预算、变更 Diff、
    作者来源和 Flash 就绪摘要。
  - 关联使用它的 Session、评测和 tokens/费用/成功率等指标；旧记录继续可读，
    不因当前设置变化被重写。
  - 回滚创建新的 revision 而非覆盖历史，并经过同样的预览、检查、冲突处理和
    原子保存流程。
  - 每次模型请求通过 Session anchor 固定到绑定时生效的角色 revision；多标签
    设置变化不会漂移 live Session。历史保存完整就绪报告，并按 exact
    turn/step 汇总 Session、token、工具 receipt、模拟与评测引用。

- [x] **P1.12 建立能力驱动的模型目录**
  - Host 汇聚 DSH 当前模型目录与 Military 验证记录，状态统一为
    `VALIDATED/CANARY/UNVERIFIED/INCOMPATIBLE/UNAVAILABLE/DEPRECATED`，
    前端不再维护重复 allowlist。
  - 目录展示工具调用、Schema、上下文、推理、价格和可用性证据；别名与 exact
    provider/model 可追溯，状态变更具备审计记录。
  - 不可用/不兼容模型不能误选，轻量模型保持主力路径；重量模型仅为用户显式
    选择的升级选项。
  - 前端模型下拉完全读取 DSH live provider catalog 与 Military capability；
    Host 在保存/导入时再次校验 exact route、reasoning、context/output 上限。
    模型状态及理由以递增 revision 持久审计，未知价格和空 alias 明确显示而不
    伪造 allowlist、价格或验证结论。

- [x] **P1.13 完善成本与预算的可理解交互**
  - 同时显示 token、估算简体中文字符、预计/实际费用与币种/价格时间戳，明确
    区分估算和 Host 观察值。
  - 提供经济、标准、深度和自定义预设，并按角色解释上下文、输出、step 与
    no-progress 预算的实际影响。
  - 预算预设不得改变工具权限、验证强度、证据要求、终止规则或安全边界。
  - 角色编辑器提供经济/标准/深度/自定义预设，显示有效提示词与 Task 的 token/
    简体中文字符估算、实际历史 token/工具指标及可用时的 USD 估算；Provider
    未提供价格时显式标为不可用，General 并发和既有执行护栏保持不变。

- [x] **P1.14 完善 Specs 工作区可视化**
  - 使用 RC.2 可用的原生目录选择 seam；若宿主无该能力，则使用 Host 验证的
    安全路径目录，不允许浏览器任意提交绝对路径。
  - 展示权威根目录、允许/排除树、Git HEAD、dirty/untracked、worktree、
    Candidate、integration 和最近 receipt，并提供实际角色路径示例。
  - 路径状态来自 canonicalization/Git/receipt 同一执行链，错误可一次纠正且
    不污染插件源码或其他 Session。

- [x] **P1.15 建立固定数据集的完整评测工作台**
  - 覆盖只读分析、创建/编辑/多文件、Specs、Schema 纠错、父级唤醒、路径拒绝、
    重复终止和重启恢复，并延伸现有 P1.9 的根会话/子部门真实评测。
  - 固定 dataset hash、插件/Preset、exact model、提示词 revision、工具 profile、
    reasoning 与预算；确定性门和付费 Provider 样本分开呈现。
  - 指标至少包括首调用命中、Schema 成功、纠错、完成、返工、费用、延迟、
    唤醒和写入正确性，不以 N=1 冒充稳定验证。

- [x] **P1.16 增加简体中文提示词辅助检查**
  - 仅检查自然语言片段，跳过 fenced/inline code、路径、工具名、标识符和变量，
    定位疑似繁体字并给出可确认的简体建议。
  - 转换必须由用户确认并保持格式、代码和不可变层；提供逐项应用、全部确认项
    应用和撤销，不做静默全文替换。
  - 默认 12 角色提示词和文档通过 lint，保存 revision 记录用户确认结果。

- [x] **P1.17 增强知识透明度与模拟召回**
  - 展示来源、sanitized snapshot、chunks、Candidate/版本 Diff、审批者、
    生命周期、标签、使用效果、继承谱系及撤回影响。
  - 输入任务文本即可在不启动 Task 的前提下模拟哪些 exact Skill 会被召回、
    匹配原因、排序、投放片段和排除原因。
  - 模拟与真实 Host recall 使用同一规则，执行权限、租户隔离、版本状态和
    token 预算保持不变。

## P2：包合同、可维护性、文档与发行

- [x] **P2.1 为每个发布 package 增加 `./invariant`**
  - 每个 invariant 注册 manifest name，并验证真实事件/数据关系或给出明确
    `No runtime invariant:` 原因。

- [x] **P2.2 降低高复杂度模块**
  - 将 `plugin-host/src/agent-plane.ts` 按请求路由、工具授权、压缩、
    completion interlock 和事件审计拆分。
  - 对拆分前后行为增加回归测试。

- [x] **P2.3 建立可重复发行**
  - 提交可信 lockfile，`pnpm install --frozen-lockfile` 通过。
  - 生成 release tarball、`checksums.sha256`、RC.2 `INSTALL.md` 和版本报告。
  - `release:verify` 默认运行 exact RC.2 typecheck、真实 composition、
    clean-profile install、重启恢复、semantic audit 和 pack/publint。
  - 删除或重新生成所有废弃基线报告与过期构建产物。

- [x] **P2.4 同步 RC.2 文档**
  - README、架构、安装、升级、回滚、Preset 信任模型、兼容矩阵和所有报告与
    最终代码一致。
  - 文档验证核对精确 release/commit、兼容矩阵、源码指纹和行为合同。

- [x] **P2.5 完成轻量优先版审计、发行、重装与可视化验收**
  - 精确 RC.2 typecheck、build、全量测试、Flash 合同预算、Web 组件测试、
    semantic/review/docs/release 和三启动 E2E 全部通过。
  - 生成可重复的新版本 tarball，安装到本机 Web Profile，重启 DSH；通过真实
    Settings UI 验证独立导航、部门模型下拉、保存/重载和 Military browser entry。

- [x] **P2.6 完成私有技能供应链纵向审计、发行与本机验收**
  - 覆盖长文分块、Secret/Injection、轻量首调用、审批身份、并发幂等、每阶段
    重启、晋升、召回、效果、撤回和 DSH Skill 编译视图的确定性与 UI E2E。
  - 精确 RC.2 typecheck/build/test/docs/semantic/review/pack、三启动和可重复发行
    全部通过后，重装本机 Profile、重启 Web，并用真实 UI 完成导入→审批→晋升
    →任务召回→撤回验收；真实 Provider Flash 仍单列为外部 Canary 证据。

- [x] **P2.7 统一 Military 与 DSH Web 原生组件系统**
  - Settings Center 与 Knowledge Center 复用 RC.2 `Button`、`Pill`、
    `StateDot`、`Modal` 和图标 primitive；Bundle 显式声明同一 client graph。
  - select/textarea/checkbox 薄适配遵循内置 32px field、card、navigation、
    focus、responsive 和 reduced-motion 合同。
  - 所有颜色由 Host `--dsw-*` alias 驱动，不保留 Military 独立主题、旧
    `--bc-*` token、硬编码 mask/shadow 或失效 danger/warning alias。
  - 静态与真实浏览器同时验证明暗主题、设置导航、知识中心对话框和零 Loader
    错误；发布为不可变 `0.9.0-alpha.13` 并升级本机 RC.2 Profile。

- [x] **P2.8 独立设置弹窗与全角色简体中文提示词**
  - 将 Military 设置从 `settings.section` 迁移到与“知识与技能”相邻的
    `sidebar.footer.action`，由 `shell.overlay` 展示原生 Headless Modal。
  - General 和全部 11 个部门角色显示插件自带的简体中文提示词，支持显式保存、
    逐角色恢复和一键恢复全部角色；旧模板缺字段时无损回落到自带版本。
  - General override 走 live Settings；部门 override 创建下一 immutable
    template revision，并真实进入子 Agent persona，不做只保存不执行的假 UI。
  - Prompt Assembly 在可编辑正文之后强制追加不可编辑的工具、workspace、
    binding/grant、证据和终态边界，保证提示词编辑不削弱插件能力与安全合同。
  - 补齐简体中文、长度/变量校验、legacy fallback、Host 边界、UI 编辑恢复、
    RC.2 首请求与七选项卡回归；发布并升级本机 Profile 后做真实浏览器验收。

- [x] **P2.9 统一侧栏入口与 DSH Settings 点击域**
  - 将设置与知识两个按钮放入同一个纵向 `sidebar.footer.action` occupant，
    避免 RC.2 横向 list slot 在收起态把第一个按钮挤出 56px 侧栏。
  - 两个按钮逐项匹配内置 `SettingsRoot`：展开态 42px 完整行点击域，收起态
    36px 居中圆形点击域，并复用相同 margin、padding、radius、hover、label
    overflow、16/18px primitive 图标和 dialog accessibility 状态；安装后
    computed-style 对照补齐原生 `overflow: hidden`，以不可变 `alpha.16`
    收敛。
  - 通过组件回归和安装后的真实浏览器 computed-style/rectangle 对照，同时
    验证两扇独立弹窗仍可访问且侧栏不产生横向溢出。

- [x] **P2.10 完成无障碍、i18n、浏览器硬化与文档发行**
  - 七个一级选项卡、角色目录、弹窗和动态状态具备键盘导航、焦点捕获/返回、
    screen reader announcement、可见 focus 与正确的 ARIA 语义。
  - 验证 200% zoom、大字体、高对比度、中英文标签/长 model ID overflow、
    简体中文 IME 和快捷键，不破坏 DSH RC.2 原生布局。
  - 同步架构、设置、运行手册、故障诊断、评测、安全恢复、API/Schema、
    安装/升级/回滚和版本文档；完成 docs gate、真实浏览器矩阵和 release 门。

## 绩效评估 v2：十五项生产可信度与 Flash 决策闭环

- [x] **P0.41 建立唯一冻结评估数据集和同源 dataset hash**
  - `PerformanceEvaluationRequest` 必须完整进入 Dataset Builder；时间、模板、
    部门、Workspace、Mission、未完成会话和 actual preset 筛选不可丢失。
  - Manifest、Attempt Dataset、指标引擎和最终报告必须引用同一个 canonical
    dataset artifact/hash；禁止再由独立扫描器分别计算不相干的哈希。
  - 相同请求和相同权威事件重跑必须得到相同数据集内容和确定性指标。

- [x] **P0.42 统一评估 TypeScript、JSON Schema、运行时校验与示例**
  - 选择一个机器合同作为单一真相源，消除 request 的
    `includeIncomplete`/`includeIncompleteSessions`、baseline 枚举、
    `splitByRevision` 和 report/individual 嵌套结构漂移。
  - Request、Dataset、Individual Report、Overall Report 在 Host 边界执行
    运行时 Schema 校验；生成的报告必须通过项目发布 Schema。
  - 合同生成同步 packages、docs schemas、示例、reference types 与 API 文档。

- [x] **P0.43 建立精确 Attempt Identity、事件窗口和去重规则**
  - Attempt 主键至少包含 tenant、root Session、Mission、Task、Task version、
    Agent identity/generation 与 lease sequence。
  - 每个 Attempt 只读取其 lease 到终态的事件窗口；返工、重新 lease、版本升级
    和多 Agent 执行不得继承彼此 acceptance、verification、freeze 或 evidence。
  - 同一权威 Attempt 在 Session、Ledger、Projection 多源出现时只能计数一次。

- [x] **P0.44 按 exact execution configuration 分层**
  - 主分析键包含 role、template/revision、prompt revision、provider、
    observed model、reasoning、ToolProfile/revision、PermissionProfile/revision、
    preset generation、Bundle version 与 DSH commit。
  - Flash、Pro、alias/fallback、不同工具或权限 revision 永不混组；报告中的配置
    只能来自该组冻结 configuration snapshot，不能取第一条样本冒充整组。

- [x] **P0.45 使用预执行难度、数据质量和缺失机制**
  - 难度由 Task type、Acceptance、文件/依赖/风险、上下文、工具可用性、
    Verifier 强度、Workspace drift 和战术覆盖等执行前特征冻结。
  - rework、blocker、Radio、用户介入和失败不得反向抬高原始难度；它们作为独立
    结果指标报告。
  - 区分用户取消、Provider、系统崩溃、外部依赖、Agent 失败、范围变化和未知，
    输出 missingness、coverage、selection-bias 与数据充分性。

- [x] **P0.46 修复指标语义并建立阶段化失败归因**
  - Mission completion 读取 Mission 权威终态；Task acceptance、集成、部门交接、
    父级恢复、false completion、freeze、recovery 和 regression escape 各自使用
    明确事件公式。
  - 工具失败拆分为任务歧义、工具选择、参数 Schema、Host 校验、权限、路径、
    工具运行、Workspace、验证、集成、父唤醒、Provider 和外部依赖阶段。
  - 每项指标公开分子、分母、事件来源、适用角色、缺失值规则和 Evidence。

- [x] **P0.47 防止 Provider 样本膨胀并实现逐场景验证器**
  - 同一 Attempt/Session/scenario 重复评估不得增加 N；解析器升级形成 revision，
    不形成新的独立样本。
  - `ALIAS_UNPROVEN` 不进入 exact-route 稳定结论；`schemaFirstPass` 必须只对应
    真实 Schema 结果，不得把所有工具错误混为 Schema 失败。
  - 九个 Provider 场景分别验证完整工具序列、路径/写入 receipt、终态、父唤醒
    和恢复因果链，不能仅凭首工具与会话结束判 PASS。

- [x] **P1.18 增加统计区间、聚类样本和动态充分性**
  - 二项率提供 Wilson 区间，成本/延迟和差异提供按 Mission 聚类的可复现
    bootstrap 区间；同一 Mission 的多个 Attempt 不冒充独立样本。
  - 使用 `NO_DATA`、`EARLY_SIGNAL`、`EXPLORATORY`、`DECISION_ELIGIBLE`、
    `REGRESSION_ALERT`，不再以固定 `N=5 && passRate>=80%` 声称稳定。
  - 小样本只给数据收集建议；多角色/多场景不输出伪精确全局排行榜。

- [x] **P1.19 建立 Flash/Pro 受控比较与晋升治理门**
  - 同角色、同任务类型、同预执行难度比较 Flash candidate 与 Pro baseline，
    区分观察性结论和前瞻性受控/隔离回放实验。
  - 支持按角色配置质量非劣界限；越权写入、路径逃逸、无证据完成、终态重复、
    父级不恢复和恢复漂移为不可被成本抵消的硬门。
  - 评估只产生 Canary/晋升建议；改变默认模型或 capability 状态必须显式批准
    并生成不可变治理 receipt。

- [x] **P1.20 建立 Accepted Outcome 归一化成本与延迟**
  - Attempt 级记录 input/output/reasoning token、模型步骤、纠正次数、工具时间、
    queue/model/tool/verification 延迟、fallback 和重跑成本。
  - Provider 价格未知时显示 unavailable/estimated/observed 状态和价格目录版本；
    不以零价格参与比较。
  - 核心经济指标为每个最终 Accepted Outcome 的总成本、Token、p50/p95 延迟，
    并以质量/安全门前置的 Pareto 视图呈现。

- [x] **P1.21 持久化 Evaluation Job、Dataset、Report 与重启恢复**
  - 使用 SQLite `evaluation_jobs`、`evaluation_reports` 和 Artifact repository，
    Settings 只保存当前 Job/Report pointer，不再作为唯一报告仓库。
  - 支持 revision/fence、lease、取消、超时、失败分片重试、重启恢复和幂等完成；
    进程重启后不可丢失运行状态、Dataset 或历史报告。
  - 最终报告发布前验证 request、dataset、configuration、rubric 和 schema hash。

- [x] **P1.22 实现报告历史、申诉与 superseding revision**
  - WebUI 可查看不可变报告链、配置差异、纳入/排除样本、限制和 Evidence。
  - 有权限用户可标记错误样本、附加 Evidence、提交/撤回申诉；解决后产生新的
    Dataset/Report revision，并以 `supersedingReportId` 关联，绝不原地改旧报告。
  - 报告分类、Evidence 读取、脱敏、保留和撤回在 Host 权限边界执行。

- [x] **P1.23 将“Military-绩效评估”升级为可理解的决策中心**
  - 在现有一级导航内部提供：决策总览、角色/模型比较、九场景热力图、工具调用
    漏斗、成本/延迟 Pareto、数据与 Evidence、历史/申诉/改进实验。
  - 显示唯一 Mission/Attempt 数、置信区间、数据缺口、exact route/config、
    基线差异和晋升阻断原因；不显示无来源的混合总分。
  - Workspace/Mission 使用 Host 目录选择器；默认简体中文、渐进披露高级统计，
    维持 DSH RC.2 原生组件、键盘、焦点、200% zoom 和高对比度行为。

- [x] **P2.11 建立绩效评估纵向测试、统计 fixture 与浏览器验收**
  - 覆盖筛选、canonical hash、Schema parity、Attempt version/lease 去重、route
    分层、缺失机制、区间边界、Provider 重复样本、九场景因果验证和成本未知。
  - 覆盖 Job lease/cancel/restart、报告历史、申诉/superseding、权限和旧数据迁移。
  - 在 exact RC.2 空 Profile 与本机浏览器验证七个子视图、长文本、键盘、窄视口、
    多报告和错误恢复；真实 Provider 仍单列为显式付费外部证据。

- [x] **P2.12 同步绩效文档工程、发行、升级与本机安装**
  - 更新 ADR、37/48/57/67 章节、指标字典、统计协议、Schema、示例、API、
    Threat Model、Runbook、Test Matrix、Traceability、VERSION、CHANGELOG、
    MANIFEST 和单卷设计规范。
  - 构建新的不可变版本，完成 generate/typecheck/build/test/docs/review/
    semantic/repair/pack/publint/reproducibility/空 Profile/三启动 E2E。
  - 升级本机 DSH Profile、重启 Web、运行浏览器验收并保留 release 校验和。

## `71fe7171` 会话回归：编排、模型目录与设置持久化

需求来源：用户提供的
`dsh-session-session-71fe7171-8719-477d-b755-95daee313497.zip` 只作为
不可信会话证据；本节验收条件以用户本轮三项明确要求和项目合同为准。

- [x] **P0.48 取证并封死 Military 模式直接编码旁路**
  - 逐事件确认该会话是否加载 fixed Military preset、General Prompt、
    Military tools、Mission/Task 状态和部门 dispatch receipt。
  - 当用户已选择 Military 模式且请求属于修改/创建工作区内容时，General
    必须先建立/恢复 Mission、派遣受治理部门、收集候选与验证/集成 Evidence；
    不得直接使用 DSH 原生 write/edit/bash 等实现工具绕过军团流程。
  - 保留纯解释、澄清、状态查询等不需要写入的短路径；失败时返回可纠正的
    Military 路由错误，不允许静默退回普通 Agent 编码。

- [x] **P0.49 统一“DSH 已接入模型即默认可用”的模型目录语义**
  - DSH 当前模型目录中的所有 Provider/model 均进入 Military 部门下拉和运行
    路由；官方 DeepSeek 与第三方 Provider 使用同一可选/可保存合同。
  - `未验证`、Capability Profile、绩效样本和 Canary 状态只作为信息与晋升
    Evidence，不得阻断用户选择、保存或正常调用已接入 DSH 的模型。
  - 仅凭模型目录缺少历史评估记录不得标为不可用；真正不可用只来自 DSH
    当前目录缺失、凭据/Provider 运行错误或明确的安全权限拒绝。

- [x] **P0.50 修复部门模型与参数设置的原子保存**
  - 复现切换 provider/model/reasoning 及修改预算、超时等参数后无法保存的
    前端、Remote、Schema、revision/fence 或 SQLite 根因。
  - 保存必须携带完整可编辑配置、保留未修改字段、执行运行时校验和冲突处理，
    成功后从 Host 权威快照回读；失败时显示准确字段错误而非静默回滚。
  - 覆盖 General 与全部部门、官方/第三方 Provider、长 model ID、页面重载、
    Web 重启和旧配置迁移。

- [x] **P1.24 完成三项回归的发行、安装与真实浏览器验收**
  - 将 `71fe7171` 根因固化为 fixture，并增加 Military 直接写入拒绝、完整部门
    编排、全模型目录可选、未验证不阻断和设置保存/重载测试。
  - 同步设置、模型路由、运行时、故障诊断、测试矩阵、CHANGELOG、VERSION、
    发布说明和 TASKS。
  - 完成全量门禁、不可变版本、空 Profile/三启动 E2E、本机重装、DSH Web
    重启；浏览器验证模型选择与配置保存后刷新/重启仍一致。

## 2026-08-27 深度架构闭环：执行活性、恢复、Flash、WebUI 与生产可信度

需求来源：用户要求启用 Persistent 模式，将 2026-08-27 对当前
`0.9.0-alpha.24` 的 WebUI、Workflow、状态机、持久化、模型兼容、安全、
评测与运维深度审计结论全部实现，完成代码审查和全量门禁后推送 GitHub。
本节覆盖此前清单虽然标记完成、但本次跨模块调用链审计证明仍未真正闭环的
语义；以本节新的纵向验收结果为准。

### P0：执行活性与数据正确性

- [x] **P0.51 分离 Workflow Obligation、Task Version、Attempt、Activation 与 Dispatch**
  - 每条执行型用户消息持久化独立 `WorkflowObligation`，绑定 message/request
    hash、Mission、Direction、Wave、Task、当前阶段、唯一下一工具和 wake cursor；
    不再通过扫描 Mission 中任意 open Task 推测本次请求。
  - Task 指令版本只在 objective/scope/acceptance 实质修订时递增；每次初始执行、
    Rework、Guidance/Decision continuation 使用独立 Attempt/Activation/
    Dispatch sequence 和 canonical payload hash。
  - Session Snapshot 只能证明历史 Session 存在；只有 durable start/heartbeat
    receipt 可报告 RUNNING，settlement receipt 报告 SETTLED，其余返回
    RECOVERY_REQUIRED，禁止假 RUNNING。

- [x] **P0.52 修复子 Agent settlement、lease cleanup 与取消/终止语义**
  - child disposed 只结算 Activation，不得把 BLOCKED、REWORK、FROZEN、
    AWAITING_GUIDANCE、AWAITING_DECISION 或成功 Specs Task无条件压回 READY。
  - 用户 Stop 默认只取消当前 Invocation/Activation；Task、Mission、Freeze 和
    Identity Termination 为显式不同命令。Step/wall-clock/no-progress 耗尽进入
    可恢复失败或升级路径，不永久终止稳定 General identity。
  - 重启、迟到、重复、乱序 settlement 使用 durable fence/idempotency 收敛，
    并释放 exact Grant、Budget、Workspace 与并发占位。

- [x] **P0.53 完整关闭 Radio、Blocker、Decision 与 Rework continuation**
  - 合并重叠 blocker/radio 语义；一个原子命令同时写 Blocker Evidence、
    `Task→AWAITING_GUIDANCE`、Radio Queue、Activation Waiting 和 parent receipt。
  - Guidance 必须投递给 exact Attempt 或新 continuation Attempt，并由 Worker
    acknowledge 后恢复 RUNNING；expiry/dead-letter 明确升级 BLOCKED。
  - Decision Question Set 必须关联 Task/Attempt；General 展示、用户回答、
    durable answer delivery、Worker acknowledge 和 Task resume 全部进入状态机。
  - Rework 必须真实发送 continuation 或创建新 Attempt，不复用已 settle Snapshot。

- [x] **P0.54 统一 Candidate、Verification、Specs、Integration 与最终完成语义**
  - 废除“Verification ACCEPTED 即 Task 终态”；实现
    `VERIFYING→VERIFIED→INTEGRATION_PENDING→INTEGRATING→COMPLETED`。
  - CONFLICT、STALE、REGRESSION_FAILED 不得保留成功终态，必须进入明确
    REWORK/BLOCKED/FAILED 并携带 receipt。
  - Engineer Specs 事务产生正式 Candidate/Evidence/Verification/Completion
    receipt；成功提交后 Task 终态，cleanup 不得重新派遣。
  - 唯一 Completion invariant 由 Host reducer 判定，模型正文和 parent report
    不能自行宣布完成。

- [x] **P0.55 建立短事务 Saga、真实 Outbox 与完整 Workspace 持久化**
  - Mission SQLite 事务不得跨 LLM、Git、文件系统、Provider 或长验证；采用
    command intent/outbox、外部 operation marker、checkpoint 和 receipt 的短事务
    Saga，所有副作用具有稳定 operationId 与状态查询。
  - 所有 SQLite 写入经过同一 queued writer/transaction API，禁止异步事务等待
    期间的 raw connection 写入串入或被无关 rollback 回滚。
  - 实现 transactional outbox claim/delivery/retry/dead-letter/offset；若某记录
    仅是审计 journal，使用准确名称和 UI 语义。
  - Workspace Snapshot、Lease、Candidate Patch、Integration Order/Receipt
    持久化到唯一生产 Store；启动时发现/收养/隔离现有 worktree，未知状态绝不
    先递归删除。完整进程重启可恢复 mid-worker/mid-integration。

- [x] **P0.56 实装 Direction/Wave/Dependency/Barrier/Mission Scheduler**
  - 生产路径使用 Planning Engine 校验 DAG、未知依赖、cycle、write conflict；
    Task 只有在依赖完成、Wave 激活、scope lock 和预算准入后才可派遣。
  - 实装 Direction/Wave aggregate 和 transition；产生 `wave/opened`、
    `wave/barrier-satisfied`、`mission/completed/cancelled` 权威事件。
  - Trajectory、Effectiveness、Evaluation 和 Web Projection 只消费真实事件，
    不以缺省或模型声明替代。

- [x] **P0.57 消除 Flash 文件路径和阶段工具协议的确定性失败**
  - Worker 在真实 execution cwd 运行，或只看到 Host-rooted Military
    read/search/write/edit wrapper；模型只提交 Task 相对路径，Host 转换并执行
    绝对 canonical authorization。
  - 每个状态只暴露 1—4 个当前工具；固定 ToolProfile 继续作为权限上限，
    模型可见面由 canonical state 生成。
  - 简化 Task Create 基础 Schema，Host 派生 taskKey、Direction/Wave、
    read/forbidden scope、budget、stop/escalation；高级计划走独立受治理入口。
  - 统一错误 envelope、唯一 nextTool、corrected shape、retryability 和重复签名
    阻断；终态成功后绝不执行同一 assistant response 的后续调用。

### P1：模型能力、WebUI、安全与评测真值

- [x] **P1.25 建立诚实的 DSH Model Capability 与 Compatibility Bridge**
  - 分离 Catalog Presence、Protocol Compatibility、Policy Eligibility 和
    Performance Evidence；不得因目录存在就虚构 toolCalling、reasoning、
    context、residency 或 VALIDATED。
  - 所有 DSH route 均可见且可配置；native tool route 直接执行，非 native
    route 只有在受测 Bridge 可用时才可执行。未评测不阻断可用 route，但必须
    准确标注。
  - Role Workbench 保存 exact catalog capabilityProfileId；Dispatch 前校验 exact
    route/adapter，Binding 与评测引用同一不可变 profile。

- [x] **P1.26 将设置保存升级为 Desired/Applied 原子配置**
  - 一次 UI 保存原子写完整 Desired revision；后台 Reconciler 校验并应用
    General 与全部部门，全部成功后推进 Applied revision。
  - UI 只有 Desired==Applied 时显示已生效；失败显示 exact role/field、可重试
    或回滚，不产生 Settings 已提交但 Runtime 部分应用的 split-brain。
  - 所有多字段面板使用 section draft/preview/apply，移除顺序 `setMany` 中间态；
    页面刷新、重启、多标签页执行 revision/fence 冲突处理。

- [x] **P1.27 建立真实 Military 运行中心与统一 Web 查询层**
  - 保留现有七个设置一级选项卡；新增独立 Session 运行中心，展示 Request→
    Mission→Direction→Wave→Task→Attempt/Activation→Candidate/Verification/
    Integration、Radio/Decision、Budget 和 Receipt。
  - 所有 projection 携带 source revision、generatedAt、staleAfter 和 health；
    删除/迁移读取未被生产 Provider 写入的 workspace/integration 表和假空状态。
  - 建立共享 timeout/abort/dedupe/backoff/visibility/offline/revision query 层；
    历史报告选择、dirty draft 和 stale response 不被轮询覆盖。
  - Recovery preview 绑定 previewHash、expected state/revision 和 expiry，执行时
    CAS；状态变化必须重新展示 Diff 和确认。

- [x] **P1.28 统一 DSH WebUI Adapter、组件拆分和浏览器无障碍**
  - 提供薄 `FormField/Input/Select/TextArea/Notice/Section/Toolbar/AsyncBoundary`
    Adapter，仅组合 RC.2 primitive 与 `--dsw-*` token，不维护第二主题。
  - 按 Settings、Runtime、Knowledge、Evaluation、Operations feature slice 拆分
    超大组件，删除未使用 ModelsPanel/useModelCatalog 和重复 style/control。
  - 改进 focusable/inert/visibility、焦点恢复、200% zoom、forced-colors、
    reduced-motion、长模型 ID、简体中文 IME；完成真实浏览器、多标签页、
    断线和键盘 E2E。

- [x] **P1.29 完整落实 Artifact ACL、Classification、Residency 与 Principal**
  - Content Blob 与 Artifact Reference 分离；Reference 绑定 tenant、Mission、
    Task、classification、owner/audience、expiry 和 grant。知道 content hash
    不等于读取授权，同内容多分类执行最高分类合并。
  - Tool/Mission/Model authorization 使用真实上下文分类，不硬编码 internal；
    每次模型 Dispatch 生成 provider/model、classification、residency、redaction、
    policy revision 和 Evidence receipt。
  - Web Remote 使用 DSH principal/tenant authority context，不再硬编码 web-user；
    当前本机单用户边界与未来多租户能力准确区分。
  - restricted/raw 数据支持加密、密钥轮换、保留清理、legal hold、lineage、
    deletion receipt 和 orphan artifact GC。

- [x] **P1.30 修复 Tool 预算/超时幂等与 Evaluation 数据真值**
  - Tool post hook/evidence/settlement 失败仍通过 finally/outbox 结算；超时后可
    查询 operation receipt，禁止副作用已成功却返回失败后重复执行。
  - Evaluation 比率保留 numerator/denominator/status；零分母为 N/A，不为 0。
  - 长 narrative/provider 调用独立 heartbeat 和 lease fence；成本使用 exact
    route/version price snapshot，未知成本不参与 Pareto。
  - Mission completion、Specs coverage、Integration outcome、parent wake 等
    指标只在相应权威事件完整时计算，否则报告 missingness/blocked。

### P2：维护性、生产化与发布

- [x] **P2.13 清理包依赖方向、状态词汇和大型领域类**
  - Tools 不反向依赖 plugin-host 类型；Host Context augmentation 下沉到稳定
    API/contracts 包；修复未声明的 command-brainstorm 类型依赖。
  - 每个 aggregate 生成 transition/reducer/UI action 合同；消除 Task、
    Integration、Ingestion、Brainstorm 等多套状态词汇与不可达状态。
  - 拆分 ingestion/evaluation/control-plane/session-adapters/host-runtime/
    coordination repository 热点，保持行为测试先行。

- [x] **P2.14 生产可观测性、容量、分布式 Provider 与灾备**
  - 落实 OTel trace/metric/log correlation、SLO、backpressure、Radio oldest age、
    outbox lag、lease expiry、recovery drift 和容量测试。
  - 完成可替换 PostgreSQL Ledger、对象存储、队列、KMS、多租户限额、数据驻留、
    签名资产、备份恢复、灾备和 legal hold 演练；本地 SQLite 模式继续受支持。

- [ ] **P2.15 完成纵向测试、真实 Flash 外部验收、文档与发行推送**
  - 源码实现、220 项确定性测试、767 项文档/合同检查、exact RC.2、
    13/13 pack/publint、可重复发布、空 Profile、三启动纵向 E2E、代码审查和
    source-only 归档均已完成；本项只因真实 Provider 的
    `exact configuration × scenario × N≥50` 外部证据尚未产生而保持未勾选。
  - 增加多 open Task 请求关联、三次 Rework、Radio/Decision 全循环、Specs
    终态、Integration conflict/stale/regression、Stop 后续跑、完整进程崩溃、
    SQLite 并发、Wave barrier、Outbox delivery 和浏览器矩阵。
  - 确定性 Host/Schema/路径错误必须为 0；真实 Flash 每关键场景 N≥50，首次
    工具命中点估计≥95%且 95% Wilson 下界≥85%，E2E 完成点估计≥90%且下界
    ≥80%，越权写入/假完成/重复终态为 0。
  - 同步 ADR、架构、Workflow、状态机、WebUI、安全、评测、Runbook、测试矩阵、
    CHANGELOG、VERSION、README 中英文、MANIFEST 和单卷规范；完成 generate、
    typecheck、exact RC.2、build、test、repair、semantic、review、docs、release、
    空 Profile 与浏览器验收。
  - 最终代码审查无未解决 P0/P1；提交完整源码交付单元并使用本机已授权 GitHub
    identity 推送 `origin`，记录 commit 与远端确认。

## 2026-08-28 Workbench 无损升级回归

- [x] **P0.58 无损迁移持久化角色工作台**
  - 以运行时不可变历史中的精确旧 revision 为三方合并基线；未修改的内置角色
    自动前移到最新模板，用户已修改字段重放到新的不可变 revision。
  - General、已经领先/持平的角色、角色状态、模型、推理强度、预算、并发和
    用户提示词不得被默认配置覆盖。

- [x] **P0.59 消除旧 Agent Template 镜像回灌**
  - `military-agent-templates.profilesJson` 在 Workbench 成功应用后从运行时真值
    重建，不能在重启、恢复默认或新建设置文档时把 revision 6 再次写回。
  - 迁移和镜像同步必须使用 Settings revision/CAS，冲突时失败可诊断且不产生
    半写状态。

- [x] **P0.60 恢复 Desired/Applied 就绪门并保证幂等**
  - 升级事务按“迁移文档→应用运行时→同步兼容镜像→标记 APPLIED”收敛；
    失败保留明确错误和可重试状态，不通过全量恢复默认绕过。
  - 第二次启动不得新增模板/工作台 revision；`desiredRevision ===
    appliedRevision` 且执行路径不再被 readiness gate 阻断。

- [x] **P1.31 建立真实故障夹具、发行和浏览器验收**
  - 固定复现当前现场：大多数角色 revision 6、工兵 revision 8 且有两条用户
    保存历史、Worker revision 10、General 使用 Pro/Max。
  - 验收后大多数未修改角色迁移到 revision 8，工兵/Worker/General 配置与历史
    保持，应用状态收敛；覆盖首次迁移、重启幂等、CAS 冲突和失败恢复。
  - 完成生成、类型、测试、文档、exact RC.2、13 包发布门、隔离 Profile、
    本机升级、DSH Web 重启及真实浏览器复验，发布不可变 `0.9.0-alpha.28`。

## 总体验收标准

- [x] `pnpm install --frozen-lockfile` 通过。
- [x] 本地类型检查、exact RC.2 类型检查、构建、测试和文档验证全部通过。
- [x] `repair:regressions` 与 `semantic:audit` 全部通过，不允许 allowlist 掩盖。
- [x] 所有发布包通过 pack/publint，依赖闭包不访问不存在的 npm 包。
- [x] 从 release 产物在空 DSH Home 创建 Profile、安装、启动并激活所有 entry。
- [x] 完成一条真实 Military Session 纵向流程，并在进程重启后恢复。
- [x] 发布目录包含安装包、校验和、安装/升级/回滚说明与准确版本报告。
- [x] 源码、测试、报告和文档不再包含仍影响行为的废弃基线。
- [ ] 真实 Flash 回归中所有工具参数首次命中模型合同，Military 工具调用无
  上述四类确定性错误。
- [x] `c21a6c55` 中全部确定性工具、父子恢复和文件写入失败均有根因、fixture、
  回归与修复；父自然停等会被关键子报告恢复，显式用户取消不会被恢复。
- [x] `573e3540` 中每一类工具失败均有明确根因、固定回归与修复后预期；回放
  不再出现同类 Host/合同错误，且真实 Provider 复验所需观察点已记录。
- [x] `cb4c670f` 宿主回归中的错误工作区、`unknown reservation`、部分 Specs
  写入、General `bash`、超步数和中止状态悬挂全部消失。
- [x] 从干净临时工作区完成 Specs 任务：只在 Session workspace 创建并提交
  文档，插件源码目录零变化，失败注入后工作区也零变化。
- [x] 新 release tarball 安装到 `$HOME/.dsh/profiles/web`，Profile
  锁定 `0.9.0-alpha.24` 产物；同一 tarball 已通过隔离 Web Profile Loader
  激活检查，并已重启本机 DSH Web、确认 HTTP 200 与 Military browser entry。
- [x] 轻量模型默认路径从 Mission 建立到 Task 派遣、Worker/Engineer 执行、
  终态 receipt、父 General 恢复与结果整合完整走通，终止后无第二次工具执行。
- [x] 每个复杂模型侧 Military Schema 满足新的字段数、嵌套深度和字节预算；
  无效路径/参数一次即可纠正，重复签名不会形成无进展循环。
- [x] DSH Settings 中存在独立 Military 导航；全部常用设置均可视化，各部门
  provider/model/reasoning 由真实模型目录下拉选择，保存与重载不丢字段。
- [x] Pro 等重量模型仍可按部门选择并可作为显式升级路径；轻量化没有删除
  Mission、部门、文件、验证、Git、恢复、治理或审计能力。
- [x] 从 UI 导入 Session/direct-text/Artifact 后，来源、sanitized snapshot、
  chunks、Candidate、Review、DRAFT 和 Promotion 在每个阶段重启后均可恢复。
- [x] Secret 不出现在 sanitized/model/candidate/log 路径；高风险 Prompt
  Injection 被隔离，WARN 需要用户确认，来源权利限制实际阻断越权发布。
- [x] 用户可视化审批生成不可伪造 receipt；General 无批准能力；DRAFT 不可
  召回，Canary/Testing/Stable 只按 exact version 和适用范围进入 Task。
- [x] Flash 通过浅层合同完成长文分块提炼和修订；Host 自动聚合证据、Diff、
  置信度与召回，不要求轻量模型填写内部 ID、Hash、时间、权限或生命周期。
- [x] 来源撤回后受影响版本立即停止新召回，派生影响和历史使用仍可审计；
  Stable/允许版本可编译为受治理 DSH Skill 视图而不写入不可信 SKILL.md。

## 当前执行批次

当前批次已完成：

1. 精确 RC.2 迁移、废弃基线清理与报告重建；
2. 自包含 release 产物、可重复打包与空 Profile 安装门；
3. 集成持久化、权威 evidence、统一 reducer、Authority/Budget、运行时
   Schema、自动化和 Inspector identity；
4. WebUI 生命周期、真实 RC.2 三启动 E2E、package invariant 与文档同步。
5. 修复模型侧工具 Schema 与 Host 编译合同；
6. 修复 Brainstorm Mission 上下文、幂等和 Mission Snapshot JSON 输出；
7. 按角色收窄工具面并建立 Flash 专项回归；
8. 统一 Session Workspace、Snapshot、Specs、Git 与 Integration 路由；
9. 修复 Tool deny/settlement、General ToolProfile 与机器可读错误合同；
10. 建立 Specs 原子事务、step/no-progress/abort 强制收敛与 `cb4` 回归；
11. 可恢复清理错误 `.git` 与规格写入，并新增插件源码零污染保护测试；
12. 修复 `573e3540` 的提示/Schema 可见性漂移、发现路由、拒绝恢复和状态膨胀，
    发布并安装 `0.9.0-alpha.4`；
13. 完成 `c21a6c55` 取证并修复 report 授权/唤醒、取消 settlement、路径默认、
    Specs 浅层合同、Git 未跟踪路径、step budget/finalization 和成功 receipt
    父级交付，建立 95 项回归；
14. 完成 `0.9.0-alpha.5` 全量发行门、隔离 Profile 三启动 E2E、本机重装、
    Installer receipt 核验与 DSH Web 重启。
15. 完成 `4844eb48` 逐事件取证，修复 RC.2 子请求提示竞态、Engineer 单事务、
    Specs 目录/单文档语义、Task 工具上限与无害桌面元数据阻塞，并以真实 RC.2
    Worker write/edit 和 Engineer 9-tool 首请求 E2E 验证。
16. 完成 `0.9.0-alpha.6` 的 101 项测试、740 项文档检查、全量发行审计与可重复
    打包；清空失败运行状态后重装本机 Profile，并验证空数据库、HTTP 200、
    Loader/Preset/browser entry 及全部内嵌包版本。
17. 完成 `0.9.0-alpha.7` 的终止事务、同轮闩锁、派遣幂等、父级 receipt、
    Host 编译浅层合同、轻量优先部门模板、完整 reasoning 路由、阶段化工具面、
    可执行预算与大规格/并发治理。
18. 新增独立 Military Settings 导航和七个可视化设置面板；通过真实模型目录
    下拉框配置 General 与 11 个部门，并完成保存、页面重载、原值恢复和零前端
    错误实测。
19. 完成 108 项测试、743 项文档工程检查、精确 RC.2 全 workspace typecheck、
    semantic/review/repair、13 个发布包 pack/publint、可重复打包、隔离 Profile
    三启动 E2E、本机重装、Installer receipt 核验与 DSH Web 重启。
20. 完成私有 Skill 的 Raw Vault→sanitize→Flash 分块→审批→生命周期→召回
    →效果→撤回闭环；123 项测试与 743 项文档检查通过。真实 Chrome 验收发现并
    修复旧 Web 源码拼接的重复词法声明，发布不可变 `0.9.0-alpha.10`，重装后
    验证独立 Military 设置、模型下拉、六视图 Knowledge Center 与零新增错误。
21. 将 Settings Center 与 Knowledge Center 统一到 DSH Web RC.2 原生
    primitive、token、modal、field、navigation 与可访问性节奏；新增主题所有权
    回归，发布并安装不可变 `0.9.0-alpha.13`。
22. 将 Military 设置中心迁移为与“知识与技能”相邻的独立侧栏弹窗，固定七个
    左侧一级选项卡；实现 General 与 11 部门的简体中文自带提示词、编辑、
    immutable 持久化、逐项/全量恢复及实际 Prompt Assembly 执行链路。
23. 将 Military 设置与知识按钮组合为一个纵向 footer occupant，并与 DSH
    原生 Settings 在展开/收起态使用相同几何、点击域、图标节奏和交互状态；
    真实浏览器验证三者对齐且没有侧栏横向溢出。

24. 完成角色工作台首批治理闭环：可搜索单角色编辑、六层有效提示词、
    Flash 确定性就绪门、离线工具模拟/显式只读 Canary、带 revision 的原子
    保存、冲突处理和可移植导入导出；135 项测试全部通过。
25. 完成 Session 权威诊断、受治理恢复、提示词不可变历史、能力驱动模型目录、
    成本/预算解释；角色 revision 与真实使用、模拟和评测关联。
26. 完成 Specs 工作区、九场景固定评测、简体中文确认回执、知识透明/同规则
    召回模拟及无障碍/i18n/紧凑视口硬化；新增完整十五项文档章节并同步架构、
    API、运维、安全、安装、升级与回滚。
27. 真实安装浏览器验收进一步发现并修复 RC.2 Typert/Cordis proxy receiver
    与 ECMAScript private-brand 不兼容、General Host 权限 sentinel 误报、
    preset 当前指针/Bundle 版本混淆及深冻结 SQLite projection 原地排序。
    `0.9.0-alpha.21` 已通过 148 项测试、747 项文档检查、精确 RC.2 声明编译、
    13/13 pack/publint、可重复打包、空 Profile、三启动 E2E；本机重复运行
    九场景与两次召回模拟均无 Remote/只读数组/控制台错误。
28. 完成绩效评估 v2 的十五项生产可信度闭环：唯一 canonical Dataset/Hash、
    exact Attempt/配置分层、预执行难度与缺失机制、阶段化失败归因、Wilson 与
    Mission 聚类 bootstrap、Flash/Pro 非劣与安全硬门、Accepted Outcome
    经济性、SQLite Job/Report/申诉/superseding，以及七视图决策中心。真实安装
    浏览器验收发现并修复 Settings Job 与报告投影异步完成后页面不刷新的问题；
    `0.9.0-alpha.22` 已通过 156 项测试、755 项文档/合同检查、精确 RC.2
    声明编译、13/13 pack/publint、可重复打包、空 Profile、三启动 E2E，
    并在本机验证报告重载恢复、第二次运行自动刷新、七视图、九场景、720px
    窄视口无横向溢出及 Escape 焦点返回。
29. 完成 `71fe7171` 三项回归闭环：以固定归档 hash 和 2482 行 JSONL 证明
    General 在一次 Mission 后输出 37,362 字符实现文本；新增 Host-owned
    Mission→Task→status→部门派遣单阶段门、General stop interlock 与正文实现
    输出抑制。DSH live catalog 中所有官方/第三方 exact route 均默认可选，
    reasoning 由 adapter-owned vocabulary 在请求边界适配，绩效状态不再充当
    可用性权限。设置保存采用单次 CAS、串行 runtime projection 和权威 revision
    回读；真实浏览器又发现并修复多行自带提示词被通用单行标量校验器误拒的
    installed-only 根因。不可变 `0.9.0-alpha.24` 已通过 167 项测试、756 项
    文档/合同检查、精确 RC.2 声明编译、13/13 pack/publint、可重复打包、空
    Profile/三启动 E2E；本机完成工兵 Flash→Pro、high→max、输出与并发参数
    保存、页面重载、DSH 进程重启持久化，再恢复原 Flash/high/16384/2 配置并
    二次重启确认，所有 live 模型 option 均启用且页面无“未验证”或保存失败。
30. 完成 `0.9.0-alpha.27` 深度架构闭环：持久化
    Workflow/Task-Version/Attempt/Activation/Dispatch、Radio/Decision/Rework、
    Candidate→Verification→Integration、Direction/Wave Scheduler、短事务
    Command Saga、统一 SQLite writer、ordered outbox、Workspace 重启恢复、
    Task-rooted Flash 文件工具、统一脱敏纠错 envelope、模型能力四轴、
    Desired/Applied、Runtime Center、Artifact ACL、显式 Mission 取消、
    Evaluation missingness 与 Production Plane；最终审查又补齐并发
    reservation 串行化、lineage fence、Dispatch 精确重放、Activation 合法
    转移/终态原因、无 Workspace 子会话收敛、可恢复资源清理、Artifact
    完整性/索引重建/孤儿回收，以及按职责拆分 Evaluation、Ingestion、
    Control Plane、Session、Host Runtime 与 SQLite 协调仓库。217 项确定性测试、767 项
    文档/合同检查、82 项架构审查、exact RC.2、13/13 pack/publint、可重复
    release、空 Profile 和三启动 E2E 全部通过；源码 ZIP 已证明不含 `lib/`、
    `release/`、本地报告、数据库或凭据。
31. 完成 `0.9.0-alpha.28` Workbench 无损升级闭环：以运行时不可变旧模板为
    三方合并基线，将现场九个 revision 6 内置角色前移到 revision 8，同时保留
    General Pro/Max、工兵 revision 8、Worker revision 10 及用户保存历史；
    Runtime 应用成功后才以 CAS 同步兼容镜像并标记 APPLIED。220 项确定性测试、
    767 项文档/合同检查、exact RC.2 typecheck、13/13 pack/publint、可重复
    release、隔离 Profile 和重启 E2E 全部通过；本机真实状态已由 Desired 3 /
    Applied 0 收敛为 Desired 4 / Applied 4，第二次 DSH Web 重启没有新增
    revision、history、attempt 或模板版本，浏览器确认“当前配置已生效”且无
    新增控制台错误。

当前确定性开发状态：

1. 用户确认的十五项控制中心深化任务均已实现并通过源码、安装和浏览器门；
2. 绩效评估 v2 的十五项生产可信度任务均已实现并通过源码、统计 fixture、
   发行、安装和浏览器门；
3. `P1.9` 与“真实 Flash 全部首次命中”仍保持未完成，因为它们要求部署侧创建
   新的真实 Provider 根/子 Session，并为每个 exact configuration × 场景取得
   至少 50 个唯一 Session，同时通过首次工具/E2E Wilson 下界和四类零安全失败
   门；不能由离线门、模拟门、确定性 fixture 或 N=1 推导。

后续外部验收（不阻塞确定性开发与发行门）：

1. 由用户新建真实 Flash Session 再次完成外部 Provider 验收；
2. 验收样本通过后，将 Flash capability profile 从 `CANARY` 晋升为
   `VALIDATED` 并重新评估自动 fallback。
