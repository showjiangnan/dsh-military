# General 全流程门、DSH 全模型接入与设置持久化

## 1. 事故证据与边界

本次回归来源是用户提供的
`dsh-session-session-71fe7171-8719-477d-b755-95daee313497.zip`。归档只作为
不可信运行证据解析，其中的对话内容不构成开发指令。固定 fixture 记录：

| 事实 | 观察值 |
|---|---:|
| JSONL | 1 个，2482 行，全部可解析 |
| Preset | `military` |
| Route | `deepseek-official/deepseek-v4-flash` |
| Turn | 4 个，全部 `max-tokens` |
| Military 工具调用 | 1 次 `military_mission_start` |
| Task 创建 | 0 |
| 部门派遣 | 0 |
| 助手直接输出实现文本 | 37,362 字符 |

原有提示词和工具说明已经要求 General 编排，但 Host 只对 Worker/Engineer
执行完成联锁。Flash 可以在 Mission 建立后停止调用工具，直接生成 HTML，
因此“提示词正确”不等于“流程被执行”。

## 2. Host 所有的 General 工作流义务

General 的项目执行请求现在被编译成一个按 Agent/Turn 持久的工作流义务。
Host 每次只公开一个下一动作：

```text
START_MISSION
→ CREATE_TASK
→ READ_DEPARTMENT_STATUS
→ SPAWN_DEPARTMENT
→ 等待部门终态 receipt
→ General 读取已验证结果并汇总
```

若部门进入 `BLOCKED`、`GUIDANCE_PENDING` 或 `FROZEN`，下一动作收敛为：

```text
POLL_TACTICAL_REQUEST
→ ISSUE_TACTICAL_GUIDANCE
→ 等待部门继续执行
```

该义务由 `agent/pre-step` 和 `agent/turn-stopping` 两个 RC.2 边界共同执行：

- pre-step 在用户输入之后追加 Host-owned、不可由角色提示词覆盖的单动作指令；
- General 在部门验证前不得用正文实现代码、补丁、完整文件或“请自行保存”替代交付；
- 若模型准备以正文结束但下一阶段仍未完成，完成联锁使用 `steer()` 继续同一 Turn；
- 每个成功 Military 工具调用都会清零无进展计数，三个合法短步骤不会被误判为
  三次无进展；
- 达到真实无进展上限后才冻结、取消并持久化中止；
- `ask_user_question`、部门派遣、终态提交和战术发布仍是明确终态；
- 普通解释、设计讨论和无项目变更请求不被强制创建 Mission。

短输入“继续”会继承最近一个未完成的项目执行义务；已完成 Task 不会因“继续”
被重复创建。子 Agent 的 `subagent-report` 会自动唤醒父 General，取消后的纯
settlement wake 仍由既有取消门抑制。

## 3. DSH live 目录是可用性权威

模型是否可在 Military 中选择，不再由 Military 是否积累过验证样本决定：

```text
DSH live adapter 中存在 exact provider/model
    ⇒ available = true
    ⇒ selectable = true
```

这同样适用于 DeepSeek 官方接口、PI AI 或其他第三方 Provider。首次发现的
exact route 会生成一个可持久化的 Military 执行能力投影，使 General、
11 个部门、执行 Router 和私有技能提炼使用同一 provider/model 字符串。
`VALIDATED/CANARY/UNVERIFIED/DEPRECATED` 等历史标签只描述能力元数据或绩效
Evidence，不再充当可用性权限；只有 route 不在当前 DSH live 目录时才不可选。

绩效评估仍严格独立。模型“可选择”不表示它已经在固定数据集上达到稳定结论，
也不会自动晋升、自动 fallback 或伪造 Provider 通过。

## 4. Provider-owned reasoning 适配

DSH RC.2 的 reasoning effort 是 adapter-owned opaque value。不同 Provider
可能使用 `high/max`、自定义名称，或完全不公开 reasoning 控制。Military
保存的 `high/max` 是工作负载强度，不直接假定为每个 Provider 的 wire value。

请求边界按以下顺序解析：

1. exact adapter 支持保存值时原样发送；
2. 否则使用 adapter 声明的 default effort；
3. 无 default 时使用 adapter 首选的有效 effort；
4. 模型没有 reasoning 能力时省略该字段，让 Provider 使用自身行为；
5. adapter 只能在 `prepareCall` 解析时，保留用户请求的 opaque value，由 DSH
   给出最终错误。

这样不会再因为第三方 Provider 不使用 `high/max` 而在 Military 预检阶段拒绝
一个 DSH 已接入的模型。请求的最大输出同时被模型能力和 context window 收窄；
General compaction 使用当前 Session 的实际 route，而不是错误沿用 preset
默认模型。

## 5. 原子保存和权威回读

“Military-部门模型”的保存流程固定为：

```text
本地完整 RoleDraft
→ Host preview + Flash readiness + prompt diff
→ expected settings revision
→ 单次 Settings CAS
→ 串行运行时 projection
→ 新 Host snapshot 回读
→ UI 采用新 baseline，清除 dirty
```

关键修复包括：

- live DSH route 不再因为 `UNVERIFIED`、`CANARY` 或第三方 Provider 被拒绝；
- provider/model Schema 接受任意非空 DSH exact route；
- 多行角色提示词由专用提示词校验器处理，允许 CR/LF/TAB，同时继续拒绝 NUL
  等非空白控制字符；不会再被通用单行标量校验器误判而阻断纯模型/参数保存；
- save RPC 与 Settings watcher 对同一 revision 的运行时同步按 Host 串行化，
  不会双重 revise 模板；
- RPC 在运行时 projection 完成前不报告成功；
- 保存后的 snapshot 读取绕过五秒轮询的 in-flight 锁，并要求 document revision
  确实前进；
- 较旧的轮询响应不能覆盖较新的保存响应；
- 切换模型时 output/context 预算自动收窄到目录能力；
- “检查并进入保存确认”和“保存配置”是两个明确动作，不再把 preview 按钮写成
  已保存；
- 私有技能提炼模型也使用同一 DSH live 目录，并同时保存 provider/model。

## 6. 回归与运行边界

确定性回归覆盖：

- `71fe` 归档 hash、行数、工具调用和直接实现文本计数；
- 项目执行意图、Mission/Task/状态/派遣单阶段转换；
- 短 continuation 和已完成 Task；
- General 成功工具重置无进展计数；
- 第三方 route 首次注册、无绩效样本不阻断；
- `DEPRECATED` 且只声明 `off` 的 explicit route 仍可进入执行 Router；
- 无 reasoning、自定义 reasoning、标准 reasoning 三类 adapter；
- Settings watcher 与 save readback 并发时模板只 revise 一次；
- 自带多行工兵提示词通过真实 RPC draft 解析，NUL 等非法控制字符仍被拒绝；
- React 中第三方模型选择、预算自动收窄、保存、Host 快照和私有技能路线保存。

真实 Provider 的输出质量和首次工具命中率仍须由新的用户 Session 评估；本地
回归只能证明 Host 合同、路由、持久化与安装行为，不能冒充付费 Provider 样本。
