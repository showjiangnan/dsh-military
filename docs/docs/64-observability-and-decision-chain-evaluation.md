# 64. 可观测性与决策链绩效评估

## 1. Trace 结构

```text
Mission → Direction → Wave → Task → Activation
        → Model/Tool/Verification → Integration
```

稳定属性包括 Mission/Task/Activation、Template revision、模型、reasoning、战术、Verifier、Workspace Snapshot、Candidate、Token、延迟和重试。

Prompt、Secret、完整工具载荷和用户内容默认不进入遥测；只有显式策略允许且完成脱敏时才能记录。

## 2. 评估对象

绩效不只按 Agent 名称统计，而按完整配置组合：

```text
templateRevision + model + reasoning + promptVersion
+ tacticVersion + verifierVersion + task difficulty
```

报告分别评价 Planning、Routing、Execution、Verification 和 Integration，避免把错误计划或薄弱 Verifier 归咎于 Worker。

## 3. 实验

Template、Prompt、Router、Tactic 和 Verifier 变更使用 Shadow、Canary、Matched Control 或 A/B。Stable 晋级必须有最小样本、置信区间、负面指标和 rollback。
