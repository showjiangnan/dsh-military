# ADR-0010：计划版本化并使用 Wave Barrier

- 状态：Accepted
- 日期：2026-08-18

## 背景

并行 Agent 会在环境和目标变化后继续执行旧命令；部分完成结果提前进入后续任务会放大错误。

## 决策

Direction、Wave、Task 和 Acceptance Contract 均版本化。Wave 在进入时冻结计划和环境；只有所有必需 Task、集成验收、specs commit 和风险检查通过后才退出。

## 后果

旧 Candidate/Guidance 自动 stale；返工通过 attempt 状态机而不是 DAG 环实现。
