# ADR：隔离 Worktree、Candidate Patch 与受控集成

- 状态：Accepted
- 日期：2026-08-19
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

并行 Worker 直接写主工作树会污染基线并造成不可证明合并。

## 决策

Worker 在隔离 Workspace 执行，验收后由确定性 Integration Executor 将 Patch 应用到本地 main。

## 后果

增加 Snapshot、Lease、Patch、Order、Receipt 和 Git/DB Saga。

## 拒绝的替代方案

- 依赖模型自然语言自律；
- 静默降级或覆盖旧事实；
- 只在 UI 层实现而不建立 Host 权威边界。
