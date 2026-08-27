# 架构效能评测协议

## 1. 对照组

- A：单 General Agent；
- B：普通 Swarm，无外置验收/电台/记忆；
- C：dsh-military，无私有战术；
- D：dsh-military + 私有战术；
- E：D + 不同任务粒度策略。

## 2. 控制变量

- 相同用户目标和仓库快照；
- 相同模型/供应商配额；
- 相同外部工具和网络权限；
- 相同最终 Verifier；
- 随机化运行顺序；
- 记录模型 fallback 和故障。

## 3. 主要指标

- 最终验收通过率；
- 首次通过率；
- 错误接受率；
- 人工介入率；
- 端到端时间；
- 总 Token/调用/工具成本；
- 回归缺陷率；
- specs 追踪覆盖；
- 未授权动作数。

## 4. Tactical Guidance Lift

```text
lift = P(accepted | admissible blocker + guidance)
     - P(accepted | comparable blocker without guidance)
```

必须按 Task Type、复杂度、模型和环境分层。没有可比对照时只报告观察相关性。

## 5. 任务粒度实验

比较：

- coarse；
- minimum independently verifiable；
- ultra-fine。

同时统计成功率和协调成本，避免只看单 Task 成功。

## 6. 报告要求

- 样本量；
- 置信区间；
- 失败和排除样本；
- 模型/配置版本；
- Verifier 版本；
- 数据快照；
- 可重放事件和 Artifact。

## 0.3.0 Dataset 与复现要求

每次运行必须先生成 `EvaluationDatasetManifest`，冻结纳入/排除、Task 难度、missingness、模型/模板/Policy revision、去标识化、权重、rubric 和 source hash。Examiner/Chair 只消费该数据集，不自行查询“更多有利样本”。

高影响结论使用独立双 Examiner；分歧、置信区间、最小样本和申诉流程见 `EVALUATION-STATISTICS-PROTOCOL.md`。报告建议不能自动改配置。
