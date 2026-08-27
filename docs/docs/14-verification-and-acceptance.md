# 外置验收、证据与两阶段完成

## 1. 两个不同的 Gate

### Completion Gate

判断 Task 是否满足交付条件：

```text
ACCEPTED
REWORK
BLOCKED
FROZEN
STRATEGIC
HUMAN_REVIEW_REQUIRED
FAILED
```

### Escalation Gate

判断未完成但有价值的进展是否值得参谋指导：

```text
ADMISSIBLE
MISSING_EVIDENCE
DUPLICATE_REQUEST
CHEAP_RETRY_AVAILABLE
STRATEGIC_ESCALATION
BUDGET_EXHAUSTED
POLICY_DENIED
```

Task 可同时是 `Completion=REWORK/BLOCKED` 与 `Escalation=ADMISSIBLE`。

## 2. Acceptance Contract

每个 Task 在派发前冻结：

- Clause ID 与可测描述；
- severity；
- Verifier ID；
- Evidence Kind；
- pass condition；
- regression checks；
- forbidden effects；
- ambiguity 是否需人工；
- minimum evidence coverage。

执行 Agent 无权修改。任何修改产生新版本和 Task Version。

## 3. Candidate 是提案，不是结果

```text
Worker proposes Candidate
→ Harness verifies
→ Harness commits Accepted Event
```

Candidate 包含 output、evidence、tool calls、acceptance mapping、skill usage、environment、changed paths、limitations 和 idempotency。

## 4. Evidence Graph

每个 claim 映射到一个或多个：

- durable tool call/result；
- content-addressed Artifact；
- Git commit/tree/diff；
- API receipt；
- Mission/Session Event；
- 明确用户授权。

模型自然语言不能单独作为 critical clause 的证据。

## 5. 验收管线

```text
Schema
→ Identity/Task/Version/Attempt
→ Idempotency
→ Tool claim reconciliation
→ Artifact integrity
→ Path/permission/side-effect audit
→ Clause evidence coverage
→ Deterministic verifiers
→ Regression suite
→ Optional semantic inspector
→ Aggregate disposition
→ CAS state transition
```

## 6. Verifier 类型

- Schema/contract；
- compiler/type checker；
- unit/integration/e2e test；
- linter/static analysis；
- file/diff/path policy；
- database/query invariant；
- browser visual/accessibility；
- security scanner；
- API read-after-write；
- Git receipt；
- documentation/traceability；
- independent model judge，仅用于无法确定性表达的语义条款。

## 7. Judge Agent 规则

- 不与执行 Agent 共享隐藏 reasoning；
- 读取结构化 Candidate 和真实 Artifact；
- 输出 clause-level verdict 和证据；
- 无法判断时必须 `HUMAN_REVIEW_REQUIRED`；
- 不能覆盖确定性失败；
- 模型/Prompt/版本必须记录；
- 高风险场景考虑不同模型或多 Judge，但仍不能替代外部测试。

## 8. 完成联锁与 turn-stopping

`military_submit_candidate` / `submit_blocker` 是正常结束路径。若 Agent 试图无提交结束：

- `agent/turn-stopping` 检查 Task authoritative state；
- 拒绝完成或追加纪律提醒；
- 多次违规触发 Oversight Freeze；
- 不允许靠最终 Assistant Message 绕过工具。

## 9. 验收决定

### ACCEPTED

所有 critical/required 条款满足，回归通过，版本有效，副作用合规。

### REWORK

可局部修复，保持 Task Version，创建新 Attempt；Acceptance 不变。

### BLOCKED

缺少外部决策、数据或战术；进入 Escalation Gate。

### FROZEN

存在不可信、越权或严重一致性异常。

### STRATEGIC

需要改变目标、架构、用户授权或 Direction。

### HUMAN_REVIEW_REQUIRED

自动系统无法安全判断，必须呈现证据和未决条款。

## 10. Wave 级验收

单 Task 接受不代表 Wave 完成。Barrier 还检查：

- 集成行为；
- 跨 Task 接口；
- 回归；
- critical Oversight；
- Radio 状态；
- specs commit；
- 风险和用户约束；
- Tactical Report。

## 11. 验收质量自身评估

追踪：

- false accept；
- false reject；
- clause coverage；
- flaky verifier；
- Judge disagreement；
- 验收延迟与容量；
- 被后续回归推翻的 accepted result。

Verifier 版本也是复现 Task 结果的必需信息。

## 0.3.0：Acceptance 与 Integration 分离

Task Candidate 的 `ACCEPTED` 表示在隔离 snapshot 上满足 Acceptance Contract，不自动表示已进入项目主线。最终交付状态分为：

```text
CANDIDATE_ACCEPTED
INTEGRATION_PENDING
INTEGRATED
INTEGRATION_CONFLICT
REGRESSION_FAILED
STALE
```

Integration 必须验证 expected HEAD/tree、Patch hash、Policy/Verifier revision 和全局回归。只有 `INTEGRATED` 才能推进依赖该代码的下游 Wave；纯研究/报告 Task 可定义无 Integration 的完成路径。
