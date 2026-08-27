# 设计原则与硬不变量

## 1. 统帅意图优先

用户始终拥有最高授权。将军负责转译、组织和解释，不得把内部最优方案悄悄替换为不同目标。未知项、假设和偏好必须与用户事实分开。

## 2. 权限与能力分离

模型“知道如何做”不等于“被允许做”。工具可见性、Prompt 描述和 Agent 角色名都不是授权。权限由 Harness、Scope、Sandbox、Credential Gateway 和领域政策共同强制。

## 3. 事实与判断分离

- 事实：来自 Event、Artifact、Tool Receipt、Git Receipt 或用户授权；
- 判断：来自模型分析；
- 决策：来自有权限角色；
- 接受：来自 Harness 或显式用户覆盖。

任何模型判断在未经验证前不得升级为事实。

## 4. 外置验收优先

能由编译器、测试、schema、静态分析、数据库约束、浏览器自动化或 API contract 验证的内容，不应交给模型主观判断。模型 Inspector 只补充语义异常。

## 5. 最小可独立验收

任务分解的目标不是最小文字长度，而是最小完整闭环。任务过大增加模型认知负荷，过小增加协调负荷。Planning Engine 必须同时支持拆分和合并。

## 6. 所有执行 Agent 都可犯错

General、Staff、Worker、Engineer、Inspector 和研究 Agent 都被视为可能：

- 幻觉；
- 遗漏；
- 错误调用工具；
- 对旧状态作答；
- 被外部文本注入；
- 过度自信。

系统安全不能依赖“这个 Agent 更聪明”。

## 7. Harness 掌握状态，Agent 提交建议

Agent 只能提交 Command、Candidate、Blocker、Recommendation 和 Report。Mission、Task、Agent、Tactic 的权威状态只能由受控服务转换。

## 8. 版本化一切会改变执行语义的对象

Mission Intent、Direction、Wave、Task、Acceptance Contract、Environment Snapshot、Advisor Profile、Guidance 与 Tactical Skill 都必须有版本或 revision。旧结果不能静默写回新状态。

## 9. Event-first，文档是投影

任何长期事实必须先以 Event/Artifact 形式存在。Tactical Memory、specs 和 UI 是有来源的投影；允许重新生成，不允许成为唯一证据。

## 10. Specs 是活的工程系统

文档维护是每个 Wave 的退出条件，而不是最后补写。工兵必须让需求、架构、计划、验收、测试和实现之间保持追踪关系。

## 11. Thinking 是可治理的能力

Thinking 既不是默认越高越好，也不是应被普遍关闭。按角色、复杂度、风险和验证能力路由；不支持最低强度时 fail closed 或暂停。

## 12. 通信结构化

Agent 间不得依赖无身份的自由文本。所有战术求援和指导必须携带 Task Version、环境、技能、证据、时限和幂等身份。

## 13. 可逆与可恢复

外部副作用应幂等、可对账、可回滚或可明确标记 `UNKNOWN_EFFECT`。系统崩溃后通过事件重放恢复，不依赖某 Agent 的内存。

## 14. 背压而非无限扩军

Worker 数量受 Ready Tasks、写冲突、Workspace、Verifier、Advisor、模型配额和风险限制。必须保留返工和集成容量。

## 15. 私有战术必须经过实践检验

Skill 文档不能因“看起来专业”晋级。每个战术必须声明场景、前置、排除、状态机、验证、停止、回滚、来源和效能；通过 Simulation、Canary 和真实验收逐级晋升。

## 16. 非惩罚性督战

“督战队”是软件质量与安全隐喻，不包含惩罚或胁迫。其职责是冻结不可信执行、保存证据、请求修正，并保护用户项目。

## 17. 硬不变量

1. Worker/Engineer 不得使用 `reasoningEffort=off`；
2. 无 Candidate/Blocker 的执行 Agent 不得正常完成 Task；
3. 未通过外置验收的内容不得进入 General Memory；
4. Worker 不得写 `specs/**`；
5. 工兵不得执行远端 Git 写或历史重写；
6. Inspector 不得写项目或改变权威状态；
7. stale Candidate/Guidance 必须拒绝；
8. Secret 只能以 credential reference 流转；
9. Wave 未满足 Barrier 不得进入下一 Wave；
10. 所有用户授权覆盖必须持久记录。

## 0.2.0 新增原则

### Preset 是能力边界

是否进入 Military 工作流只由会话实际组装的 preset 决定。工作区、模型名、文本内容和全局设置都不能代替该事实。

### 管理平面不等于会话平面

标签、模板和绩效设置可常驻 Host，但普通会话不应看到或触发其模型消费者。

### 提炼先成为候选

历史会话和用户经验不会自动变成 Skill；先快照、扫描、提炼、Diff、用户审阅，再形成 DRAFT 版本。

### 配置变化必须版本化

非 General Agent 的模型、Thinking、权限和 Context Policy 属于 Agent Template revision。运行中 Attempt 不静默漂移。

### 用户问题只有一个所有者

子代理产生问题集，根 General 调用 `ask_user_question`，防止并发弹窗和 delegated caller 失配。

### 绩效结论必须带数据质量

参与量、准确性、完成度和难度校正能力必须同时报告样本、Verifier 覆盖、置信边界和不可支持结论。

## 0.3.0 新增原则

### 生成优于复制

Event、Schema、Type 和示例应从一个真源生成或通过 parity 校验，禁止同一契约在多个包手工复制。

### 恢复保真优于“尽量继续”

找不到历史 preset generation、权限 revision 或 Artifact 时，系统应 quarantine/暂停，而不是用当前配置猜测继续。

### 未验收修改不接触集成主线

Worker 的写入先存在隔离 Workspace；只有 Accepted Candidate 和全局回归 Receipt 才能更新 local `main`。

### 显式授权优于角色推断

General、Advisor 或管理员称谓不产生权限。跨会话、预算追加、Restricted 数据和远端动作必须有 Authority Context/Receipt。

### 资源预算是安全边界

高 reasoning 也必须有 reservation、并发和循环停止条件；耗尽时暂停，不降低验证和权限。

### 显示隐喻不改变能力

军事/中性术语属于 presentation；权限、Event、状态和安全边界不能随名称变化。
