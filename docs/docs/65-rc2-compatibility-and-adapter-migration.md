# 65. DSH RC.2 兼容与适配迁移

## 1. 固定基线

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

`0.9.0-alpha.27` 源码只对该提交声明完整支持。旧版部署继续使用其匹配发布包，不在同一进程混装两个 DSH runtime identity。

## 2. 稳定面

Preset、Agent Core、Model Selection、Tool Registry、Host Settings、Ask User、Compaction 和 LLM Core 的关键公开接口保持兼容。

## 3. 必须迁移的接口

### Continuable Subagent

- `SubagentReportDelivery`：`wakeup` 改为 `next-step`；
- `startContinuable()` 支持调用方预留 `childId`；
- 新增选择性 `drainContinuableChildren(parent, childIds)`。

Military 必须在子 Agent 建立前持久化预留 child id、AgentExecutionBinding、Task/Workspace assignment；重复 ID 需要对账后接管或隔离。

### Command

`commands.execute()` 新增 images 参数；`CommandInvocation` 新增 `attachments`。`/brainstorm` 声明 `images: true`，将草图、截图和架构图作为 Attachment Evidence 纳入 Brainstorm Context。

### Web Client

动态包使用 RC.2 的 `dsh.client.inject` 与 `dsh.client.external` 规则，peer 必须有匹配 dev dependency。Settings 读取使用共享 describe mirror；Military 不自行建立重复 invalidation reader。


### Session Log

RC.2 的 known-event catalog 不提供第三方 required-event 注册。Military 不再声明或追加 `military/*` DSH Session Event；Mission/Task/Radio/Freeze 等事实只写 Military Ledger，模型输入使用已知 `user/message`，Web 运行视图使用后续插件自有 Remote/Projection。

### Worker cwd

标准 continuable child 继承父 Session 的 cwd。写 Task 的真实 worktree 通过不可变
`AgentExecutionBinding.workspace` 绑定给 Host；Worker 只看到
`military_workspace_read/search/write/edit` 的 Task-rooted 相对路径合同。Host 在
不可见的 execution root 下完成 canonical 解析，再与 Task
read/write/forbidden scope 比较；模型提交绝对路径、盘符或 `..` 逃逸会在副作用
前被拒绝。

### DeepSeek

Model Capability 增加 input modalities、图片请求预算和 RC.2 reasoning passback 语义。Context Budget 和绩效成本按真实 usage 校准。

## 4. Experimental Agent Team

RC.2 Agent Team 只能作为可选非权威投影或 UI 实验，不得取代 Mission Kernel、Staff Radio、Workspace Lease、Verification 或 Military Task Ledger。

## 5. 兼容门禁

```bash
pnpm verify:rc2
DSH_RC2_ROOT=/path/to/exact-built-rc2 pnpm typecheck:rc2
```

第一项核对官方来源哈希快照、`next-step`、预留 childId、选择性 drain、Command 图片、SettingsScope、Client manifest 和 DeepSeek 能力策略。第二项在固定 commit 的真实上游声明上编译全部生产源码；上游必须先执行 `pnpm run build:lib`。只有第二项成功才可把 `sourceCheckoutVerified` 标记为 true。
