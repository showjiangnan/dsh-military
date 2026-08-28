# 模型路由与 Thinking 策略

## 1. 目标

本版 `dsh-military` 以任务成功率优先，不再以关闭 Worker Thinking 节省成本为核心。仍不能简单地对所有角色固定 `max`，因为推理预算需要与：

- 任务风险；
- 语义复杂度；
- 验收歧义；
- 上下文规模；
- 工具能力；
- 历史通过率；
- 延迟预算；

共同匹配。

## 2. 角色默认策略

| 角色 | 默认 | 可选范围 | 禁止 |
|---|---|---|---|
| General | high | high/max | off |
| Lead Advisor | high | high/max | off |
| Specialist Advisor | high | low/high/max | off |
| Worker | high | low/high/max | off |
| Engineer | high | high/max | off |
| Oversight Inspector | low | low/high | 写权限 |
| Trajectory | high | high/max | 未验收输入 |
| Effectiveness | high | high/max | 只靠模型估计指标 |
| Museum | max | high/max | 直接发布 STABLE |

这些名称表达 Military 工作负载强度，不是跨 Provider 的固定 wire enum。实际
模型若不支持这些名称，由 DSH exact adapter 映射到声明的 default/首选能力；
模型不公开 reasoning 控制时省略该字段，并在 `request/header` 记录最终事实。

## 3. Task-to-Reasoning Policy

```text
low:
  明确局部任务
  强验证器
  决策很少
  低风险
  小上下文

high:
  多文件/多工具
  中等未知依赖
  需要诊断或整合
  验收明确但路径不明显

max:
  战略分解
  多参谋冲突合成
  复杂根因
  高风险安全/架构
  Tactical Museum 二次研究
```

`max` 不是奖励，也不是失败后的默认无限升级。先判断任务是否应进一步拆分、补充证据或换专业参谋。

## 4. 路由决策数据

```yaml
role:
taskType:
riskClass:
complexityVector:
requiredModalities:
requiredTools:
contextBytes:
providerConstraints:
dataResidency:
latencyBudget:
reasoning:
  requested:
  minimum:
  allowFallback:
```

## 5. 强制与审计

- Agent Scope 的 `agent/request` policy 写入候选 reasoning；
- LLM adapter materialize effective value；
- DSH `request/header` 是审计真源；
- Oversight 对角色规则和有效值对账；
- 任何非法降级在请求前拒绝；
- 任务记录 `provider/model/reasoning`，用于效能分析。

Prompt 中写“请认真思考”不构成策略。

## 6. Fallback

允许 fallback 必须同时满足：

1. 替代模型满足数据和工具要求；
2. 支持最低 reasoning；
3. 已在该 Task 类型通过基准；
4. 不改变用户授权边界；
5. 写入 `model/fallback` 事件；
6. 高风险任务可配置为暂停而非 fallback。

禁止：

- 从 Thinking 模型静默降到 off；
- 从企业内模型切到外部模型处理敏感数据；
- 仅因队列长绕过安全 Verifier；
- 把模型名硬编码为能力等级。

## 7. 上下文策略

Worker 应接收最小充分 Task Context，而不是完整 Mission 历史。上下文分为：

- immutable order；
- accepted facts；
- required specs；
- artifact refs；
- tactical directive；
- environment snapshot；
- recent observations。

参谋和将军可看到更宽投影，但仍不应读取所有原始推理 Token。以事件、Artifact 和已认证摘要交流。

## 8. 评测

每个模型/推理强度组合按 Task Type 记录：

- first-pass acceptance；
- final acceptance；
- rework count；
- tactical guidance lift；
- false completion；
- tool-use compliance；
- token/latency；
- regression rate；
- human intervention。

模型路由根据真实外置验收更新，不依据供应商宣传或单次印象。

## 0.2.0 Template 与上下文策略

非 General 角色的路由策略从 `AgentTemplateProfile` 解析。每个实例持久记录 template revision、effective provider/model/reasoning 和 fallback 事实。

上下文策略按角色配置 budget 与 trigger。达到阈值时发起一次安全 compaction attempt；如果模型 context window 小于模板预算，使用解析后的更小 effective budget。详情见[部门 Agent 模板与上下文策略](34-department-agent-templates-and-context-policy.md)。

新增角色默认：

| 角色 | 默认 reasoning |
|---|---|
| Chief of Staff | high/max |
| Evaluation Examiner | high |
| Evaluation Chair | high/max |

委员会模型应与被评估模板分离并记录 rubric version。

## 0.3.0：General 与子代理路由优先级

### General

```text
用户当前 Session 显式 provider/model
  > military preset General default
  > 无其他隐式 fallback
```

“优先级更高”只表示候选来源；最终必须经过：

```text
actual preset=military
root role=general
DSH live exact route
catalog-derived ModelCapabilityProfile
adapter-owned reasoning translation
dynamic context/output limit
DataResidencyPolicy
Permission/API compatibility
ResourceBudget reservation
RC.2 adapter prepareCall
```

用户切换后生成 `ModelSelectionReceipt`。切换不重写历史，下一次 General 请求
才采用；只有 exact route 不在 DSH live adapter 中或 adapter 最终拒绝请求时
失败，旧 route 不变。`request/header` 是 effective route 审计真源。

### 子代理

子代理 route 来自 `AgentTemplateProfile@revision`，创建时冻结。它们：

- 不读取 General 的 Session override；
- 不因设置保存而热切；
- fallback 只允许模板明确列出且满足同等政策；
- 重新派生 Agent 才能使用新 revision；
- 评估按 template revision + provider/model/reasoning 分组。

### Context 与 Compaction

Context budget 是 Military policy，不直接等同于模型 catalog context window。有效预算取：

```text
min(template/preset budget, resolved model context, deployment safety cap)
```

达到 trigger 必须创建可审计 `CompactionAttempt`。无安全区间或摘要不缩小则暂停/handoff，不能继续溢出。General 切换到更小上下文模型前应先评估当前 surface；无法安全适配则拒绝切换。

## 0.9.0-alpha.27 能力目录与样本纪律

模型控制面把四个概念独立存储：

```text
Catalog Presence
Protocol Compatibility
Policy Eligibility
Performance Evidence
```

目录存在只证明 route 可发现；不得由此虚构 tool calling、reasoning、context、
residency 或 `VALIDATED`。native tool route 直接走 DSH adapter；非 native
route 只有受治理 Bridge 已启用并通过 exact canary 时才可执行。Dispatch 前绑定
immutable capabilityProfileId/adapter revision，并写 route、分类、驻留、脱敏、
policy 与价格状态 receipt。

Settings 模型下拉不维护第二份 allowlist。Host 把 DSH live `llm.models` 与
Military capability evidence 合并为 exact-route 目录，并记录
`VALIDATED/CANARY/UNVERIFIED/INCOMPATIBLE/UNAVAILABLE/DEPRECATED`、reasoning、
tool calling、context/output、模态、价格、alias 证据和状态 revision。

DSH live 目录成员资格是模型可用性的唯一目录权威：所有官方和第三方 exact
route 默认 `available/selectable`。上述状态只描述能力元数据或绩效 Evidence，
不再充当权限。只有不在 live 目录中的历史 route 才不可选择。

固定工作台将 deterministic gate 与 Provider Session observation 分开保存；
相同 exact route/场景 N<10 或置信区间过宽时不能输出观察趋势的稳定结论；发布
acceptance 仍按 exact configuration × scenario 要求 N≥50。别名未被
request/header 证明时
标记 `ALIAS_UNPROVEN`，不得与另一个 exact model 合并。模型状态变化是单独的
受治理动作，评测运行本身不自动晋升、不自动 fallback，也不把 Pro 变成默认。
发行 acceptance 进一步要求每个 exact configuration × scenario N≥50、首次
工具/E2E Wilson 下界达标并且意外确定性错误、越权写入、假完成、重复终态全为
0；未达到时准确报告 `INSUFFICIENT_SAMPLE/FAILED`。
