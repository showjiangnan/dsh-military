# ADR-0008：记忆采用事实—报告—模型文档三阶段

- 状态：Accepted
- 日期：2026-08-18

## 背景

直接让 Memory Agent 阅读全部日志容易遗漏、幻觉并混入未验收内容。

## 决策

1. 不可变 Mission Ledger；
2. Harness 生成确定性 Tactical Report；
3. Trajectory/Effectiveness/Museum Agent 生成可读文档；
4. Harness 做来源覆盖和事实一致性验证后才交给 General。

## 后果

模型摘要可重建、可验证，但需要 Evidence Index 和覆盖检查器。
