# dsh-military

[简体中文（默认）](README.md) | [English](README.en.md)

> 状态：`0.9.0-alpha.28`；已通过精确 DSH RC.2 类型检查、干净 Web Profile
> 安装、真实 Loader 激活、三次启动恢复 E2E、全部 package pack/publint、
> 可重复打包和校验和门禁。

`dsh-military` 是面向 DeepSeek Harness 的验证驱动多代理组织 Bundle。唯一支持
的运行时基线是：

```text
dsh@0.1.1-rc.2
deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
Node.js ^22.19.0 或 >=24
```

用户只在创建空白会话时选择固定 system preset `military`。该作用域提供
General、参谋、Worker、工兵、督战、电台、战术记忆、绩效评估、预算与权限
准入、自动压缩、外置证据验收和受控 Git 集成；其他 preset 不会获得 Military
工具、监听器或提示词。

## 工程组成

- `@dsh-military/contracts`：wire/storage 契约、Schema、事件和错误目录；
- `@dsh-military/core`：Mission/Task 状态机、Ledger、CAS、计划、验收、治理；
- `@dsh-military/infrastructure`：Artifact、受限进程、Git worktree、Candidate、
  Integration、specs 和知识供应链；
- `@dsh-military/storage-sqlite`：SQLite migration、短事务 Command Saga、
  持久 Ledger、ordered outbox、Workspace/Execution projection 和恢复状态；
- `@dsh-military/runtime`：应用服务图、部门 Agent、研究与恢复协调；
- `@dsh-military/plugin-host`：RC.2 Agent、Session、Tool、Compaction、
  Settings 和 Subagent 适配；
- `@dsh-military/tools`：按角色授权的 General、Staff、Worker、Engineer、
  Inspector、Research 工具；
- `@dsh-military/command-brainstorm`：显式 `/brainstorm` 命令；
- `@dsh-military/webui`：与 DSH 设置按钮使用同一 42px/36px 点击域的纵向
  Military 设置与知识入口、原生 Modal、七个左侧一级选项卡、General/11
  部门角色工作台、模型/预算/提示词 revision、Flash readiness/模拟、诊断/
  恢复、Specs 工作区、Request→Integration Runtime Center、固定评测、
  可访问性、完整七视图 Knowledge Center 与七视图绩效决策中心；
- `@dsh-military/preset`：固定 `military` preset 与内容寻址 generation；
- `@dsh-military/installer`：事务化 preset 安装、升级、验证与卸载；
- `@dsh-military/bundle`：可由 DSH Profile 安装的自包含 Host/Client Bundle；
- `docs/`：架构、合同、运维、兼容矩阵和可执行文档验证。

## 开发与完整门禁

依赖由 pnpm lockfile 固定。`DSH_RC2_ROOT` 必须指向已执行
`pnpm run build:lib` 的精确官方 checkout。

```bash
pnpm install --frozen-lockfile

pnpm generate
pnpm typecheck
pnpm verify:rc2
pnpm build
pnpm test
pnpm repair:regressions
pnpm semantic:audit
pnpm review
pnpm validate

DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm all:rc2
DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm release:verify
```

`pnpm test` 包含从 tarball 在临时 DSH Home 安装的 RC.2 Web Profile E2E：
实际启动 Loader 三次，挂载 `military`，修改并恢复 Settings，注册 Web Client，
捕获 continuable Worker/Engineer 的真实首请求，实际执行 Worker `write` 与
`edit`，再执行 Mission → Task → Candidate → Verification → Integration，并
验证伪造证据拒绝、桌面元数据保留、重复命令幂等、终态父级 receipt 和跨进程恢复。
测试使用确定性进程内 LLM adapter；真实外部 Provider 凭据、网络和部署环境仍是
上线检查，不在测试中伪造。

真实 Flash 发行验收同确定性测试严格分离。Military 绩效页从 immutable Session
event 与 Host-observed receipt 生成并导出证据；每个 exact configuration ×
场景需要 50 个独立 Session，并满足首次工具命中/E2E Wilson 下界及四类零安全
失败。离线重算命令：

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route deepseek-official/deepseek-v4-flash
```

该命令不发起付费请求；样本不足返回 `INSUFFICIENT_SAMPLE`，目录可用或本地门禁
通过都不会被写成真实 Provider 已验收。

角色提示词的用户可编辑正文使用简体中文并保存在 Settings/模板 revision 中。
Prompt Assembly 会在该正文之后强制追加 Host 拥有的工具白名单、工作区、能力
授权、证据和终态边界；编辑提示词不能获得新工具、扩大文件权限或绕过验收。

轻量模型工具合同采用“模型表达语义、Host 生成权威字段”的边界：

- 每个 Military 结构参数向模型公开完整数组、枚举、对象和必填 Schema；
- `military_task_create` 只接收浅层 Task 草稿，Mission/Direction/Wave/Task
  ID、版本、复杂度、证据条款和环境快照全部由 Host 确定性生成；
- General 与部门 Agent 都只看到 Host 权威阶段所需的 1—4 个工具；固定
  ToolProfile 仍是权限上限，Task grant 可把交集进一步收窄；
- 模型只复用 Host 当前阶段返回的 ID；不得猜测 Mission、Task、Attempt、
  Activation、Dispatch、Workspace 或版本/fence；
- Task `allowedTools` 同时限制模型 Schema 与 Capability Grant；
- 失败校验一次返回全部可见问题，Mission Snapshot 在工具边界转为稳定 JSON；
- Candidate、Blocker、Guidance、Decision、Specs、Inspection 和 Research
  终态先持久化领域结果，再可靠投递父级 receipt；崩溃重试复用同一结果；
- 终态成功后，同一模型消息中的后续调用被单调闩锁拒绝，父 General 由 RC.2
  continuable report 自动恢复，不需要模型轮询；
- 超大 Specs 使用 Host 分段 staging 与单次原子 apply，保留完整写入、验证、
  本地 Git 提交、ledger 和恢复能力。
- Task 的 step、tool call、Tactical Request、子代理墙钟和单次输出预算均进入
  实际执行边界；省略时采用 Flash 安全默认值，选择 Pro 时仍可在模板和模型能力
  上限内显式提高预算，不删减 Mission 流程。
- `WorkflowObligation`、Task Version、Attempt、Activation 与 Dispatch 独立；
  Session Snapshot 不再被当作 `RUNNING` 证据。
- Mission 外部副作用通过 `PENDING_EFFECT → EFFECT_APPLIED → COMMITTED`
  短事务 Saga 和 ordered outbox 恢复，SQLite 写锁不跨模型、Git 或文件系统。
- Worker/工兵只向 Task-rooted 文件工具提交相对路径；超时先查询 operation
  receipt，不盲目重复写入。

私有 Skill 供应链也采用轻量优先边界：

- 用户从 Knowledge Center 显式导入文本、Session 区间或文本 Artifact；原文
  只通过可信 RC.2 RPC 写入独立 Raw Vault，不进入 Settings 或 Session 日志；
- Host 在模型调用前完成 Secret/PII 清洗与 Prompt Injection PASS/WARN/FAIL，
  再以稳定 6000 字符 Chunk 调用零工具的 Flash extractor；
- 模型只返回一个浅层 JSON Claim 合同；ID、Hash、证据范围、聚合、版本、
  lifecycle、权限和审批全部由 Host 生成；
- 用户通过 Candidate/Diff hash 编辑、批准、退回或拒绝；只有批准动作能原子
  形成 DRAFT，General 无批准入口；
- 完整 Skill snapshot 使用精简 `SKILL.md` 加一层 `references/`、`examples/`
  和 `scripts/`，写入与投放时都验证 frontmatter、引用闭包、权限位和 SHA-256；
- DRAFT/SIMULATION 不进入 Task，全局 DSH Skill provider 只发布 STABLE；
  受控 Canary/Testing 由 Host exact-version 召回并向 Flash 注入小型适用性卡；
- owner/license/scope/audience/derivative/retention/dependency/expiry 在审批、
  晋升、召回和每次上下文投放前重新检查；撤回立即隔离派生版本并生成影响报告；
- Worker 终态自动记录 exact version、匹配原因、provider/model、工具证据、
  Verifier、返工/回滚、observed tokens、成本可用状态和结果。
- Knowledge Center 投影 sanitized snapshot/chunk、redaction/injection receipt、
  审批/版本/晋升/Usage/继承/撤回谱系；“模拟召回”不创建 Task、不调用模型，
  并与真实 Task recall 共用 resolver、rights gate、排序和 delivery renderer。

绩效评估使用同样的“轻量模型可用、Host 权威不缩水”原则：

- 完整 Request 只构建一个 canonical Frozen Dataset；Manifest、Attempt、指标和
  Report 共享同一 Artifact/hash；
- Attempt 以 Task version、Agent generation、lease sequence 和有限事件窗口去重，
  不继承旧 lease 的工具、验收、终态或父级唤醒；
- role、Template/Prompt revision、actual provider/model/route、Thinking、
  ToolProfile、PermissionProfile、Bundle 与 DSH commit 形成 exact configuration，
  Flash、Pro、fallback 和 alias 不混组；
- 预执行难度、缺失原因、失败阶段、Wilson/Mission-cluster bootstrap 和动态
  sufficiency 明示；同一 Mission 的返工不冒充独立 N；
- Flash/Pro 同角色同难度非劣比较先通过权限、Evidence、回归、终态、父唤醒和
  recovery drift 硬门，评估永远不能自动晋升模型；
- Token、延迟和可用成本按最终 Accepted Outcome 累计全部失败、返工和重试；
  Provider 价格未知时显示 unavailable，不以零参与 Pareto；
- Job、Dataset、分片、Report 和 Appeal 持久化；超时/重启只补缺失分片，申诉
  产生不可变 superseding Report；
- 默认不调用委员会模型；显式启用时只读脱敏聚合值、无工具、严格 JSON，失败
  回退确定性叙述；
- `Military-绩效评估` 提供决策总览、Flash/Pro、九场景、工具漏斗、Pareto、
  数据/Evidence、历史/申诉七个视图。

完整合同见
[`docs/docs/37-military-evaluation-committee.md`](docs/docs/37-military-evaluation-committee.md)、
[`docs/docs/48-evaluation-statistics-and-fairness.md`](docs/docs/48-evaluation-statistics-and-fairness.md)
和
[`docs/docs/57-performance-evaluation-runtime.md`](docs/docs/57-performance-evaluation-runtime.md)。

文件组织采用
[Claude Agent Skills 创建指南](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)
和[编写最佳实践](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices)
中的渐进式披露原则；运行时仍是 DSH RC.2 dynamic Skill provider，不依赖
Claude Skills API。完整合同见
[`docs/docs/33-tactical-ingestion-and-tag-governance.md`](docs/docs/33-tactical-ingestion-and-tag-governance.md)。

用户提供的 `deepseek-v4-flash` 失败 Session 已作为脱敏回归基线固化。代码级和
installed-Profile 回归已通过；真实 Provider 的修复后验证由新会话执行，所以
Flash capability profile 暂为 `CANARY` 且不参与自动 fallback；General 与部门
内置模板作为本轮轻量主力路径显式允许该 Canary，Pro 仍是逐部门可选路线。详见
[`docs/quality/MODEL-BENCHMARK.md`](docs/quality/MODEL-BENCHMARK.md)。

DSH 主侧栏中提供与“知识与技能”相邻的 `Military 设置中心` 入口，点击打开
原生 Modal；左侧是七个固定 Military 一级选项卡。General 与 11 个部门模板都
使用由真实 DSH 模型目录核对的下拉框，并直接显示可编辑、可恢复、可执行
简体中文辅助检查的插件自带提示词；角色目录、六层有效 Prompt、确定性
readiness、离线模拟、显式只读 Canary、immutable history、成本、Session
诊断、受治理恢复、Host workspace 目录、固定九场景基准与浏览器可访问性均已
接入。安全与恢复页还提供受 preview/CAS/过期时间/精确确认短语保护的显式
Mission 取消，并由 Host 清理全部 child Grant、预算、容量和 Workspace 资源；
它不等同于停止当前调用。轻量模型收到的 Military 错误统一为脱敏、有界且只有
一个 `nextTool` 的纠错 envelope，`correctedShape` 来自实际 RC.2 Schema。
内部 JSON registry、ToolProfile、PermissionProfile、authority、终止
协议和父级 receipt 不暴露为可误配文本。完整 15 项合同见
[`docs/docs/67-military-control-center-flash-workbench-and-accessibility.md`](docs/docs/67-military-control-center-flash-workbench-and-accessibility.md)。

以下本地门禁报告可由前述命令重新生成；按照源码仓库策略，它们不提交到 Git：

- `RC2-CONTRACT-REPORT.md`
- `RC2-COMPATIBILITY-REPORT.md`
- `TEST-REPORT.md`
- `CODE-REVIEW-REPORT.md`
- `RELEASE-REPORT.md`

`pnpm docs:validate` 会在本地生成 `docs/VALIDATION-REPORT.md`；该报告包含运行
时间，因此同样不进入源码提交。

## 安装

GitHub 源码仓库不提交 `release/`、编译后的 `lib/`、依赖目录或本地门禁报告。
需要离线交付源码时运行 `pnpm pack:source`；归档只读取
`git ls-files --cached --others --exclude-standard`，所以即使刚执行过构建和
发行门，也不会夹带编译产物、数据库、凭据或本地报告。
先从源码生成经过验证的发布目录：

```bash
pnpm install --frozen-lockfile
DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm release:verify
```

生成的发布目录包含两个自包含包和完整校验材料：

```text
release/
  dsh-military-bundle-0.9.0-alpha.28.tgz
  dsh-military-installer-0.9.0-alpha.28.tgz
  checksums.sha256
  INSTALL.md
  VERSION.json
  RELEASE-MANIFEST.json
  RC2-PROFILE-REPORT.json
  RC2-E2E-REPORT.json
```

安装到 RC.2 Web Profile：

```bash
cd release
shasum -a 256 -c checksums.sha256

dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.28.tgz

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install install \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"
```

Bundle 嵌入全部私有运行时 package、Installer 及其命令，因此标准安装只需
添加 Bundle，不会产生“plain dependency”告警，也不会从 npm 解析未发布的
`@dsh-military/*` 包。独立 Installer tarball 仅供 preset-only 生命周期使用，
不能作为 Bundle layer 添加。升级、强制 generation 迁移、备份和回滚步骤见
[`docs/docs/46-install-upgrade-rollback-uninstall.md`](docs/docs/46-install-upgrade-rollback-uninstall.md)；
构建后也可阅读本地生成的 `release/INSTALL.md`。

## 安全边界

军事词汇只是软件组织与流程隐喻。本项目不用于现实军事行动、武器、目标选择、
暴力、人员监控、胁迫或自动人事处分。模型输出不是完成证据；只有宿主观察值、
持久化 receipt、验证器和受控集成结果可以推进权威状态。
