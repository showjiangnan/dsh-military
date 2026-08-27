# 64. 可观测性与决策链绩效评估

## 1. Trace 结构

```text
Request / WorkflowObligation
  → Mission → Direction → Wave → Task
  → Attempt → Activation → Dispatch
  → Model/Tool → Candidate → Verification → Integration
```

稳定属性包括 Request/Obligation、Mission/Direction/Wave/Task/version、
Attempt/Activation/Dispatch、Template revision、observed route/capability profile、
reasoning、战术、Verifier、Workspace Snapshot/lease、Candidate/Integration、
operation/outbox、Token、延迟和重试。Session Snapshot 只证明历史存在；运行中状态
必须由新鲜 start/heartbeat receipt 证明。

Prompt、Secret、完整工具载荷和用户内容默认不进入遥测；只有显式策略允许且完成脱敏时才能记录。

## 2. 评估对象

绩效不只按 Agent 名称统计，而按完整配置组合：

```text
templateRevision + model + reasoning + promptVersion
+ tacticVersion + verifierVersion + task difficulty
```

报告分别评价 Planning、Routing、Execution、Verification 和 Integration，避免把错误计划或薄弱 Verifier 归咎于 Worker。

比率必须保留 numerator、denominator 和 `AVAILABLE/N_A/INCOMPLETE` 状态；权威
Mission completion、Specs、Integration 或 parent wake 事件缺失时不得填 0。成本
只使用 observed exact route/version 的不可变 price snapshot，未知价格不进入
Pareto。

## 3. 实验

Template、Prompt、Router、Tactic 和 Verifier 变更使用 Shadow、Canary、Matched Control 或 A/B。Stable 晋级必须有最小样本、置信区间、负面指标和 rollback。

Flash 发布级验收按 exact configuration × scenario 独立统计，`N≥50`，并同时满足
首次工具命中点与 E2E 完成点的点估计/Wilson 下界以及四项零容忍安全硬门。确定性
Host 测试与真实 Provider 样本分栏，前者不能扩充后者 N。
