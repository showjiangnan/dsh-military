# 53. 源码架构与包参考

## 1. 实现状态

`dsh-military 0.9.0-alpha.27` 已形成独立 npm workspace 源码工程，唯一完整兼容目标是：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

实现不修改 DeepSeek Harness 核心源码。Host、preset、工具和 Web client 通过 RC.2 公开 Cordis seam 组合；领域状态、SQLite、Git/worktree、Artifact、验收和绩效计算属于 `dsh-military` 自身。

## 2. 包拓扑

| 包 | 类型 | 权威职责 |
|---|---|---|
| `@dsh-military/contracts` | Service Definition / wire | ID、领域对象、Schema、事件、错误、服务接口 |
| `@dsh-military/core` | 领域内核 | Ledger、CAS、Workflow/Execution lifecycle、Wave scheduler、验收、督战、电台、Decision Broker、模板、预算 |
| `@dsh-military/infrastructure` | Provider | Artifact、受限进程、Git、worktree、Candidate Patch、Integration、specs |
| `@dsh-military/storage-sqlite` | Provider | SQLite migration、短事务 Command Saga、Mission/Admin Ledger、ordered outbox、Workspace/Execution state |
| `@dsh-military/runtime` | Orchestrator | 完整应用服务图、稳定 Tool Host API、部门 Agent、知识和评估运行时 |
| `@dsh-military/plugin-host` | RC.2 adapter | Agent/Session/Request/Tool/Compaction/Settings、Runtime/Operations Remote 与协调维护 |
| `@dsh-military/tools` | Model Consumer | General、Staff、Worker、Engineer、Inspector、Research 工具 |
| `@dsh-military/command-brainstorm` | Human Consumer | `/brainstorm` 命令和 General 问题中继 |
| `@dsh-military/webui` | Client Consumer | 角色/诊断/恢复/Workspace/基准、Runtime Center 与七视图 Knowledge Center |
| `@dsh-military/preset` | Agent-plane assets | 固定 `military` preset 和 generation archive |
| `@dsh-military/installer` | Lifecycle | preset 安装、验证、卸载和 profile 配置辅助 |
| `@dsh-military/bundle` | Distribution | Host-plane Cordis patch |
| `@dsh-military/testkit` | Test support | 临时目录、确定性 Clock、内存 Fixture |

## 3. 五层依赖

```text
contracts
   ↓
core
   ↓
infrastructure / storage-sqlite
   ↓
runtime
   ↓
plugin-host / tools / command / webui / installer / bundle
```

约束：

- 领域内核不导入 DSH；
- DSH 类型只出现在薄适配包；
- Agent-plane 与 Web client 对 DSH、Cordis、Schemastery 使用 peer dependency；
- 不复制 RC.2 运行时对象，避免 `Symbol`、`instanceof`、Service identity 分裂；
- `contracts` 是跨进程和持久数据真源，不能让 UI 自定义另一套对象形状；
- `tools` 只依赖 runtime 的稳定 Tool Host API，不反向导入 plugin-host；
- production provider 通过 application composition root 注入，接口 descriptor
  必须与实际 live instance 一致。

## 4. Host 启动顺序

```text
读取 Config
→ 打开 SQLite 并执行 migration
→ 归档当前 preset generation
→ 构造策略、模板、Workspace/Execution Store 和 Production Plane Provider
→ 创建 MilitaryHostRuntime
→ 注册 Host Settings
→ 注册 control/operations/runtime/workspace/benchmark/private-skill Remote
→ 启动 outbox/Radio/Decision coordination maintenance
→ Compatibility Probe
→ READY 或 fail closed
```

Host bundle 不注册 Military 模型工具；这些工具只存在于固定 `military` preset 的 standing scope。普通 preset 会话无法通过同工作区或 Session ID 获得这些能力。

## 5. Agent 创建顺序

非 General Agent 必须按以下顺序创建：

```text
解析 immutable template revision
→ 验证 model capability / Thinking / context
→ 解析 Tool/Permission/Verifier/Budget Profile
→ Worker 获取 Task-scoped Workspace lease
→ 生成 AgentIdentity
→ 持久化 AgentExecutionBinding
→ RC.2 agents.create() unpublished setup
→ composeFrom(childCtx, parent.ctx)
→ intersect ToolProfile + persona
→ 发布 Agent
→ 绑定 Military Session generation
→ 投递第一个 Task prompt
```

`AgentExecutionBinding` 在第一个 prompt 入队前持久化。模型不能在绑定之外修改 provider、model、reasoning、工具、权限、Verifier、上下文预算或 preset generation。
每次实际派遣还持久化独立 Attempt、Activation、Dispatch 和 policy receipt；
Rework/Guidance/Decision continuation 不复用已 settlement 的实例。

为避免大型领域文件把不相关策略绑在一起，源码按稳定责任边界进一步拆分：

- `evaluation.ts` 只保留 Job/lease/orchestration，
  `evaluation-analytics.ts` 承担统计真值与报告不变量；
- `ingestion.ts` 保留 supply-chain 状态机，
  `ingestion-support.ts` 承担 rights、sanitize、chunk 与 Skill bundle 编译；
- Control Plane、Session adapter 和 Host Runtime 分离 Remote/Reader/生命周期
  façade 与纯验证/转换 helper；
- SQLite coordination barrel 下的 Radio、Decision、Brainstorm、Appeal、
  Compaction 与 Tactical Tag 各自拥有独立 repository。

这些拆分不改变 package 依赖方向或公开 barrel；对应行为仍由相同的状态机、
SQLite restart、RC.2 E2E 和文档门验证。

## 6. 权威状态

模型可产生：

```text
Candidate
Blocker
Tactical Request / Guidance
DecisionQuestionSet
Inspection / Research Report
```

只有 Harness 服务可产生：

```text
Task accepted / rework
Agent frozen / released
Workspace integrated
Budget admitted / exhausted
Tactic published / quarantined
Evaluation dataset accepted
```

这条边界由类型、工具注册、Tool Pipeline、Session Event 和 Ledger 共同执行，不能只依赖 Prompt。

## 7. 构建产物

`pnpm build`：

1. 使用严格 TypeScript 工程构建所有包；
2. 将输出复制到各包 `lib/`；
3. 复制 SQLite migration、preset 和 bundle 资产；
4. 生成符合 RC.2 `window.__ModuleLoader__.load(...)` 约定的 Web client factory；
5. 写入 `BUILD-MANIFEST.json`，记录每个产物的 SHA-256。

## 8. 当前边界

已在本地运行：领域、SQLite、Git/worktree、Integration、Preset Installer、
WebUI 组件行为、Web bundle、空 Profile 安装、官方 RC.2 Loader、Preset mount、
Settings 持久化、Web Client graph、角色 revision/Prompt/readiness/lint、
Session 诊断/受治理恢复、Workspace projection、固定九场景基准、知识透明度/
模拟召回、Tool、continuable Worker 和三次启动恢复 E2E。

Control plane Remote 的共同形状是只读 `snapshot` 与窄 `execute`。浏览器不能拿到
SQLite handle、Raw Vault、credential、任意路径或 Git 写对象。E2E 使用确定性
进程内 LLM adapter；外部 DeepSeek Provider 的足量 exact-route 样本、未纳入
本机矩阵的浏览器和跨平台行为属于部署验收，不以接口 shim 伪装。
