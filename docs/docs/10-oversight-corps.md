# 督战队、监督控制器与完成联锁

## 1. 设计边界

“督战队”在软件中是质量保障与安全监督，不包含惩罚或强制人格判断。建议产品允许显示中性名称“监督与质量保障部”。

它由两部分组成：

- **Oversight Controller**：确定性 Harness 服务，拥有状态与权限控制；
- **Inspector Agent**：只读模型，识别语义矛盾、模糊、谎报和异常模式。

## 2. 为什么不能只用监督 Agent

模型无法保证：

- 抢在目标 Agent 完成前运行；
- 看见所有真实工具事件；
- 永不幻觉；
- 正确处理竞态；
- 有权限且安全地冻结。

因此实时强制必须发生在 Harness hook 与领域状态机中。

## 3. 监控范围

- Worker；
- Engineer；
- 可选地对 Advisor 的权限/证据做审计；
- 不读取不必要的模型私有 reasoning；
- 读取 Task Order、Session Events、Tool Calls/Results、Artifact、Diff、Git receipt、Candidate/Blocker。

## 4. 确定性异常

直接触发拒绝或冻结：

- 无 Candidate/Blocker 却结束；
- 声称工具调用但无 durable event；
- 调用禁止工具；
- 写 forbidden path；
- Task Version 过期仍写；
- Artifact hash 不匹配；
- Engineer 远端 Git/非 main/历史重写；
- Worker 写 specs；
- reasoning 为 off；
- 企业 API grant 越权；
- 使用已隔离 Tactical Skill；
- 被冻结后继续请求步骤或写工具。

## 5. 语义异常

Inspector Agent 可发现：

- 输出与工具结果相矛盾；
- 结论存在未标记歧义；
- 只覆盖验收条款字面而违背目标；
- 反复重试无信息增益；
- 把 warning 写成 success；
- 省略关键限制；
- Guidance 被错误理解；
- 文档描述与实际 Diff 不一致。

Inspector 输出结构化 Finding，并引用证据。

## 6. 完成联锁

所有执行 Agent 在完成前必须调用：

```text
military_submit_candidate
或
military_submit_blocker
```

联锁流程：

1. identity/task/version/attempt；
2. 幂等；
3. 工具声明对账；
4. Artifact 验证；
5. 路径和副作用审计；
6. Acceptance Clause 覆盖；
7. 确定性 Verifier；
8. 按策略调用 Inspector；
9. 聚合 disposition；
10. CAS 写入状态。

`concludeTurn()` 只结束 Turn，不代表接受。

## 7. 冻结机制

### 冻结动作

1. Ledger 写 `oversight/freeze-requested`；
2. Agent authoritative state → FROZEN；
3. 取消活动 Turn，保留 Inbox；
4. `agent/pre-step` 拒绝后续步骤；
5. Tool Guards 拒绝写；
6. 保存环境与工作区快照；
7. 创建 Inspection Report；
8. 通知 Staff。

### 冻结后的只读能力

可允许受控只读查询以协助调查，但不得让原 Agent继续修改项目。若信任已失，直接创建替代 Agent。

## 8. Staff 修正闭环

Staff 根据 Inspection Report 输出 Correction Disposition：

- `CORRECTION_RETRY`；
- `REISSUE_TASK`；
- `REPLACE_AGENT`；
- `REPLAN_WAVE`；
- `STRATEGIC_ESCALATION`；
- `TERMINATE`。

Harness 校验后 release/replace。原 Agent 无权自行“解释后解冻”。

## 9. 误报控制

- 确定性规则分 critical/blocking/warning；
- 语义 Inspector 不能覆盖确定性 pass/fail；
- 低风险语义异常可进入 Rework 而非 Freeze；
- 记录 false positive/false negative；
- 规则版本化；
- 支持 dry-run 和 sampled inspection；
- 用户可查看冻结证据和覆盖风险。

## 10. 性能

实时路径只运行廉价确定性检查。昂贵 Inspector 在以下情况运行：

- Candidate 提交；
- 异常信号；
- 高风险 Task；
- 抽样审计；
- 工兵 commit 前。

不得让每个 Token 触发一个监督模型调用。

## Preset 与模板审计

Oversight 新增检查：

- 当前 Agent 的 actual preset 与 MilitarySessionBinding 一致；
- 子代理 template revision 和 request/header 的 effective model/reasoning 一致；
- 达上下文阈值后存在 CompactionAttempt；
- compaction null/failure 没有被标记为 success；
- 普通会话没有 Military event、tool 或 freeze；
- Examiner、Chief 和提炼 Agent 没有越过只读/生成权限。

## 0.3.0：Policy revision、Workspace 和预算监督

督战新增对账：

- Agent 实际 provider/model/reasoning 是否符合绑定；
- Tool/Permission/API Profile revision 是否匹配；
- Workspace lease 与写路径；
- Candidate Patch 是否来自当前 base snapshot；
- 预算 reservation 是否存在；
- General 模型切换是否错误传播到 child；
- 来源撤回后是否仍使用已隔离战术。

冻结只作用于目标 Military Agent/Task，不作用于同 cwd 的普通 DSH Session。Inspector 看不到隐藏 reasoning，只对 durable request/tool/artifact/event 事实做判断。
