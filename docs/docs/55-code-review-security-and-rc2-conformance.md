# 55. 代码审查、安全与 RC.2 一致性

## 1. 自动审查

`pnpm review` 阻断：shell 注入、eval、危险 Git、空 catch、DSH runtime 复制、未声明 Client external、未绑定 Task/Workspace 的 Worker、未绑定 Verification Context、非权威 Agent 接受结果、缺失 Capability Grant、过期基线常量和生成物污染。

## 2. 精确 RC.2 门禁

`pnpm typecheck:rc2` 只接受：

```text
release 0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

RC.2 采用两个不可混淆的门禁：

- `pnpm verify:rc2`：离线校验 `RC2-CONTRACT-SNAPSHOT.json` 中的官方公开源码哈希、版本和适配层不变量，输出独立 `RC2-CONTRACT-REPORT`；它不等同于上游编译。
- `DSH_RC2_ROOT=/exact/built/checkout pnpm typecheck:rc2`：校验上游 release、Git commit，并把全部生产源码编译到该 checkout 的真实 `lib` 声明上，输出 `RC2-COMPATIBILITY-REPORT`。

生产发布证据必须包含第二项，且 `sourceCheckoutVerified` 必须为 `true`。
`pnpm release:verify` 在完成其他本地门禁后运行该精确检查，避免离线合同报告
覆盖真实上游编译证据。

## 2.1 Session Event 边界

RC.2 已知事件目录不提供外部 required event 动态注册。审查脚本阻断任何 `session.append("military/*")`；Mission/Task/Radio/Freeze 的权威事实只写 Military Ledger，模型可见输入使用 DSH 已知的 `user/message`。

## 3. 子代理审查

- Department Agent 只能通过 `ctx.subagents.startContinuable()`；
- Military 提示/Schema 对齐必须通过 `registerContinuableSetup` 在未发布的
  continuable child scope 同步安装，不能等待异步 Session binding；
- RC.2 预留 childId 必须在调用前写入 Provisioning/Binding；
- Worker 在首轮前必须获得真实 Task + Workspace Lease；
- critical 与 ordinary report 都使用 `next-step`，确保 idle parent 自动恢复；
- Task `allowedTools` 同时约束首请求 Schema 与 Capability Grant，Engineer
  Specs 首请求不得超过 9 个工具；
- selective drain 不能终止未列出的 sibling；
- 重复 childId 必须对账 parent、descriptor、binding，不能盲重试。

## 4. Command 与图片

- `/brainstorm` 明确声明 `input.images: true`；
- Handler 只消费 DSH 已持久化的 Attachment blocks；
-图片能力、分类、预算和模型准入在 Context Compiler/Router 再校验；
-取消发生在图片 admission 后、Handler 前时不得产生领域写入。

## 5. Web Client

- peer dependency 有匹配 dev dependency；
- `dsh.client.external` 只声明真实非 baseline value import；
-无同步模块请求环；
- Settings 使用 RC.2 共享 mirror；
-业务组件不建立重复 wire reader；
- 当前 0.9.0-alpha.24 Web 包不注册 Military Conversation Node；角色治理、
  诊断/恢复、Workspace、固定基准和知识透明度使用插件自有窄
  Remote/Projection；后续附加运行视图同样必须以稳定业务 ID 聚合和分页重放。

## 6. DeepSeek

- input modalities 和最大图片字节进入 Model Capability；
- text-only 模型在网络前拒绝图片；
- Context Budget 使用真实 usage，包含 reasoning passback；
-遥测不记录 reasoning 文本、base64 或 Secret。
