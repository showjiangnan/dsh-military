# ADR-0005：工兵独占 specs 常规写入并限定本地 main

- 状态：Accepted
- 日期：2026-08-18

## 背景

多个 Agent 修改需求和架构文档会造成真源分裂；任意 Git 命令会带来远端写、历史重写和分支混乱风险。

## 决策

- 只有工兵可执行常规 `specs/**` 写入；
- 无 Git 时初始化本地 `main`；
- 每轮维护必须形成本地 main commit；
- 工兵禁止 push、非 main、历史重写和任意 Git shell；
- 远端或其他分支操作必须有用户授权的 Promotion Order，并由将军专属路径执行。

## 后果

需要受限 Git Provider、路径 allowlist、worktree 策略和 commit receipt 对账。
