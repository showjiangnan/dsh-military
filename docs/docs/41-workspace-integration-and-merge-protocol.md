# Workspace 隔离、补丁与集成协议

## 1. 决策

Thinking Worker 不直接在受控本地 `main` 上并行写入。每个写 Task 使用独立 Workspace Lease 和快照，产出 Candidate Patch；只有 Harness Integration Executor 能把已验收补丁应用到受控 `main`。

```text
Task Order
→ Workspace Snapshot
→ isolated worktree / copy-on-write sandbox
→ Worker Candidate + CandidatePatch
→ Verification on frozen snapshot
→ ACCEPTED
→ Integration Queue
→ apply on controlled local main
→ global regression
→ Integration Receipt
→ Engineer specs maintenance
→ local main commit checkpoint
```

## 2. Workspace Snapshot

[`WorkspaceSnapshot`](../schemas/workspace-snapshot.schema.json) 固化：

- tenant/workspace identity；
- path hash；
- repository id、HEAD、branch、tree；
- dirty-state hash；
- 文件清单 Artifact；
- 环境 Artifact。

Task Context 引用 Snapshot ID，不复制不受控的“当前目录状态”。

## 3. Lease

[`WorkspaceLease`](../schemas/workspace-lease.schema.json) 绑定：

- Mission、Task 和 version；
- Agent identity；
- Snapshot；
- READ/WRITE；
- path scope；
- lease version 和 expiry。

同一 path/resource 的冲突写 Lease 不能同时激活。普通非 Military 会话不受 Military Lease 阻塞；如果它修改文件，Military 通过新的 snapshot/hash 检测环境漂移。

## 4. Candidate Patch

Worker 提交 [`CandidatePatch`](../schemas/candidate-patch.schema.json)：

- base snapshot；
- patch Artifact 和 hash；
- changed paths；
- apply mode；
- preconditions。

Patch 不等于接受；Candidate Verification 必须同时校验：

- patch 可在 base snapshot 干净应用；
- changed paths 在 Task Scope；
- Worker 没有修改 `.git`、specs 或禁止路径；
- 测试、类型、lint 和策略通过；
- Artifact hash 与实际内容一致。

## 5. Integration Order

ACCEPTED 后 Harness 创建 [`IntegrationOrder`](../schemas/integration-order.schema.json)：

- expected local-main HEAD/tree；
- candidate patch；
- 目标 `main`；
- 冲突策略；
- 全局 verifier profiles；
- Harness 授权者。

Worker、Advisor 和 Engineer 不能自行创建或执行该 Order。

## 6. Integration Executor

Executor 是确定性受限组件，不是自由模型角色。它只能：

1. 获取 local-main integration lease；
2. 检查 expected HEAD/tree；
3. 创建临时集成 worktree；
4. 应用 patch；
5. 运行指定全局回归；
6. 成功时生成 commit；
7. 原子更新受控 local main；
8. 写 [`IntegrationReceipt`](../schemas/integration-receipt.schema.json)。

禁止 push、force、rebase public history、任意脚本注入和绕过 verifier。

## 7. 冲突

若 HEAD/tree 已变化或 patch 冲突：

```text
IntegrationReceipt.disposition = STALE / CONFLICT
→ IntegrationConflictReport
→ invalidate old integration order
→ create rework or join task
```

模型可建议冲突解决，但必须在新 Workspace Snapshot 上产生新 Candidate。

## 8. Specs 与 commit

代码 Integration 与工兵 specs 更新是两个不同阶段：

- Integration Executor 落地已验收代码；
- Engineer 读取 Integration Receipt 和实际 Diff；
- Engineer 维护 specs/traceability；
- Engineer 只在本地 main 创建维护 commit；
- Wave Barrier 同时要求代码回归和 specs commit。

若策略要求代码和 specs 同一 commit，可由 Integration Executor 在 Engineer 产出已验收 specs patch 后组成一个 join integration order；仍不能让 Worker 直接 commit main。

## 9. 崩溃恢复

- patch applied、Ledger 未写：根据 integration marker 和 Git commit trailer补写 Receipt；
- Ledger 写 queued、尚未应用：幂等重试；
- regression 失败：丢弃临时 worktree，不移动 main；
- main 已移动、Artifact 写失败：从 Git 对象重建 Artifact；
- 进程重启：按 Integration Order 和 repository marker 恢复。

## 10. 验收条件

- 未验收修改从不进入 local main；
- 并行 Worker 不共享写工作树；
- stale patch 不静默重放；
- 全局回归失败不移动 main；
- 普通 DSH 会话修改只造成漂移检测，不被 Military 冻结；
- 每个接受 Task 可追踪到 Snapshot、Patch、Verification 和 Integration Receipt。

## 11. Specs 工作区控制面

RC.2 没有外部 Client 可调用的原生目录选择 seam。`militaryWorkspace/snapshot`
因此只从当前租户 `military_session_bindings` 的绝对 workspace 产生不透明
`workspaceId`；Client 不能提交路径。

`INSPECT_WORKSPACE(workspaceId)` 重新 realpath 并验证 root hash，读取实际 Git
HEAD/branch/tree/porcelain 状态，再与 Workspace snapshot/lease、Task path
policy、Candidate、Integration order/receipt 组合。返回：

- canonical root 和 hash；
- dirty/untracked 与 rename destination；
- `READ_WRITE/READ_ONLY/FORBIDDEN/SPECS_DEFAULT/UNSCOPED` 路径；
- live lease/worktree；
- Candidate/Integration/receipt；
- 按实际角色和 Task 生成的相对路径示例。

目录中不存在或已不可访问的 ID、symlink escape 和跨 Session 根均失败关闭。
该页面是执行链的只读 projection，不授予 Lease、不改 Git、不创建 Workspace。
