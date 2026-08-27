# 可观测性、容量与效能指标

## 1. 目标

可观测性回答：

- Mission 目前处于何处；
- 哪个 Direction/Wave/Task 阻塞；
- Agent 是否真实调用工具；
- 验收为什么通过/失败；
- Advisor/Skill 是否有效；
- 模型/Thinking/任务粒度如何影响成功；
- 系统是否拥塞或越权。

## 2. Trace 层级

```text
Mission Trace
  Direction Span
    Wave Span
      Task Attempt Span
        Model Step Span
        Tool Call Span
        Verification Span
        Radio Span
        Specs/Git Span
```

关联 ID：mission/direction/wave/task/version/attempt/agent/session/request/guidance/candidate/event/artifact。

## 3. 核心指标

### 结果

- Task first-pass/final acceptance；
- false completion；
- regression；
- human intervention；
- Mission completion；
- critical invariant violations。

### 流量与延迟

- Ready/Leased/Executing/Verify queues；
- Radio queue age；
- Advisor/Verifier utilization；
- Wave cycle time；
- model/tool/verifier latency；
- compaction→effectiveness latency。

### 成本

- Tokens、requests、tool/API calls；
- cost per accepted Task/Direction/Mission；
- rework waste；
- Advisor guidance cost；
- context bytes 与 cache behavior（若 Provider 可报告）。

### 质量

- evidence coverage；
- unverified tool claim；
- stale candidate/guidance；
- Oversight findings；
- specs traceability/drift；
- Verifier false accept/reject；
- Skill contribution level。

## 4. Task 粒度指标

同时记录：

- 复杂度向量；
- Context 大小；
- 独立决策数；
- 写集合大小；
- 依赖 fan-out；
- Agent 启动和协调成本；
- 验收时间；
- 最终成功。

用数据寻找每个 Task Type 的适宜粒度，而非一个全局阈值。

## 5. Tactical Guidance Lift

```text
P(accepted | comparable blocker + guidance)
- P(accepted | comparable blocker without guidance)
```

按 Task Type、模型、reasoning、复杂度和环境分层。无对照时只报告相关性和置信度。

## 6. 容量模型

调度器读取：

- Worker slots；
- Workspace slots/locks；
- Verifier queue；
- Advisor queue；
- model/API quota；
- rate limits；
- risk-adjusted concurrency；
- reserved rework capacity。

不要在 Verifier/Advisor 拥塞时继续扩军。

## 7. 告警

- critical invariant > 0；
- Radio oldest age 超 SLO；
- stale ratio 上升；
- false completion spike；
- Freeze backlog；
- specs commit 缺失；
- compaction evaluation orphan；
- Skill negative effect；
- unauthorized attempt；
- Ledger/Artifact inconsistency；
- cost per accepted task 异常。

## 8. 日志与隐私

- 结构化日志引用 Artifact，不重复大内容；
- Secret/PII 脱敏；
- 不记录隐藏 reasoning；
- 按分类设置 TTL；
- 用户可导出审计；
- metrics 聚合避免重新识别；
- OTel exporter 默认失败不能阻断核心 Ledger，但不得泄漏数据。

## Agent Template 与委员会指标

所有子代理 telemetry 增加：

```text
templateId, templateRevision, department, role,
provider, model, reasoningEffort,
contextBudget, compactionTrigger, compactionOutcome,
actualPreset, rootSessionId, missionId
```

委员会指标目录见 [`quality/PERFORMANCE-METRICS-CATALOG.md`](../quality/PERFORMANCE-METRICS-CATALOG.md)。仪表盘必须把参与量、准确性、完成度、能力、纪律、效率和数据质量分开，禁止以单一无解释综合分替代全部维度。

## 0.3.0：路由、预算、数据集与集成指标

新增必须观测的事实：

- General route 来源：preset default 或 user session override；
- ModelSelectionReceipt、拒绝原因和 effective request/header；
- preset generation、resume disposition 和 quarantine；
- 预算 reservation/settlement、队列等待和无信息增益停止；
- Workspace snapshot、Patch size、Integration wait/conflict/regression；
- Decision Broker queue、问题等待、多标签页冲突和过期；
- Tactical source license/trust/revocation impact；
- Evaluation dataset hash、缺失比例、rubric/Examiner revision 和置信区间。

高基数字段如 Session、Task、Artifact 和 source id 不直接作为无限 OTel label；使用 trace/event 查询或受控维度聚合。usage receipt、accepted receipt 和 integration receipt 均按稳定 id 去重。

建议增加 SLO：

```text
预算 reservation p95
Decision 用户回答投递延迟
Integration queue p95
Generation resume success rate
Quarantine rate
Outbox age
Projection lag
Evaluation reproducibility rate
```
