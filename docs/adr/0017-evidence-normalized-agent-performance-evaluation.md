# ADR-0017：子代理绩效按模板 revision、证据和任务难度归一化

- 状态：Accepted
- 日期：2026-08-18

## 背景

参与量、原始通过率和模型输出长度不能公平比较不同角色。所谓“智能程度”若没有观测定义，会变成主观排名。

## 决策

军事评估委员会只读取实际 Military 会话。Harness 构建冻结数据集和基础指标；Examiner 一次评估一个模板 revision；Chair 汇总已验证 individual reports。智能指标命名为 Difficulty-adjusted Capability Index，必须附样本、置信区间和 rubric。报告包含各模板与总体两部分，建议只能创建 Canary，不能直接改 ACTIVE。

## 后果

- 评估需要跨会话索引、Job、Artifact 和访问控制；
- 小样本只能报告不足，不强行排名；
- 模板配置变化产生独立 revision；
- 统计方法和数据限制成为报告的一部分。
