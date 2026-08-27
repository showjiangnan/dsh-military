# 后勤保障与研究部

## 1. 组织边界

该部门固定只有三个模型 Agent。调度、幂等、来源验证和写入由 Harness 服务负责，不算第四个 Agent。

1. 战术轨迹记忆总结 Agent；
2. 战术效能评估 Agent；
3. 战术博物馆 Agent。

## 2. 共同输入原则

三个 Agent 不直接相信 Worker/Advisor 自报。输入优先级：

1. Accepted/Rejected Mission Events；
2. Verification Receipts；
3. Artifact/Git/Tool Evidence；
4. 确定性 Tactical Report；
5. 模型生成说明，作为辅助判断。

## 3. 战术轨迹记忆总结

### 触发

- Wave 完成；
- Direction 完成；
- General 请求；
- Mission 完成；
- 重大 Incident 后。

### 输入

Harness 先生成确定性 Tactical Report：已接受 Task、Artifact、决策、Blocker、Skill 使用、指标和 Event ID。

### 输出

```text
Mission State
Confirmed Facts
Accepted Progress
Decisions and Rationale
Open Blockers
Risk Changes
Reusable Tactical Lessons
Recommended Strategic Actions
Evidence Index
```

每个 claim 带 sourceEventIds、Artifact、confidence 和 validityScope。

### 验证

Harness 检查：

- 是否覆盖所有关键 accepted events；
- 是否引用不存在/未接受事实；
- 是否把 Candidate 写成 accepted；
- 是否遗漏 critical risk；
- 是否混合 Task Version。

通过后才进入 General Session。

## 4. 战术效能评估

### 强制触发

每次 General 成功触发 compaction 后，以 `compactionId` exactly-once 创建评估任务。评估在 compaction transaction 之外异步执行。

### 先统计、后解释

Harness 先计算：

- Task assigned/attempted/accepted；
- first-pass/final acceptance；
- rework；
- false completion；
- guidance request/delivery；
- Skill 使用级别；
- model/reasoning/token/latency；
- verifier 和 Inspector 结果；
- 任务粒度。

Effectiveness Agent 再解释模式、局限和假设。

### 归因等级

```text
none
correlated
incremental
causal-supported
```

单次“用了战术并成功”只能支持相关。强因果需要可比对照、随机化或足够严谨的准实验。

### 输出用途

- General 了解系统效能；
- Staff 调整路由、任务粒度和模型；
- Museum 选择研究对象；
- 自动隔离高风险低效版本的候选信号，但不直接执行发布。

## 5. 战术博物馆

### 归档

- 将 Tactical Memory、Effectiveness、Skill Version 和代表性 Artifact 建立不可变档案；
- 保留适用场景、环境和失败边界；
- 归档不等于默认可用。

### 二次研究

Museum 可：

- 比较多个 Mission 的成功轨迹；
- 发现重复诊断/步骤；
- 补充 Failure Mode；
- 合并或拆分战术；
- 调整前置/排除；
- 设计新的 Verifier；
- 提出下一版本 DRAFT。

### 推演和测试

```text
Archive evidence
→ Hypothesis
→ DRAFT tactic
→ Static/schema/security review
→ SIMULATION
→ CANARY
→ TESTING
→ approval → STABLE
```

当未来 Task 匹配时，只能按生命周期投放测试版，且 Worker/Advisor 明确知道其为 Canary，并有停止/回滚。

## 6. General Memory 投递

- 常规 Wave Memory 使用 quiet 投递；
- critical risk、预算耗尽、关键路径阻塞可 wakeup；
- General 接收摘要与证据索引，不接收所有子 Agent raw transcript；
- Memory 更新采用 boundary/ref，避免重复注入；
- 新 Memory 不删除 Ledger 事实。

## 7. 防止知识闭环退化

- 模型不能评估自己的隐藏推理质量；
- 同一个成功案例不能重复计入多个压缩窗口；
- 失败和 negative effects 必须进入 Museum；
- Skill 使用的未选择结果不能被写成成功经验；
- 指标不以自报完成率为依据；
- 版本隔离后停止新分配并回归检查已接受结果。

## 与军事评估委员会的职责分离

Effectiveness Agent 继续评估 Tactical Skill/Guidance 的贡献；军事评估委员会评估 Agent Template revision。两者共享确定性数据集服务，但不能互相替代：

- Skill 成功不等于 Agent 普遍优秀；
- Agent 高通过率不证明某 Skill 有因果贡献；
- Museum 可以读取委员会发现的重复 failure pattern，但只能提出 DRAFT/Canary；
- Committee 可以建议调整模型、Thinking、Task 粒度或 Context Policy，但不能直接修改 ACTIVE 模板。

## 0.3.0：数据集、来源与预算

Trajectory/Effectiveness/Museum 只读取已认证事件和拥有访问授权的 Artifact。研究工作属于可降级非关键队列，受独立预算和数据分类限制。

Effectiveness 记录 General route、Agent Template revision、Task 难度和 Verifier strength；Museum 提案必须保留 Tactical Source 派生链。任何模型摘要都不能替代 Evaluation Dataset Manifest 或确定性指标。
