# RC.2 全量修复闭环与发布门禁

版本：`0.9.0-alpha.6`  
DSH：`0.1.1-rc.2`  
固定提交：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 修复闭环

| 原阻断项 | 当前权威机制 | 失败处置 |
|---|---|---|
| Mission 命令非原子 | SQLite UoW 同时提交事件、projection、receipt、outbox | 整体回滚 |
| 幂等只在内存 | `(tenant, mission, idempotencyKey)` 持久唯一并绑定 payload hash | 重启后返回 durable duplicate |
| 关键运行态重启丢失 | Durable Object Repository + Ledger replay | 缺失或冲突时 fail closed |
| 路径拒绝仍消耗 Grant | canonical path/scope/deny 检查先于 reservation | 无消耗拒绝 |
| Git 崩溃窗口 | order/attempt/receipt + commit trailer reconciliation | 不确定时冻结 |
| Worker 自报证据 | Host Observed Evidence Store | 伪造引用拒绝并进入 Rework |
| Runtime/Ledger reducer 分叉 | 单一 Task reducer | parity test 阻断 |
| Authority/Budget 未接线 | Command/Model/Tool/Spawn/Radio/Rework 全入口准入与结算 | 无副作用拒绝 |
| Tool 输入未验证 | canonical JSON Schema runtime validator | handler 前拒绝 |
| 特殊自动化重复派生 | SQLite outbox、lease recovery、deterministic dispatch key | 重试去重 |
| Inspector identity 混淆 | 明确 agent/session/role/generation | 缺字段拒绝 |
| Web snapshot/HMR 不稳定 | stable external store、Settings adoption、dispose cleanup | behavior test 阻断 |
| 子 Agent 报告静默或被 ToolProfile 拒绝 | scoped `report` 授权 + RC.2 `next-step` | 父 General 自动 wake/steer |
| 用户取消 settlement 误触发父模型 | cancellation provenance + pre-step one-shot consume | 无模型请求，后续真实用户输入仍可恢复 |
| Specs 完整 order 由模型猜测 | 浅层 updates draft + Host 编译全部权威字段 | Schema 前置拒绝且零写入 |
| 新 `specs/` 被 Git 折叠为目录 | porcelain `--untracked-files=all` + exact allow-list | 不扩大路径授权 |
| 成功 commit 后被 8-step fence 误取消 | strategy 对齐 Task budget + terminal-only grace + receipt report | 成功效果先持久化并通知父级 |
| npm 依赖闭包缺失 | self-contained Bundle/Installer tarball | 空 Profile 安装失败即阻断 |
| 发行不可重复 | `SOURCE_DATE_EPOCH` + 双 pack hash 对比 | hash 不同即失败 |

## 真实 RC.2 纵向证据

发布 E2E 从两个 tarball 在临时空 DSH Home 中安装 Web Profile，使用官方
`runProfile` 三次启动：

1. Loader 激活 Bundle Host 与 browser module，发现并挂载 `military`；
2. 修改 Settings，重启后读取同一 revision；
3. 执行真实 Tool 和 continuable Worker；
4. 创建 Mission/Task，在重启前后验证重复 command durable 幂等；
5. 提交伪造 observed call，Verifier 拒绝并转入 Rework；
6. 提交实际宿主观察的 Worker evidence，Verification 接受；
7. 在隔离 worktree 中生成 Candidate，经 regression 后受控集成到本地 main；
8. 再次完整重启，恢复 Mission Ledger、Task、Settings 和 Web Client graph。
9. 验证 continuable child 请求头保留 scoped `report`，普通报告可恢复已结束 turn
   的父 General，并验证显式取消的 settlement-only wake 不消耗父模型请求。

确定性测试不请求外部模型服务；外部 Provider 网络与凭据属于部署验收。

## 发布门禁

```bash
DSH_RC2_ROOT=/absolute/path/to/deepseek-harness \
  pnpm release:verify
```

该命令覆盖 frozen install、生成物、strict 与 exact RC.2 typecheck、构建、测试、
故障恢复、semantic audit、review、文档验证、13/13 pack/publint、双 pack
可重复性、校验和、空 Profile 安装、Loader 激活和重启 E2E。任一失败都不会
生成“全部通过”的最终版本报告。
