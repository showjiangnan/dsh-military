# “头脑风暴”命令与用户决策对话

## 1. 产品目标

Military preset 提供一个显式入口，帮助用户把模糊想法快速收敛为可执行 Mission Intent、Direction 候选和 specs 基线。它不自动猜测用户的产品偏好，而是通过分阶段问题弹窗让用户作出高价值选择。

## 2. 命令名称兼容性

DSH 当前命令解析器的命令标识只接受小写 ASCII 字母、数字、`_` 和 `-`。因此协议级命令为：

```text
/brainstorm
```

WebUI 的本地化显示名称固定为：

```text
头脑风暴
```

用户在命令列表中看到“头脑风暴”；点击后发送 `/brainstorm`。在 DSH 尚未支持 Unicode command name 前，不把 `/头脑风暴` 伪装为已受 Host 命令注册表支持。后续若 Web composer 提供正式 alias seam，可增加中文输入别名，但领域事件仍使用稳定 id `brainstorm`。

## 3. 可用范围

命令通过 `military` preset scope 注册。只有当前根会话实际组装到 `military` 时才出现在命令列表。

- Standard/Code/Minimal 等 preset 看不到该命令；
- Military 子代理不直接接收 UI 命令；
- 已冻结或关闭的 Military 会话不能开启新 Brainstorm；
- 同一会话只允许一个 ACTIVE Brainstorm Order。

## 4. 调度流程

```text
User invokes /brainstorm
  → command handler validates Military root session
  → append brainstorm/started
  → create BrainstormOrder
  → enqueue a root General turn
  → General inspects workspace/project stage
  → Staff independently proposes decision options
  → General invokes ask_user_question
  → persist answers and rationale
  → repeat bounded decision rounds
  → General ratifies Mission Intent
  → Engineer creates/updates specs baseline
  → append brainstorm/completed
```

命令的直接 UI 文本不进入模型历史；命令处理器显式向 General 提交一条带 `BrainstormOrder` 引用的模型可见消息。

## 5. 为什么由 General 提问

DSH 的 `ask_user_question` 工具拒绝由另一个运行时 Agent 所拥有的 delegated subagent 直接向用户弹窗。因此：

- Advisor、Chief of Staff、Worker 和 Engineer 只能产生 `DecisionQuestionSet`；
- General 是用户当前交互的根 Agent，负责调用 `ask_user_question`；
- Radio Broker 或 Host Interaction Broker 只做投递、去重和审计，不能冒充某个子代理获得用户交互权。

这避免多个子代理同时弹窗和用户不知道谁在等待答案。

## 6. 决策漏斗

默认按以下阶段推进，每轮只问 1～3 个相互关联的问题：

### Phase A：目标与对象

- 谁是主要用户；
- 要解决的核心问题；
- 最重要的可观察结果；
- 哪些目标明确不在范围内。

### Phase B：约束与风险

- 时间、预算、合规和数据边界；
- 可接受的技术栈；
- 不可逆选择；
- 外部系统和权限。

### Phase C：体验与优先级

- 首个必须完成的用户流程；
- 速度、质量、可维护性之间的偏好；
- MVP 与后续方向；
- 可接受的降级。

### Phase D：技术与运营

- 部署环境；
- 可用内部 API；
- 可观测性和运维要求；
- 测试与验收方式。

### Phase E：收敛

- 参谋部推荐方案；
- 主要替代方案；
- 未决假设；
- 是否批准生成 specs 基线。

## 7. 问题设计规则

`ask_user_question` 的每个问题必须：

- 有稳定 id；
- 标题简短；
- 选项互斥或明确 `multi_select`；
- 推荐项放在第一位并标记 `(Recommended)`；
- 描述选择的实际后果；
- 提供“由参谋部推荐”“暂不决定”或自由输入；
- 不询问可通过读取项目自行发现的事实；
- 不把安全或授权选择默认掉；
- 不在一个问题里混入两个不同决策。

## 8. 交互频率与防疲劳

“多使用弹窗”不等于无限提问。默认边界：

```yaml
maxRounds: 5
maxQuestionsPerRound: 3
maxTotalQuestions: 12
```

General 每轮之后判断信息增益。以下情况结束提问：

- Mission Intent 达到完整性阈值；
- 剩余未知可通过侦察解决；
- 用户选择“采用参谋部推荐”；
- 用户选择“先生成草案”；
- 用户主动结束；
- 达到预算后生成显式假设列表。

用户可以暂停并稍后恢复。每个回答成为持久 Decision Record，而不是只留在某次模型回复中。

## 9. 参谋部参与

每轮弹窗之前，参谋部可以并行生成结构化选项：

```text
Domain Advisors → independent recommendations
Chief of Staff → fallback/synthesis when needed
General → remove duplicates, expose trade-offs
User → makes user-owned decision
```

参谋的建议必须注明：来源、假设、风险、推荐理由和需要用户决定的部分。

## 10. 空项目与工兵

若 Project Recon 判定为 `IDEATION` 或 `SPECS_ONLY`：

1. General 完成决策漏斗；
2. Staff 形成首个 Direction/Wave；
3. Harness 创建 `SpecsMaintenanceOrder`；
4. 只有 Engineer 可写入 `specs/`；
5. Engineer 校验并在本地 `main` commit；
6. General 才能进入实现 Wave。

Brainstorm 本身不直接写项目文件或 Git。

## 11. `BrainstormOrder`

契约至少包含：

- root session、Mission id；
- 项目阶段；
- 已知目标、约束和未知；
- 问题阶段和预算；
- 已回答 Question id；
- Staff/Chief 建议引用；
- completion criteria；
- specs handoff policy。

Schema 见 [`brainstorm-order.schema.json`](../schemas/brainstorm-order.schema.json)。

## 12. 状态机

```text
CREATED
  → RECONNAISSANCE
  → QUESTIONING
  → STAFF_SYNTHESIS
  → USER_RATIFICATION
  → SPECS_HANDOFF
  → COMPLETED

any active state → PAUSED / CANCELLED
invalid evidence → REWORK
```

每个状态迁移有 expected revision，重复命令不得产生第二个 ACTIVE Order。

## 13. 用户回答的权威性

回答只对相应 Question id、Brainstorm revision 和显示选项生效。选项在用户打开弹窗后被 Staff 改写时，旧回答不能静默应用到新问题。

用户授权类回答需要单独的高风险确认；不能把“我喜欢方案 A”解释为允许 push、生产写入或处理 Restricted 数据。

## 14. 恢复与取消

- 浏览器刷新：pending question 从 `ctx.userQuestions` 和 durable Brainstorm state 恢复；
- General compaction：保留全部 Decision Record 和未决问题；
- General 取消：关闭 pending question，Order 进入 PAUSED/CANCELLED；
- Staff 子代理失败：General 可重试或使用 Chief fallback；
- Engineer 失败：Brainstorm 保持 SPECS_HANDOFF，不能假报完成。

## 15. WebUI 呈现

- 命令列表显示“头脑风暴”；
- 会话节点显示当前阶段、已完成决策和剩余问题；
- 用户可“继续提问”“采用推荐”“生成草案”“暂停”；
- 最终显示 Mission Intent Diff、Direction 草案和 specs commit receipt；
- 所有自由输入明确标注数据分类提示。

## 16. 测试与验收

- 非 Military 会话中 `/brainstorm` 未注册；
- 命令点击生成协议 id `brainstorm`；
- 子代理直接调用 `ask_user_question` 被拒时，问题能通过 General 正确转交；
- 同一会话重复命令不会创建重复 ACTIVE Order；
- 用户取消后无孤立 pending question；
- 达问题预算后系统生成显式假设，不无限循环；
- 可读取事实不会被反复问用户；
- 空项目最终产生 Engineer 的 specs commit，而不是 General 直接写文件；
- 每个用户选择能追溯到具体问题版本和后续设计决策。

## 0.3.0：Decision Broker

`/brainstorm` 的每轮问题也进入持久 Decision Broker，而不是直接把临时 Promise 作为状态。问题集携带 source、priority、task/mission revision、expiry 和 user-owned reason；根 General 串行调用 `ask_user_question`。

浏览器断线或 General compaction 不丢问题。两个标签页同时回答时，第一个 CAS 成功的 revision 生效；后来的回答显示已结算。若 Mission/Direction 发生 Change Order，旧问题标记 `STALE` 并重新生成。
