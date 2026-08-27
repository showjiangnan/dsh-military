# 58. Worker Workspace 与子代理创建运行时

## 1. Worker 准入

Worker 必须携带明确 `taskId`。Host 读取 Task Order 并验证：

- Task 属于当前 Mission；
- assignedRole 为 `worker`；
- local `main` 快照 clean；
- read/write/forbidden paths 已冻结；
- 预算和模板可实例化。

缺少任一条件时不创建 Agent。

## 2. Workspace Snapshot

Snapshot 包含：

```text
repository/head/branch/tree
working-tree dirty hash
tracked-file manifest Artifact
environment Artifact
createdAt
```

根工作树脏时拒绝 Worker lease，防止 Candidate 基线包含未归属的用户变更。

## 3. lease 和 worktree

WRITE lease 创建 detached Git worktree：

```text
$DATA_ROOT/workspace-state/worktrees/<leaseId>
```

Worker child 的 RC.2 `meta.cwd` 指向该目录，不指向父 Agent 工作目录。Tool/Permission Pipeline 仍按 Task path scope 二次校验。

## 4. immutable binding

Workspace 分配写入 `AgentExecutionBinding.workspace`：

```text
leaseId
snapshotId
taskId
taskVersion
executionRootHash
```

绑定在 `agents.create()` 和第一个 prompt 之前持久化。子 Session 还记录 `military/workspace-assigned`，用于 UI、审计和恢复。

## 5. Candidate Patch

Worker 调用提交工具后：

- 读取实际 Git status；
- 验证所有 changed paths 在 write scope 且不命中 forbidden paths；
- 生成 binary/full-index patch；
- 把 Patch 作为内容寻址 Artifact 保存；
- 生成 `CandidatePatch` 和 SHA-256；
- Candidate 只引用 Patch，不直接改 local `main`。

## 6. 受控 Integration

Harness Integration Executor：

1. 要求 local `main` clean；
2. 验证 expected HEAD/tree；
3. 应用已验收 Patch；
4. 运行全局回归；
5. 成功后 local-main commit；
6. 写 `IntegrationReceipt`；
7. 失败时回滚到 beforeHead。

唯一允许的 `reset --hard` 是以上 clean-main 事务回滚，代码审查会拒绝其他位置。

## 7. 释放

- child 创建失败：Spawner 释放 lease；
- child 正常/异常 dispose：Host 在 `finally` 中释放 lease；
- Host 关闭：逐个调用统一 release path；
- Worktree remove 失败：保留审计错误，后续清理器可重试；
- 释放不会删除 Candidate/Artifact/Ledger。

## 8. 非 Military 同工作区会话

普通会话不会加入 Military Workspace lease 表，也不能被 Military Oversight 冻结。若它修改物理工作树，Military 在下一 Snapshot/Integration 检测 dirty/head/tree drift，并暂停当前事务；Military 不控制该普通会话。
