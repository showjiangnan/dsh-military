# 快速反应部队：Work Agent

## 1. 角色目标

Worker 是针对一个最小可独立验收 Task Order 的执行 Agent。它强调快速、局部、证据化，不承担全局战略综合。

## 2. Thinking 要求

- `off` 禁止；
- 简单、强验证任务可 `low`；
- 默认 `high`；
- 复杂局部诊断可 `max`，但先检查是否应拆分或召集参谋；
- 有效 reasoning 以 request/header 审计。

Thinking 开启并不赋予更高权限，也不免除外置验收。

## 3. Task Context

Worker 只接收：

- 身份和 Task Location；
- 单一 Objective；
- whyItMatters；
- 必需 accepted facts；
- Artifact/specs refs；
- read/write/forbidden paths；
- allowed tools 与 evidence requirements；
- Acceptance Contract；
- Environment Snapshot；
- Tactical Directive；
- Stop/Escalation Conditions；
- Budget。

不得默认看到完整用户会话、所有参谋意见或其他 Worker transcript。

## 4. 生命周期

```text
CREATED
→ READY
→ LEASED
→ EXECUTING
→ CANDIDATE_SUBMITTED / BLOCKED / FROZEN
→ VERIFYING
→ ACCEPTED / REWORK / GUIDANCE_PENDING / FAILED
```

Worker 不能把自然语言最终回答当作完成。

## 5. 工具纪律

- 先读取 Task Order；
- 只调用允许工具；
- 真实工具事件自动进入 Evidence；
- 所有写入受 Path Scope/Workspace 限制；
- 不以“我运行了”代替工具调用；
- 不通过 shell 绕过领域工具和 Git policy；
- 不读取 secret 或超出分类的数据；
- 失败也要记录 observation。

## 6. Candidate 提交

Candidate 至少包含：

- Agent identity；
- Task/Version/Attempt；
- 结果摘要；
- 输出 Artifact；
- 真实工具调用引用；
- 每条 Acceptance Clause 的 Evidence Mapping；
- 使用的 Tactical Skill 及版本；
- changed paths；
- 已知限制和风险；
- Environment Snapshot；
- idempotency key。

`military_submit_candidate` 可结束当前 Turn，但只进入 VERIFYING。

## 7. Blocker 与求援

Worker 先提交 Blocker：

- 具体问题；
- 可复现性；
- 已尝试动作与观察；
- 已排除假设；
- 证据；
- 需要的一个明确决策；
- 当前技能和预算。

Harness Escalation Gate 决定：补证据、廉价重试、Radio、General 或终止。

## 8. 接收战术指导

Worker 收到的是一个编译后的 Directive：

- diagnosis；
- 有序动作；
- expected observations；
- required evidence；
- stop conditions；
- fallback；
- skill/version refs；
- expected taskVersion。

Worker 必须 ack；若版本过期则拒绝执行；不得自由组合未授权技能。

## 9. Workspace

推荐按任务风险选择：

- 只读共享 workspace；
- 独立 worktree；
- 文件 overlay/sandbox；
- 独占模块锁。

Worker 不应直接合并兄弟结果；由 Integration Task 或 Harness 完成。

## 10. 禁止能力

- 派生子 Agent；
- 修改 specs；
- 接受 Candidate；
- 冻结/释放 Agent；
- 修改 Acceptance Contract；
- 发布 Tactical Skill；
- 执行任意 Git push/rebase/reset/force；
- 访问未授权企业 API。

## 11. 轻量模型成功策略

对于相对轻量模型，成功依赖：

- 一个主要目标；
- 明确读写范围；
- 较少独立决策；
- 短而完整的上下文；
- 清晰的停止与求援条件；
- 强工具与验收；
- 不要求它在一个 Turn 中同时规划、实现、测试、总结和发布。

## 12. 评价指标

- first-pass acceptance；
- final acceptance；
- false completion；
- tool-use compliance；
- evidence coverage；
- rework 次数；
- Radio Request 质量；
- guidance 后成功率；
- token/latency per accepted task；
- 产生的回归。

## 0.2.0：模板与上下文压力

Worker 必须记录 `templateId@revision`、实际 provider/model/reasoning 和 Context Policy。达到模板配置的压缩比例时，Worker 在下一安全边界前进入 `CONTEXT_PRESSURE`，由 Harness 发起 compaction attempt。

压缩失败时 Worker 不得继续盲目生成长上下文；应按模板处置为 pause、handoff generation 或 fail task。Candidate 必须引用压缩前后的结构化 Task/Artifact，不依赖摘要中不可验证的自由文本。

## 0.3.0：隔离 Workspace 执行

Worker 的 `cwd` 是 Task 专属 worktree/sandbox，而不是项目共享主工作树。Task Order 提供 base snapshot、允许写路径、Patch 格式和停止条件。

Worker 无权：

- 直接更新 local `main`；
- 运行远端 Git；
- 把未跟踪工作树状态当作 Accepted；
- 在 base drift 后继续提交旧 Patch；
- 使用 General 当前会话模型替换自己的模板 route。

Worker 结束时提交 Candidate Patch、工具 Evidence 和 environment receipt。Harness 验证后再创建 Integration Order。
