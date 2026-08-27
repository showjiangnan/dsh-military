# WebUI 设计

## 1. 目标

WebUI 让用户以“统帅”视角配置组织、观察 Mission、处理授权和审计证据，而不是把所有 Agent 对话平铺成聊天噪声。

## 1.1 0.9.0-alpha.25 源码实现边界

当前 Integration Alpha 已实现：

- 与“知识与技能”相邻的独立 `Military 设置中心` 侧栏入口和原生 Modal；
- 可搜索的 12 角色目录、一次只挂载一个编辑器、未保存草稿保护、事务保存、
  revision 冲突处理、历史回滚和安全导入导出；
- DSH live 模型目录下拉、能力状态、经济/标准/深度预算、费用与历史 observed
  指标；
- Host 六层有效提示词预览、确定性 Flash readiness、离线工具模拟、显式只读
  Canary 和用户确认式简体中文辅助检查；
- Execution、Staff、Tag、Tactic、Oversight、Specs、Memory、Evaluation 和
  Presentation 可视化面板；
- Session 诊断时间线、受治理恢复操作、Host workspace 目录和 Git/lease/
  integration 状态；
- 独立 Session Runtime Center，展示
  Request→Mission→Direction→Wave→Task→Attempt→Activation→Dispatch，
  以及 Candidate/Verification/Integration、Radio、Decision、预算和 receipt；
- 共享 timeout/abort/dedupe/backoff/revision query layer 与跨标签页失效通知；
- 固定九场景评测工作台、真实 Provider Session 样本趋势以及 N≥50/Wilson/
  零安全失败发行验收；
- 独立“知识与技能”入口和七视图 Knowledge Center；
- 可信 Typert RPC 上的来源导入、分块 Job、候选 Diff/编辑/审批、Skill
  生命周期、效果记录、撤回与影响、sanitized pipeline 透明度及无 Task 模拟
  召回；
- RC.2 shared settings mirror；
- dynamic client manifest 与 lazy module-loader artifact。

### DSH 原生组件与主题合同

Military 不维护第二套 Web 主题。设置中心与知识中心直接复用 RC.2 的
`Button`、`Pill`、`StateDot`、`Modal` 和图标 primitive；DSH 尚未提供公开
primitive 的 `select`、`textarea` 与 checkbox 则按同一 32px field、8px
圆角、label 和 focus contract 实现薄适配层。

所有颜色只引用 Host 的 `--dsw-*` design aliases。明暗主题、hover、active、
disabled、错误/成功状态、遮罩、阴影与滚动层级均由 DSH Web 决定，插件不定义
独立色板。Settings 内容遵循内置 Models Section 的 14/22 正文、12/18
caption、12px card 和 28/36px capsule 节奏；Knowledge Center 使用内置
Modal 的 24px elevated surface，并沿用 Settings 的 224px/188px rail、40px
nav cell 与侧栏 footer trigger。

Military 设置与知识入口作为同一个 `sidebar.footer.action` occupant 内的两个
纵向按钮渲染，避免 RC.2 list slot 的横向 flex 布局在收起态把按钮挤出 56px
侧栏。两个按钮逐项复制内置 `SettingsRoot` 的几何合同：展开态为完整 42px 行
点击域，收起态为居中的 36px 圆形点击域；margin、padding、radius、hover、
label overflow 与 16/18px primitive 图标尺寸均一致。

键盘 focus-visible、Escape/遮罩关闭、Modal 焦点捕获与返回、七选项卡和角色
目录 roving focus、窄屏 rail 转横向导航、简体中文 IME、forced-colors、
`prefers-contrast` 与 `prefers-reduced-motion` 均已进入源码合同和发布门禁。

以下仍是后续产品面，不应在当前源码或报告中标记为已完成：

- 把 Military 私有状态直接嵌入 DSH conversation log 的 Conversation Nodes
  （RC.2 无第三方 required event 注册 seam）；
- 自定义 Advisor 创建；
- 分布式 Web push；当前使用 revisioned query/backoff/invalidation。

RC.2 没有为外部插件提供 required Session Event 类型注册面。Military 权威状态位于自己的 Mission/Administrative Ledger；未来运行视图必须读取插件自有 Remote/Projection，不能通过写入未知 `military/*` DSH Session Event 实现。

## 2. 已实现的 Military 设置中心

侧栏 footer 中的“Military 设置中心”和“知识与技能”纵向排列在 DSH 设置按钮
上方，并与该原生按钮具有完全相同的展开/收起点击域。点击后打开 Headless
`Modal`，不再把 Military 塞入 DSH 通用 Settings 的
`settings.section`。对话框左侧有七个固定一级选项卡：

```text
Military-部门模型
Military-执行与成本
Military-Specs 工作区
Military-安全与恢复
Military-战术与标签
Military-绩效评估
Military-显示与进阶
```

### 部门模型

- 可搜索、按部门/状态筛选的 General 与全部 11 个部门角色目录，一次只展示
  当前角色编辑器；
- General 与全部 11 个部门模板的 provider/model 下拉框；
- 选项来自 DSH `llm.models` 目录与 Military 治理路线的交集；
- reasoning、max output、context budget、并发和 compaction；
- template status；隐式 fallback 固定关闭，重量升级通过直接选择 Pro 完成；
- 每次保存生成新 revision，不热改运行中 Binding；
- 经济/标准/深度/自定义预算、token/中文字符/费用与历史运行指标；
- 实际 Prompt Assembly 的六层只读预览、语义 Diff、确定性 Flash readiness、
  离线工具模拟和需要明确确认的在线只读 Canary；
- General 和 11 个部门角色均直接显示插件自带的简体中文角色提示词；
- 每个提示词可视化编辑、保存和逐角色恢复，并提供“一键恢复全部角色自带
  提示词”；
- 提示词辅助检查跳过代码、路径和标识符，只在用户逐项或批量确认后应用，
  Host 重新计算 hash 和不可变审阅回执；
- 用户可编辑部分只负责角色指导；Host 在其后追加的工具白名单、工作区、
  证据、终态和权限边界不可编辑，也不能被提示词授予或削弱。

General 不是 Department `AgentTemplateProfile`，但与部门模板一起出现在同一个
可视化页面。其默认 route 来自固定 `military` preset，Military Settings 修改
后续默认请求；当前 Session 的显式模型选择仍按 RC.2 precedence 处理。
General 自定义提示词保存在 `military-model-routing.generalPromptOverride`；
部门自定义提示词保存在新的 immutable `AgentTemplateProfile` revision 的
`rolePromptOverride`。字段为空或缺失时始终解析为当前模板 ID 对应的插件自带
提示词，因此旧 Profile 不需要手工迁移。

### 执行与成本

- Radio attempt/lease；
- Chief of Staff fallback；
- Wave trajectory 与 General compaction 后 effectiveness；
- 部门模板、Flash 默认数量和并发预算总览。

### Specs 工作区

- RC.2 没有外部目录 picker，因此浏览器只选择 Host 从 Session binding 派生的
  不透明 `workspaceId`，不提交任意绝对路径；
- 展示 canonical root/hash、Git HEAD/branch/tree、dirty/untracked、
  allowed/read-only/forbidden/unscoped 树、lease/worktree、Candidate、
  integration、receipt 和角色路径示例；
- Session Workspace、Specs scope、local-only Git、事务回滚和 remote-write
  denial 不能被设置关闭。

### 安全与恢复

- 按真实 Session event/Host receipt 展示模型、Schema、补全、Grant、路径、
  工具、终态和父级唤醒诊断时间线，敏感字段先在 Host 脱敏；
- 展示 SQLite/WAL、备份、Preset/Bundle、Mission/Task/child、worktree、
  Grant、outbox 和 receipt 健康状态；
- 数据库验证、备份、reconcile、stale outbox 重投、过期资源释放和父级唤醒
  都必须先预览、再输入精确确认短语，结果为跨重启幂等 receipt；
- 不提供原始 SQLite 编辑、手工完成或无证据删除。

### 战术与标签

- 私有战术候选召回上下限；
- 私有 Skill 提炼 provider/model 下拉框、输出预算、确定性 fallback、默认
  可见范围和保留天数；
- 标签新增、暂停、恢复和 tombstone 删除；
- UI 负责版本与时间，不要求用户编辑 `tagsJson`。

## 2.1 已实现的知识与技能操作中心

Military 侧栏的“知识与技能”按钮打开独立对话框，包含：

- **来源资料**：直接文本、Session event range、Artifact、媒体类型、工具结果
  开关、classification、license、外部模型同意、依赖版本和可视化目标版本；
- **提炼任务**：SQLite durable 状态、Chunk 进度、resume、Injection WARN 用户
  acknowledgement；
- **待审候选**：Candidate/Diff hash、脱敏来源 Diff、Claim Evidence、风险、
  验证计划、编辑、批准 DRAFT、退回和拒绝；
- **私有技能库**：完整 immutable snapshot、exact version、文件、来源、效果、
  Tokens、Verifier、成本、sanitized snapshot/chunk、审批和继承谱系；
- **模拟召回**：不创建 Task、不调用模型，使用真实 recall 的同一权利、标签、
  生命周期、排序、token budget 和投放 renderer，显示选中/排除原因与 exact
  applicability card；
- **版本与晋升**：逐级 promotion、安全 rollback、quarantine、恢复和 deprecate；
- **撤回与影响**：原因选择、受影响版本、历史 Usage 和重新生成 impact report。

浏览器每两秒读取一次 redacted projection，长提炼可刷新或重启后恢复。写操作走
`militaryPrivateSkills/execute`，读取走 `militaryPrivateSkills/snapshot`；原始
正文不经过共享 Settings。传输失败只使用同一 operation ID 重试一次，领域失败
不自动重试。UI busy latch 防止同一标签页并发提交，领域层仍以 hash、receipt 和
SQLite 唯一键处理跨标签页/重启幂等。

### 绩效评估

`Military-绩效评估` 是一个一级选项卡，内部按渐进披露提供七个子视图：

1. **决策总览**：Report 状态、唯一 Mission/Attempt、区间、数据缺口和阻断；
2. **角色/模型比较**：exact configuration、Flash/Pro 非劣、难度平衡与路线；
3. **九场景热力图**：固定 `military-flash-core-v1` 与真实 Provider observation；
4. **工具调用漏斗**：选择、Schema、Host、权限、路径、运行、验证、集成、父唤醒；
5. **成本/延迟 Pareto**：先执行质量/安全门，再比较 Accepted Outcome 资源；
6. **数据与 Evidence**：canonical dataset hash、纳入/排除 Attempt、configuration、
   missingness 和 Evidence；
7. **历史/申诉/改进实验**：immutable Report lineage、challenge、resolution 和
   superseding revision。

请求表单使用 Host Workspace/Mission 目录、置信水平、非劣界限和执行超时，不要求
用户手填专业配置 JSON。Failed Job 显示结构化原因；retryable Job 可从冻结分片重试。
Provider 样本按 dataset + Session + scenario 去重。至少 10 个 exact-route
独立 Session 且 Wilson 区间足够窄时可以显示趋势；发行 acceptance 另要求每个
exact configuration × scenario 至少 50 个 Session、首次工具/E2E Wilson 门和
意外确定性错误/越权写入/假完成/重复终态全为 0。确定性 Host 结果与真实
Provider 观察始终分栏。

### 显示与进阶

- 军事/中性术语；
- 高级审计信息和紧凑布局；
- 模板、工具与权限治理数量只读摘要；
- 200% zoom、大字体、长 model ID、forced-colors、高对比度、简体中文 IME 和
  reduced-motion 不破坏 RC.2 原生布局。

## 3. 参谋创建向导

1. 身份；
2. 职责/非职责；
3. 领域/场景；
4. 模型/Thinking；
5. 工具；
6. Tactical Skill patterns；
7. Enterprise API Grants；
8. 数据分类/凭据 refs；
9. 预算；
10. 权限 Diff；
11. Canary；
12. 激活。

Secret 字段只选择 credential reference，不回显值。

## 4. Runtime Center 与 Conversation Log 边界

当前 Runtime Center 已通过 Military 自有 Remote/Projection 与稳定业务 ID
构建，不以未知 DSH Session Event 为数据通道。其稳定节点包括：

- Mission Intent；
- Staff Council；
- Direction Ratified；
- Wave Open/Barrier；
- Task Assigned；
- Candidate/Verification；
- Radio Request/Guidance；
- Oversight Freeze/Release；
- Specs Commit；
- Tactical Memory；
- Promotion Order；
- Incident。

每个节点使用 durable Event family + stable id，可历史重建，并携带
sourceRevision、generation、generatedAt、staleAfter 与 health。把这些节点直接
注入 DSH conversation log 仍是未实现边界；那需要未来上游提供安全的第三方事件
扩展 seam。

## 5. Mission Dashboard

### Overview

目标、当前 Direction/Wave、进度、风险、预算、模型路由和用户待决事项。

### Plan

Direction/Wave/Task DAG、依赖、锁、状态、Agent、版本和 Acceptance。

### Forces

Agent Roster、role、model/reasoning、Task、lease、状态、工具活动和冻结。

### Evidence

Candidate→Clause→Verifier→Artifact/Event 的图。

### Radio

队列、领域、等待、lease、重复、过期、指导和结果。

### Specs

文档状态、追踪缺口、本地 main commit 和 Wave Barrier。

### Knowledge

Skill 版本、使用、效果、Canary、Museum 提案。

## 6. 用户操作

- 修改/停止 Mission；
- 批准风险和外部动作；
- 选择/停用参谋；
- 查看和手动处理 Freeze；
- 请求重新验证；
- 发起 Promotion Order；
- 导出审计；
- 删除/保留数据。

所有写命令携带 expected revision；冲突时显示实际新状态，不静默覆盖。

## 7. 安全 UX

- 角色名旁显示真实权限；
- 明确“描述不会授予权限”；
- 高风险动作显示 source commit、remote、branch 和 expiry；
- Model fallback/数据出境显著提示；
- Freeze 展示确定性证据与模型意见的区别；
- 不显示隐藏 reasoning；
- 敏感 Artifact 需授权、脱敏和访问审计。

## 8. 实施顺序

1. Settings Cards；
2. 插件自有只读 Mission Projection/Remote；
3. Mission read-only dashboard 与可选 Conversation renderer；
4. revision-fenced commands；
5. Tactical/metrics advanced panels。

若 DSH 尚无稳定顶层页面 seam，优先使用官方 Settings 与 Conversation Node 扩展，不依赖私有 UI 内部。

## 0.2.0 WebUI 增量

### 新建会话 Preset

复用 DSH agent preset chip，增加固定 `military`；会话开始后只显示只读标签，不提供假热切换。

### Military 设置分区

- 独立一级导航：与 Agent 预设同级；
- General + Department Templates：目录驱动的模型下拉、Thinking、Context
  Budget、Compaction 和并发；
- Staff/Execution：参谋长兜底、Radio 与 Memory 触发器；
- Tactical Tags：新增、暂停、恢复和 tombstone 删除；
- Safety/Specs：可变恢复策略与不可降级治理边界；
- Performance：模板/部门/工作区/Mission 评估范围、durable Job、七视图决策中心、
  immutable 报告历史与申诉。

### 普通会话

普通 preset 只看到 DSH 默认 UI。Military Conversation Nodes、命令和控制按钮只有 actual preset=`military` 时渲染。


## 9. 0.3.0：冲突、恢复与完整交互

WebUI 以 durable projection 为真源，覆盖：

- preset generation `MATCHED/ARCHIVE_REBOUND/QUARANTINED`；
- General 模型来源与切换 receipt；
- 设置 expected revision 冲突和字段 Diff；
- 多个标签页同时回答 Decision；
- 长任务刷新、断线、取消和恢复；
- Workspace drift、Integration queue 和 conflict report；
- 战术来源权利、提炼 Diff、撤回影响图；
- Evaluation Dataset Manifest、数据不足、申诉与重评；
- 预算 reservation、队列和耗尽处置；
- 军事/中性术语切换和可访问性。

详细交互契约见[WebUI 交互、冲突、恢复与可访问性](51-webui-interaction-and-conflict-ux.md)。普通 Session 页面不得呈现 Military Mission、Freeze、Radio 或 Evaluation 运行控件。
