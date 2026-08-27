# 子代理绩效指标目录

## 原则

- 原始活动量与有效贡献分开；
- 准确性以 Verifier、Evidence 和回归结果为准；
- 按角色、任务类型、难度和模板 revision 分层；
- 报告样本、缺失、置信区间和 rubric 版本；
- 不把输出长度、工具调用数或 Token 消耗直接解释为智能；
- Difficulty-adjusted Capability Index 只是一项经验性运营指标。

## 最低指标

| 维度 | 指标 |
|---|---|
| 参与 | eligible、assigned、consulted、accepted contribution、missions |
| 准确 | first-pass、final acceptance、claim support、tool claim、false completion |
| 完成 | completion、rework、blocker resolution、handoff completeness |
| 纪律 | freeze、forbidden action、stale submission、duplicate request |
| 能力 | difficulty-adjusted acceptance、diagnostic recovery、constraint adherence |
| 效率 | accepted outcome/token、latency、steps、compaction success |
| 数据质量 | sample、missing event、verifier coverage、selection bias |

每个指标的生产实现应有 owner、公式、输入事件、单位、空值语义和版本。

## 0.3.0 新增指标族

### Route Integrity

- General preset-default utilization；
- user override acceptance/rejection；
- unsupported reasoning rejection；
- child route drift count；
- generation resume disposition。

### Integration

- Patch accepted-to-integrated latency；
- conflict rate；
- global regression failure；
- stale base rate；
- duplicate integration prevented。

### Budget

- reserved/settled/released；
- warning/hard-stop rate；
- no-information-gain stops；
- speculative cancellation；
- authorization top-ups。

### Knowledge Supply Chain

- rights-known ratio；
- contradiction/reproduction rate；
- revoke impact size；
- post-revoke guidance prevented；
- time-to-revalidate。

### Evaluation Quality

- dataset coverage/missingness；
- difficulty strata balance；
- examiner agreement；
- report revision/appeal rate；
- reproducibility pass rate。
