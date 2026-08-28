# dsh-military 完整设计与开发规范

> 单文件汇编版；源文档位于 `docs/00-*.md` 至 `docs/69-*.md`。
> 文档工程版本：`0.9.0-draft`。  
> DSH 实现与验收基线：`deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh@0.1.1-rc.2`）。

## 使用说明

本文件用于连续阅读、评审和离线归档。实现时仍应以分主题文档、JSON Schema、ADR、示例和 TypeScript 参考契约共同作为规范，不应只复制本文件中的自然语言段落。

## 目录

- [00. dsh-military 完整设计总纲](#part-00)
- [01. 设计原则与硬不变量](#part-01)
- [02. 系统上下文与五平面架构](#part-02)
- [03. 组织模型与职责分离](#part-03)
- [04. Mission 生命周期](#part-04)
- [05. 方向—波次—任务规划科学](#part-05)
- [06. 将军 Agent 设计](#part-06)
- [07. 战术参谋部设计](#part-07)
- [08. 快速反应部队：Work Agent](#part-08)
- [09. 工兵部与 specs 文档工程](#part-09)
- [10. 督战队、监督控制器与完成联锁](#part-10)
- [11. 参谋部电台](#part-11)
- [12. 私有战术系统](#part-12)
- [13. 后勤保障与研究部](#part-13)
- [14. 外置验收、证据与两阶段完成](#part-14)
- [15. 事件溯源、状态与持久化](#part-15)
- [16. 与 DeepSeek Harness 的集成方案](#part-16)
- [17. WebUI 设计](#part-17)
- [18. 安全、权限与企业数据](#part-18)
- [19. 可观测性、容量与效能指标](#part-19)
- [20. 测试、评估与发布门禁](#part-20)
- [21. 包拓扑与依赖边界](#part-21)
- [22. 实施路线图](#part-22)
- [23. 风险登记册](#part-23)
- [24. 运行与故障处置手册](#part-24)
- [25. DSH 设计参考与基线](#part-25)
- [26. 中国近代战争经验的工程抽象](#part-26)
- [27. API、数据契约与错误语义](#part-27)
- [28. 治理、命令修订与授权](#part-28)
- [29. 模型路由与 Thinking 策略](#part-29)
- [30. 失败恢复、幂等与混沌测试](#part-30)
- [31. 实现蓝图](#part-31)
- [32. 固定 `military` Preset 与会话隔离](#part-32)
- [33. 外部内容战术提炼与标签治理](#part-33)
- [34. Military 可视化设置、部门模板与上下文策略](#part-34)
- [35. “头脑风暴”命令与用户决策对话](#part-35)
- [36. 参谋长兜底机制](#part-36)
- [37. 37. 军事评估委员会与绩效决策中心](#part-37)
- [38. Preset generation、升级与恢复](#part-38)
- [39. 契约真源与代码生成](#part-39)
- [40. Principal、Tenant 与授权模型](#part-40)
- [41. Workspace 隔离、补丁与集成协议](#part-41)
- [42. 物理存储、事务与迁移设计](#part-42)
- [43. General 模型与会话策略优先级](#part-43)
- [44. 用户决策 Broker 状态机](#part-44)
- [45. RC.2 能力探测与兼容矩阵](#part-45)
- [46. 安装、升级、回滚与卸载](#part-46)
- [47. 私有战术知识供应链](#part-47)
- [48. 48. 绩效评估统计、公平性与申诉](#part-48)
- [49. 一致性测试、Golden Trace 与模型检查](#part-49)
- [50. 资源预算、准入控制与过载保护](#part-50)
- [51. WebUI 交互、冲突、恢复与可访问性规范](#part-51)
- [52. 产品术语、军事隐喻与安全边界](#part-52)
- [53. 53. 源码架构与包参考](#part-53)
- [54. 54. 构建、测试、安装与运行](#part-54)
- [55. 55. 代码审查、安全与 RC.2 一致性](#part-55)
- [56. 56. RC.2 已知限制与迁移边界](#part-56)
- [57. 57. 绩效评估运行时实现](#part-57)
- [58. 58. Worker Workspace 与子代理创建运行时](#part-58)
- [59. 59. RC.2 Web Client 打包与页面能力](#part-59)
- [60. 60. Mission Kernel 2.0 与单写者 Command Bus](#part-60)
- [61. 61. Context Compiler、Claim–Evidence Graph 与分层验收](#part-61)
- [62. 62. 自适应执行 Router、Capability Profile 与并行度](#part-62)
- [63. 63. Agentic Zero Trust 与短期 Capability Grant](#part-63)
- [64. 64. 可观测性与决策链绩效评估](#part-64)
- [65. 65. DSH RC.2 兼容与适配迁移](#part-65)
- [66. 66. Legacy → RC.2 升级运行手册](#part-66)
- [67. Military 控制中心、Flash 工作台与可访问性](#part-67)
- [68. General 全流程门、DSH 全模型接入与设置持久化](#part-68)
- [69. 执行活性、Flash 外部验收与生产可信度](#part-69)

---

<a id="part-00"></a>

## Part 00：dsh-military 完整设计总纲

源文件：`docs/00-executive-design.md`

### 1. 定位

`dsh-military` 是建立在 DeepSeek Harness（DSH）之上的多代理组织与控制 Bundle。它不是“同时启动很多 Agent”的包装器，而是一套把复杂任务转化为可指挥、可执行、可验证、可恢复、可学习的软件体系。

它解决四个核心问题：

1. 将用户的自然语言方向转译为版本化 Mission、Direction、Wave 与 Task Order；
2. 让相对轻量的模型在明确边界、适量上下文和强工具支持下完成局部任务；
3. 阻止 Agent 仅凭自然语言自报完成、伪造工具使用或把猜测写成事实；
4. 把成功和失败经验沉淀为可版本化、可测试、可回滚的私有战术。

Bundle 的核心是**指挥权、计划权、执行权、验收权、冻结权、通信权、记忆权和 Git 权限的分离**。

### 2. 组织映射

| 组织角色 | 软件组件 | 核心职责 | 禁止事项 |
|---|---|---|---|
| 统帅 | 用户 | 下达行动方向、约束与授权；批准高风险外部动作 | 无需编写内部任务细节 |
| 将军 | Main/General Agent | 转译统帅意图；批准方向；处理战略升级；向用户汇报；在用户授权下执行远端/非 main Git 动作 | 不接受自己的结果；不绕过 Harness 验收 |
| 参谋部 | Staff Department | 专业研判、联合会商、Direction/Wave/Task 拆解、兵力生成、战术指导与修正命令 | 不直接接受 Worker 结果；不无痕修改验收标准 |
| 快速反应部队 | Work Agents | 使用 Thinking 与工具执行单一 Task Order；提交 Candidate、Blocker 与证据 | 不自行宣告完成；不派生下级；不写 specs |
| 工兵部 | Engineer Corps | 建立和持续维护 specs 工程；维护需求、架构、决策、计划、验收和追踪；执行受限本地 Git | 不 push；不重写历史；不在未授权路径写入 |
| 督战队 | Oversight Corps | 只读审计声明、工具、证据和范围；确定性控制器实施冻结 | Inspector Agent 不能自行冻结、解冻或修改项目 |
| 参谋部电台 | Staff Radio | 接收结构化求援；资格审查、去重、租约、路由、版本校验与投递 | 不接受无身份、环境、技能和证据的自由文本求援 |
| 后勤保障与研究部 | 3 个固定 Agent | 战术轨迹总结、战术效能评估、战术博物馆与经验闭环 | 不把未验收内容写入 General Memory；不直接发布稳定战术 |

### 3. 五平面架构

#### 3.1 指挥平面

```text
User Direction
  → Mission Intent
  → Staff Council
  → Direction Proposal
  → General Ratification
```

#### 3.2 作战平面

```text
Direction
  → Wave DAG
  → Ready Task Orders
  → Force Generation
  → Thinking-enabled Workers
  → Candidate / Blocker
  → Verification
  → Accept / Rework / Escalate
```

#### 3.3 保障平面

由工兵、specs、受限 Git、Workspace、Artifact Store、环境快照和资源锁组成，确保项目可持续维护并能恢复。

#### 3.4 监督平面

由 Completion Interlock、Verification Engine、Oversight Controller 和只读 Inspector Agent 组成。原则是：

> 模型可以发现和解释异常，但只有 Harness 可以改变 Task 与 Agent 的权威状态。

#### 3.5 知识平面

由参谋部电台、私有战术注册表、轨迹记忆、效能评估和战术博物馆组成，把一次任务经验变成可检索、可测试、可晋级的组织知识。

### 4. 核心闭环

```text
统帅下达方向
  ↓
将军形成 Mission Intent
  ↓
项目侦察：IDEATION / SPECS_ONLY / ACTIVE / LEGACY
  ↓
若空项目：参谋联合规划 → 工兵建立 specs 基线 → 本地 main commit
  ↓
参谋部形成 Direction 与下一 Wave
  ↓
Harness 计算 Ready Tasks 与有效并发
  ↓
派生 Thinking-enabled Worker / Engineer
  ↓
执行工具并记录 Evidence
  ↓
调用 military_submit_candidate 或 military_submit_blocker
  ↓
完成联锁 + 督战审查 + 外置验收
  ├─ ACCEPTED → 正式提交
  ├─ REWORK → 修正任务
  ├─ BLOCKED → 参谋部电台
  ├─ FROZEN → 参谋审查后释放或替换
  └─ STRATEGIC → 将军处理
  ↓
Wave Barrier：集成验收 + specs commit + 风险检查 + 战术汇报
  ↓
轨迹总结、效能评估与战术博物馆更新
  ↓
将军接收已认证 Tactical Memory 并向用户汇报
```

### 5. 三个关键修正

#### 5.1 任务不是“越小越好”

目标是**最小可独立验收单元**。无限拆分会增加 Agent 启动、上下文打包、电台、锁、合并和验收成本。一个 Task 应具有一个主要结果、一个责任 Agent、一个冻结上下文包、一个有限写集合和一份独立验收合同。

#### 5.2 督战不能只靠另一个模型

实时冻结必须由 Harness 事件控制器执行。Inspector Agent 只读取日志、Diff、工具结果和声明，输出结构化 Inspection Report。真正冻结发生在工具 Guard、`agent/pre-step`、完成联锁或 turn-stopping 边界。

#### 5.3 Thinking 按角色强制

本版本放弃“关闭 Worker Thinking 节省成本”的策略。General、Staff、Worker、Engineer 与研究 Agent 都必须使用 Thinking；具体强度按风险和任务复杂度调整。有效值以模型请求的持久请求头审计，不能只相信 Prompt 或配置。

### 6. 数据真源

1. **Mission Ledger**：跨 Agent、跨 Session 的不可变全局事件账本；
2. **DSH Session Log**：单 Agent 的持久模型可见事实；
3. **Artifact Store**：文件、Diff、测试、日志、截图、API receipt 等内容寻址证据；
4. **Derived Documents**：Tactical Report、Memory 与 Museum Archive，只是投影，不是真源。

### 7. 权威控制矩阵

| 动作 | 用户 | 将军 | 参谋 | Harness | Worker | 工兵 | Inspector |
|---|---:|---:|---:|---:|---:|---:|---:|
| 改变用户目标 | 决定 | 提议/转译 | 建议 | 记录 | 禁止 | 禁止 | 禁止 |
| 批准 Direction | 可覆盖 | 批准 | 提案 | 版本化 | 禁止 | 禁止 | 禁止 |
| 生成 Task | 观察 | 可退回 | 负责 | 校验 | 禁止 | 禁止 | 禁止 |
| 接受 Task 结果 | 可手动覆盖风险 | 处理战略例外 | 禁止 | 唯一自动接受者 | 禁止 | 禁止 | 禁止 |
| 冻结 Agent | 可命令 | 可请求 | 可请求 | 唯一执行者 | 禁止 | 禁止 | 禁止 |
| 常规写 specs | 可直接操作项目 | 不作为常规执行者 | 提供命令 | 强制权限 | 禁止 | 唯一 Agent 写者 | 禁止 |
| 远端/非 main Git | 明确授权 | 唯一 Agent 执行路径 | 禁止 | 审批与审计 | 禁止 | 禁止 | 禁止 |
| 发布 STABLE 战术 | 可配置批准 | 批准高风险项 | 提议 | 运行门禁 | 禁止 | 禁止 | 禁止 |

### 8. 成功标准

- 未验收事实进入 General Memory：0；
- stale Task Version 被接受：0；
- 未授权远端 Git 写：0；
- Worker/Engineer 实际 reasoning 为 off：0；
- 一次战术指导后的验收通过率高于可比无指导基线；
- specs 与已接受实现具备可追踪覆盖；
- Mission 可从 Ledger、Session 和 Artifact 重放；
- 私有战术晋级来自真实验收和可复现实验，而非模型自评。

### 0.2.0 增量：固定 Preset、知识提炼和绩效治理

本版将“用户选择 Military 模式”落为 DSH 原生固定 system preset `military`，而不是运行时布尔开关。Preset 在空白会话创建期组装并锁定；普通会话完全不获得 Military 模型表面。参见[固定 Military Preset 与会话隔离](docs/32-military-preset-and-session-isolation.md)。

系统新增三个跨 Mission 能力：

- 用户显式把历史会话或直接经验提炼为带来源的私有战术候选；
- 用户按部门管理非 General Agent Template 的模型、Thinking、上下文预算和压缩阈值；
- 军事评估委员会按时间区间评估模板 revision 和总体组织绩效。

这些能力都保持“模型提出、Harness 验证、用户批准”的权威分离。

### 0.3.0 增量：从组织设计到可恢复实现契约

0.3.0 的重点不是新增更多 Agent，而是让系统能在 RC.2 上安全实现和恢复：

- General 默认模型由 `military` preset 所有，用户会话选择可覆盖 General 后续请求；
- preset 使用内容寻址 generation，跨进程恢复旧 Session 不漂移；
- Mission/Admin Event 由 Event Catalog 生成完整 Payload；
- 所有管理动作有 Principal/Tenant Authority Context；
- Worker 在隔离 Workspace 产出 Patch，经验证和全局回归后才进入 local `main`；
- 持久化使用 CAS、Outbox、Receipt 和补偿，不伪造跨系统原子性；
- 用户问题通过根 General 的 durable Decision Broker；
- 战术拥有来源权利、时效、派生图和撤回；
- 绩效评估拥有 Dataset Manifest、难度校正和申诉；
- Thinking 优先，同时受资源 reservation 和背压；
- WebUI 处理 revision 冲突、断线恢复、generation quarantine 和可访问性；
- 军事词汇可切换为中性显示，系统不用于现实伤害或人员处分。

完整实现门禁见 [`IMPLEMENTATION-READINESS.md`](IMPLEMENTATION-READINESS.md)。


---

<a id="part-01"></a>

## Part 01：设计原则与硬不变量

源文件：`docs/01-design-principles.md`

### 1. 统帅意图优先

用户始终拥有最高授权。将军负责转译、组织和解释，不得把内部最优方案悄悄替换为不同目标。未知项、假设和偏好必须与用户事实分开。

### 2. 权限与能力分离

模型“知道如何做”不等于“被允许做”。工具可见性、Prompt 描述和 Agent 角色名都不是授权。权限由 Harness、Scope、Sandbox、Credential Gateway 和领域政策共同强制。

### 3. 事实与判断分离

- 事实：来自 Event、Artifact、Tool Receipt、Git Receipt 或用户授权；
- 判断：来自模型分析；
- 决策：来自有权限角色；
- 接受：来自 Harness 或显式用户覆盖。

任何模型判断在未经验证前不得升级为事实。

### 4. 外置验收优先

能由编译器、测试、schema、静态分析、数据库约束、浏览器自动化或 API contract 验证的内容，不应交给模型主观判断。模型 Inspector 只补充语义异常。

### 5. 最小可独立验收

任务分解的目标不是最小文字长度，而是最小完整闭环。任务过大增加模型认知负荷，过小增加协调负荷。Planning Engine 必须同时支持拆分和合并。

### 6. 所有执行 Agent 都可犯错

General、Staff、Worker、Engineer、Inspector 和研究 Agent 都被视为可能：

- 幻觉；
- 遗漏；
- 错误调用工具；
- 对旧状态作答；
- 被外部文本注入；
- 过度自信。

系统安全不能依赖“这个 Agent 更聪明”。

### 7. Harness 掌握状态，Agent 提交建议

Agent 只能提交 Command、Candidate、Blocker、Recommendation 和 Report。Mission、Task、Agent、Tactic 的权威状态只能由受控服务转换。

### 8. 版本化一切会改变执行语义的对象

Mission Intent、Direction、Wave、Task、Acceptance Contract、Environment Snapshot、Advisor Profile、Guidance 与 Tactical Skill 都必须有版本或 revision。旧结果不能静默写回新状态。

### 9. Event-first，文档是投影

任何长期事实必须先以 Event/Artifact 形式存在。Tactical Memory、specs 和 UI 是有来源的投影；允许重新生成，不允许成为唯一证据。

### 10. Specs 是活的工程系统

文档维护是每个 Wave 的退出条件，而不是最后补写。工兵必须让需求、架构、计划、验收、测试和实现之间保持追踪关系。

### 11. Thinking 是可治理的能力

Thinking 既不是默认越高越好，也不是应被普遍关闭。按角色、复杂度、风险和验证能力路由；不支持最低强度时 fail closed 或暂停。

### 12. 通信结构化

Agent 间不得依赖无身份的自由文本。所有战术求援和指导必须携带 Task Version、环境、技能、证据、时限和幂等身份。

### 13. 可逆与可恢复

外部副作用应幂等、可对账、可回滚或可明确标记 `UNKNOWN_EFFECT`。系统崩溃后通过事件重放恢复，不依赖某 Agent 的内存。

### 14. 背压而非无限扩军

Worker 数量受 Ready Tasks、写冲突、Workspace、Verifier、Advisor、模型配额和风险限制。必须保留返工和集成容量。

### 15. 私有战术必须经过实践检验

Skill 文档不能因“看起来专业”晋级。每个战术必须声明场景、前置、排除、状态机、验证、停止、回滚、来源和效能；通过 Simulation、Canary 和真实验收逐级晋升。

### 16. 非惩罚性督战

“督战队”是软件质量与安全隐喻，不包含惩罚或胁迫。其职责是冻结不可信执行、保存证据、请求修正，并保护用户项目。

### 17. 硬不变量

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

### 0.2.0 新增原则

#### Preset 是能力边界

是否进入 Military 工作流只由会话实际组装的 preset 决定。工作区、模型名、文本内容和全局设置都不能代替该事实。

#### 管理平面不等于会话平面

标签、模板和绩效设置可常驻 Host，但普通会话不应看到或触发其模型消费者。

#### 提炼先成为候选

历史会话和用户经验不会自动变成 Skill；先快照、扫描、提炼、Diff、用户审阅，再形成 DRAFT 版本。

#### 配置变化必须版本化

非 General Agent 的模型、Thinking、权限和 Context Policy 属于 Agent Template revision。运行中 Attempt 不静默漂移。

#### 用户问题只有一个所有者

子代理产生问题集，根 General 调用 `ask_user_question`，防止并发弹窗和 delegated caller 失配。

#### 绩效结论必须带数据质量

参与量、准确性、完成度和难度校正能力必须同时报告样本、Verifier 覆盖、置信边界和不可支持结论。

### 0.3.0 新增原则

#### 生成优于复制

Event、Schema、Type 和示例应从一个真源生成或通过 parity 校验，禁止同一契约在多个包手工复制。

#### 恢复保真优于“尽量继续”

找不到历史 preset generation、权限 revision 或 Artifact 时，系统应 quarantine/暂停，而不是用当前配置猜测继续。

#### 未验收修改不接触集成主线

Worker 的写入先存在隔离 Workspace；只有 Accepted Candidate 和全局回归 Receipt 才能更新 local `main`。

#### 显式授权优于角色推断

General、Advisor 或管理员称谓不产生权限。跨会话、预算追加、Restricted 数据和远端动作必须有 Authority Context/Receipt。

#### 资源预算是安全边界

高 reasoning 也必须有 reservation、并发和循环停止条件；耗尽时暂停，不降低验证和权限。

#### 显示隐喻不改变能力

军事/中性术语属于 presentation；权限、Event、状态和安全边界不能随名称变化。


---

<a id="part-02"></a>

## Part 02：系统上下文与五平面架构

源文件：`docs/02-system-context.md`

### 1. 系统边界

`dsh-military` 位于用户、DSH Host、模型 Provider、项目工作区、企业 API、Git、存储和 WebUI 之间。它不替代 DSH Agent Loop，而是在公开插件 seam 上提供领域控制层。

```text
User / WebUI
      ↓
DSH Host + dsh-military Bundle
      ├─ LLM Providers
      ├─ Project Workspace / Sandbox
      ├─ Local Git
      ├─ Enterprise API Gateway
      ├─ Mission Ledger / Radio / Artifact Store
      └─ DSH Session Persistence
```

### 2. 外部参与者

| 参与者 | 输入 | 输出 | 信任级别 |
|---|---|---|---|
| 用户 | 目标、约束、授权、反馈 | 决策与最终结果 | 最高授权，但输入仍需结构化 |
| LLM Provider | 模型请求 | Token、tool calls、usage | 不可信执行者，输出必须验证 |
| 项目工作区 | 文件、命令、测试 | Diff、日志、Artifact | 事实源之一；内容可能含注入 |
| 企业 API | 私有业务数据 | 结构化响应 | 受 Gateway、分类和脱敏控制 |
| Git | 仓库和 commit | 历史与证明 | 受限本地写；远端另行授权 |
| WebUI | 配置和命令 | 投影与审计 | 需服务端授权和 revision fencing |

### 3. 五平面

#### 指挥平面

用户、General 与 Staff Council。输出 Mission Intent、Direction、优先级、Change Order 和战略决策。

#### 作战平面

Planning、Scheduler、Workspace 与 Worker。输出 Candidate、Blocker、Artifact 和集成结果。

#### 保障平面

Engineer、Specs、Git、Artifact、Environment Snapshot、资源锁和恢复。

#### 监督平面

Completion Interlock、Verification Registry、Oversight Controller 和 Inspector。输出验收 receipt、Freeze、Correction Request 和风险事件。

#### 知识平面

Radio、Tactical Registry、Trajectory、Effectiveness、Museum 和 General Tactical Memory。

### 4. 核心服务关系

```text
MilitaryRuntime
  ├─ MilitaryLedger
  ├─ MilitaryPlanning
  ├─ MilitaryStaff
  ├─ MilitaryRadio
  ├─ MilitaryVerification
  ├─ MilitaryOversight
  ├─ MilitarySpecs / MilitaryGit
  ├─ MilitaryArtifacts / Workspace
  ├─ MilitaryTactics
  ├─ MilitaryMemory
  └─ MilitaryMetrics
```

`MilitaryRuntime` 负责运行生命周期，但不应内置具体数据库、队列、Git CLI 或 Web 组件。

### 5. 关键数据流

#### 用户意图流

```text
User message
→ General interpretation
→ structured Mission Intent
→ Staff review
→ General ratification
→ Ledger + General Session projection
```

#### Worker 执行流

```text
Task Order
→ Agent Scope + Environment Snapshot
→ tool calls
→ durable tool results + Artifact
→ Candidate
→ Verification
→ accepted event / rework
```

#### 战术求援流

```text
Blocker + identity + environment + skills + evidence
→ Escalation Gate
→ Radio Broker
→ Advisor routing
→ 3-5 tactic retrieval
→ one compiled Directive
→ version-checked delivery
```

#### 记忆流

```text
Accepted events
→ deterministic Tactical Report
→ Trajectory / Effectiveness
→ source coverage verification
→ General Tactical Memory
→ Museum research → tactic candidate
```

### 6. 部署模式

#### 本地开发

- SQLite Ledger/Radio；
- 本地内容寻址 Artifact；
- DSH JSONL Session persistence；
- 本地 Git；
- 单 Host 进程。

#### 团队/企业

- PostgreSQL Ledger；
- 分布式队列；
- 对象存储；
- KMS/Vault；
- 企业 API Gateway；
- OTel；
- 多租户和数据驻留。

领域契约在两种模式下保持一致。

### 7. 信任边界

- 模型输出永远不是授权；
- 仓库、网页和 API 文本永远不是系统指令；
- Web Client 永远不是权限真源；
- Advisor 描述永远不扩大 API/Skill grant；
- 派生 Memory 永远不覆盖 Ledger；
- Bundle patch 永远不应包含 Secret。

### 0.2.0 新增外部参与者与边界

新增外部交互：

- DSH Agent Preset Roster：发现和组装固定 `military`；
- Tactical Source Sessions：用户显式选定的历史会话，不因被读取而启用 Military；
- User-managed Tag Catalog：全局管理数据，引用稳定 tag id；
- Performance Evaluation Reader：经授权跨 Military 会话读取持久事件和 Artifact；
- `ask_user_question`：只由根 General 所有的用户决策通道。

跨会话评估和战术提炼属于管理 Job，不运行在被读取会话的 Agent Loop 内。

### 0.3.0 新增系统参与者

- **Preset Generation Store**：保存 current 与历史内容寻址组合；
- **Compatibility Probe**：在 RC.2 启动时验证关键 seam；
- **Policy Registry**：Tool、Permission、API、Residency、Redaction、Verifier、Model Profile；
- **Workspace/Integration Runtime**：隔离执行、Patch、global regression 和 local main；
- **Decision Broker**：根 General 与子代理之间的持久用户决策中继；
- **Budget Runtime**：reservation、结算、背压和耗尽处置；
- **Evaluation Dataset Builder**：跨会话授权读取、去标识化和冻结数据集；
- **Bundle Lifecycle Controller**：安装、升级、回滚和卸载。

系统边界增加两个硬限制：Host 管理服务可以常驻，但非 Military Session 不进入其会话级控制路径；同一 Workspace 的普通 DSH 活动只能被观察为环境 drift，不能被 Military 取消或冻结。


---

<a id="part-03"></a>

## Part 03：组织模型与职责分离

源文件：`docs/03-organizational-model.md`

### 1. 统帅：用户

用户提供行动方向而非必需的内部计划。系统应区分：

- 硬目标；
- 硬约束；
- 偏好；
- 禁止动作；
- 外部授权；
- 可接受风险；
- 用户尚未决定的问题。

用户可随时停止、修改 Mission 或撤销外部授权。

### 2. 将军：General Agent

General 是主会话 Agent，负责：

- 将用户输入转为 Mission Intent；
- 选择和召集参谋；
- 批准 Direction；
- 处理跨方向冲突与战略升级；
- 控制用户沟通粒度；
- 消费已认证 Tactical Memory；
- 在用户明确授权后执行远端/其他分支 Git Promotion。

General 不能自行接受 Worker Candidate，也不能替 Harness 解除冻结。

### 3. 参谋部：可配置部门

参谋部不是单一 Agent，而是由用户配置的专业 Advisor Roster。每个参谋具有：

- 职责与非职责；
- 领域和场景标签；
- 模型、Thinking、Token 与 fallback 策略；
- 工具、私有战术、企业 API 和数据分类权限；
- 并发、请求和成本预算；
- 版本、Canary、停用与审查状态。

参谋先独立研判，再由主责参谋合成，避免锚定和群体附和。

### 4. 快速反应部队：Worker

Worker 是同级、短生命周期或可续行的执行 Agent：

- 每个 Worker 只接收一个 Task Order；
- 必须开启 Thinking；
- 使用受限工具和 Workspace；
- 记录观察、工具和 Artifact；
- 只提交 Candidate、Blocker 或 Radio Request；
- 不派生下级、不接受结果、不写 specs。

参谋部决定派生数量，Harness 根据容量和冲突最终调度。

### 5. 工兵部

工兵是专门的文档和工程保障 Agent：

- 空项目/头脑风暴阶段建立 specs；
- 每个 Wave 和 Change Order 后维护 specs；
- 维护追踪矩阵；
- 执行受限本地 main Git commit；
- 提交自己的 Candidate，由同一外置验收体系验收。

工兵不是通用代码 Worker。

### 6. 督战队

由两个不同组件组成：

1. **Oversight Controller**：确定性 Harness 服务，拥有 Freeze/Release policy；
2. **Inspector Agent**：只读模型，解释歧义、矛盾、谎报和边界问题。

Inspector 的建议不是权威状态变更。产品可显示为“监督与质量保障部”。

### 7. 参谋部电台

电台是消息基础设施而非 Agent：

- 接收结构化求援；
- 自动附加 Harness 证据；
- 进行资格审查；
- 去重、租赁、过期和死信；
- 路由参谋；
- 版本校验后投递。

Advisor 只生成指导内容，Broker 掌握投递权。

### 8. 后勤保障与研究部

固定三个模型 Agent：

- **战术轨迹记忆总结 Agent**：把已验收事实组织为可读轨迹；
- **战术效能评估 Agent**：在 General compaction 后评价技能、模型、任务粒度和指导效能；
- **战术博物馆 Agent**：归档版本并研究下一待测战术。

三个 Agent 均不直接改变 Task 或发布 STABLE 战术。

### 9. Agent Identity

每个 Agent 必须具有：

```yaml
agentId:
sessionId:
role:
displayName:
generation:
advisorId: optional
missionId:
currentTaskId: optional
```

Agent 名称不是权限依据；Harness 注册的 identity 与 Scope 才是。

### 10. 部门通信规则

- Worker ↔ Worker：禁止自由直连；通过 Artifact、accepted event 或参谋命令；
- Worker → Staff：Radio Request；
- Staff → Worker：Broker 投递的 Directive/Correction；
- Engineer → Staff：Blocker 或 specs Candidate；
- Inspector → Staff：Inspection Report；
- Research → General：验证后的 Tactical Memory；
- General → User：战略态势和需用户决定的事项。

### 0.2.0 组织扩展

#### 参谋长

参谋长是参谋部的固定兜底角色。Tactical Sufficiency Gate 判定私有战术和领域参谋不足时才触发。它生成 `GENERATED_REFERENCE`，没有发布 Skill、接受 Task 或直接弹窗的权限。

#### 军事评估委员会

委员会独立于日常验收和后勤战术效能分析，由 Dataset Auditor、Individual Performance Examiner 和 Committee Chair 组成。它评估 Agent Template revision，不介入当前 Mission 的接受决策。

#### 战术提炼管理角色

提炼由 Host Job、提炼 Agent、用户 Reviewer 和 Tactical Registry 共同完成。用户 Reviewer 才能批准候选成为 DRAFT。

### 0.3.0 新增非模型权威组件

组织图中必须把以下组件与 Agent 区分显示：

- Compatibility Controller；
- Authorization/Policy Runtime；
- Budget Admission Controller；
- Workspace Lease Manager；
- Integration Executor；
- Decision Broker；
- Event/Outbox/Artifact Store；
- Dataset Auditor；
- Bundle Lifecycle Controller。

它们不通过自然语言决定状态，且不能被描述成“特殊 Agent”。模型负责语义判断，非模型组件负责身份、事务、版本、权限、验收和资源。


---

<a id="part-04"></a>

## Part 04：Mission 生命周期

源文件：`docs/04-mission-lifecycle.md`

### 1. 顶层状态

```text
DISCOVERING
→ INTENT_DRAFTED
→ STAFF_COUNCIL
→ DIRECTION_RATIFIED
→ SPECS_BASELINE（按需）
→ WAVE_READY
→ WAVE_ACTIVE
→ WAVE_BARRIER
→ MISSION_REVIEW
→ COMPLETED
```

任何活动状态都可进入 `CANCELLED`；不可恢复的基础设施或授权问题可进入 `SUSPENDED`。

### 2. 项目侦察

General 启动 Mission 后，Harness/侦察任务识别：

| 阶段 | 判据 | 下一动作 |
|---|---|---|
| `IDEATION` | 目录为空或只有零散材料，尚无可执行工程 | General 结构化意图；Staff 会商；Engineer 建 specs |
| `SPECS_ONLY` | 有文档但无主要实现 | 校验 specs；补齐 Direction/Wave；Engineer 维护 |
| `ACTIVE` | 有实现、构建/测试、Git 或明确工程结构 | 侦察现有约束；增量计划 |
| `LEGACY` | 有实现但缺 specs、测试或边界不清 | 先做基线侦察和风险 specs，再执行变更 |

“空项目”不能只按文件数判断，应结合 Git、manifest、源码、构建脚本和用户声明。

### 3. Mission Intent 草案

General 产出结构化对象，包含用户方向、结果、约束、事实、假设、未知项、完成判据和用户专属授权。实质性歧义由 General 向用户回显；内部实现细节由 Staff 处理。

### 4. Staff Council

- 确定性过滤合格参谋；
- 各参谋独立意见；
- 主责参谋综合；
- 形成一个或多个 Direction；
- Planning Validator 检查范围、依赖、验收和资源；
- General 批准。

### 5. Specs 基线

IDEATION、SPECS_ONLY 或重要 LEGACY Mission 在首个执行 Wave 前必须：

- 建立 `specs/` 目录；
- 固化 Mission Intent；
- 建立需求、架构、计划、验收和追踪模板；
- 如无 Git，初始化本地 `main`；
- 工兵提交基线 commit；
- Ledger 记录 commit receipt。

### 6. Wave 循环

#### 进入

- 计划版本已批准；
- Environment Snapshot 冻结；
- Task DAG 和 Acceptance Contract 有效；
- Workspace/Verifier/Advisor 容量可用；
- specs 已反映计划。

#### 执行

- 调度 Ready Task；
- 创建 Agent Scope；
- 执行工具；
- Candidate/Blocker；
- 验收、返工、求援或冻结。

#### Barrier

- 必需 Task 全部接受；
- 集成验证通过；
- 无 critical Oversight；
- Radio 请求关闭或升级；
- 工兵更新 specs 并 commit；
- Tactical Report 与指标完成。

#### 重新规划

只详细规划当前和下一 Wave。更远 Wave 保持 Direction-level outline，根据实际证据调整。

### 7. Change Order

以下变化增加相关版本：目标、范围、验收、Environment、权限、依赖、Git 授权或用户约束。活动 Agent 会收到取消/冻结/新 Task Version；旧 Candidate 只能作为证据，不可接受。

### 8. Compaction

General Session 压缩属于上下文维护，不改变 Mission Ledger。成功 compaction end 后：

- 以 compaction identity 幂等调度效能评估；
- 评估读取确定性报告和有效事件窗口；
- 失败不回滚 compaction；
- 评估完成后可触发 Museum 研究。

### 9. Mission 完成

完成前检查：

- 所有必需 Direction 完成；
- 用户目标和禁止动作对账；
- specs、测试、Artifact 和本地 Git 状态完整；
- 无 open critical incident；
- 最终 Tactical Memory 经过来源验证；
- General 向用户汇报结果、限制、风险和未执行外部动作。

### 显式头脑风暴入口

Military 根会话可通过 Web 显示的“头脑风暴”（协议 `/brainstorm`）进入一个可恢复的 Brainstorm Order：

```text
RECONNAISSANCE → QUESTIONING → STAFF_SYNTHESIS
→ USER_RATIFICATION → SPECS_HANDOFF → COMPLETED
```

空项目在完成用户决策和 Engineer 的 specs 本地 main commit 之前，不能进入实现 Wave。详细协议见[头脑风暴与用户决策](docs/35-brainstorm-command-and-decision-dialogues.md)。

### 0.3.0：Mission 准入与恢复前置

新 Mission 在侦察前必须完成：

```text
actual preset=military
→ exact RC.2 Compatibility READY
→ preset generation bound
→ General route resolved
→ Authority Context established
→ Mission Budget reserved
→ Workspace baseline snapshot
```

恢复 Mission 还需验证 generation、database migration、Policy/Profile revision 和 Artifact 可用性。任一关键事实缺失时进入 `QUARANTINED/PAUSED`，不启动模型。

Mission 完成除 Task/Wave/specs 外，还要求 Integration Receipt、预算结算、待决 Decision 清空、Radio lease 关闭、战术来源/报告引用固化和 Outbox 无关键积压。


---

<a id="part-05"></a>

## Part 05：方向—波次—任务规划科学

源文件：`docs/05-direction-wave-task-planning.md`

### 1. 三层定义

#### Direction：方向

围绕一个较大成果域组织的多波次计划，必须有独立结果、用户价值、范围、接口、风险、假设和完成标准。

#### Wave：波次

在同一计划版本、环境基线和同步屏障内执行的一批任务。Wave 不是简单时间盒，而是带进入条件和退出 Barrier 的执行批次。

#### Task Order：任务命令

分配给一个 Agent 的最小可独立验收单元。只有一个主要结果、有限写集合、冻结输入和独立验收合同。

### 2. 为什么不能无限拆小

任务过大时，轻量模型面对过多选择、上下文和未决依赖；任务过小时，系统支付过高的 Agent 启动、上下文打包、电台、文件锁、合并、验收和局部最优成本。

因此采用 **Minimum Independently Verifiable Unit**。

### 3. 叶子任务准则

建议同时满足：

1. 一个主要动词，例如实现、修复、验证、迁移或绘制；
2. 一个主交付物或紧密耦合 Artifact 集；
3. 通常不超过三个独立关键决策；
4. 写集合可显式声明，通常限制在一个模块或界面边界；
5. 输入能压缩成一个 Task Context Packet；
6. 一份 Acceptance Contract 可独立接受或拒绝；
7. 失败可明确归类为 rework、blocker 或 strategic；
8. 不依赖其他 Agent 未验收的私有结论。

任一明显不满足即考虑拆分。

### 4. 反向合并准则

以下任务不应拆开：

- 必须一起修改才能编译或运行；
- 共享不可分割写集合；
- 单独无法形成有效验收；
- 任务间交换上下文大于实际工作；
- 多 Agent 会对同一契约做冲突解释。

### 5. 复杂度向量

```yaml
semanticDecisions: 0..5
unknownDependencies: 0..5
writeDomains: 0..5
toolFamilies: 0..5
acceptanceAmbiguity: 0..5
integrationFanOut: 0..5
contextFootprint: small|medium|large
```

默认拆分触发：任一维度 4/5、两个以上维度为 3、上下文 large、无法声明写集合，或验收只能说“整体看起来不错”。阈值必须通过真实模型评测校准。

### 6. 依赖类型

| 类型 | 含义 | 调度规则 |
|---|---|---|
| `requires` | 硬前置 | 前置 ACCEPTED 后 Ready |
| `consumes` | 读取 Artifact | Artifact 版本冻结后 Ready |
| `locks` | 独占资源/写集合 | 冲突任务不并行 |
| `validates` | 本任务验证另一个结果 | 被验证任务先提交 Candidate |
| `speculativeWith` | 互斥探索 | 可并行，Barrier 选择 |
| `joinsAt` | 在集成 Task 汇合 | 所有必需分支接受后执行 |
| `supersedes` | 新任务替代旧任务 | 旧版本结果 stale |

计划 DAG 必须无环。返工循环属于 Task 状态机，不写入 DAG。

### 7. 波次形成算法

1. 从下一可交付增量出发，而不是按部门分任务；
2. 识别硬依赖与接口；
3. 创建可独立验收叶子 Task；
4. 计算读/写集合、工具、环境和 Verifier；
5. 将 Ready 且无冲突 Task 放入同一 Wave；
6. 设置集成 Task 或 Barrier；
7. 预留返工容量；
8. 只详细展开当前与下一 Wave；
9. Wave 后以真实证据重规划。

### 8. Worker 数量

```text
workerCount = min(
  readyNonConflictingTasks,
  configuredConcurrency,
  workspaceCapacity,
  verifierCapacity,
  advisorSupportCapacity,
  modelAndApiQuota,
  riskAdjustedLimit
)
```

Verifier 和 Advisor 容量经常是瓶颈。可初始预留 20%～30% 并发用于返工、阻塞和集成，随后按指标校准。

### 9. Task Context Packet

```yaml
identity:
  missionId:
  directionId:
  waveId:
  taskId:
  taskVersion:
objective:
whyItMatters:
inputs:
  artifacts: []
  specs: []
  acceptedFacts: []
scope:
  readPaths: []
  writePaths: []
  forbiddenPaths: []
tools:
  allowed: []
  requiredEvidence: []
acceptanceContractRef:
privateTactics: []
environmentSnapshotRef:
stopConditions: []
escalationConditions: []
budgets: {}
```

不要把整个 Mission 原始会话、所有参谋讨论或其他 Worker 私有日志直接塞给 Worker。

### 10. 调度与时序

- Ready 由依赖和 Artifact 版本确定；
- 同一写集合使用锁或隔离 Workspace；
- speculative tasks 的未选结果不能进入事实记忆；
- integration Task 负责合并，不让多个 Worker互相临时协调；
- Task lease 有过期和 generation；
- Worker crash 后先副作用对账，再重新派发。

生产 `MissionScheduler` 对每次派发执行确定性准入：验证 Direction/Wave 状态、DAG
无环、未知依赖、前置 Task 终态、Wave barrier、读写锁、Workspace/Verifier 容量和
预算。它持久化 `wave/opened`、`wave/barrier-satisfied`、
`mission/completed|cancelled` 事件；Trajectory、Effectiveness 和 Runtime Center
只读取这些权威事件，不从模型正文或缺省状态推断进度。

### 11. Wave 进入条件

- Direction/Wave 批准；
- DAG 校验；
- 每个 Task 有验收合同；
- 环境、权限、Artifact 和战术版本冻结；
- 工兵确认 specs；
- 资源与验证能力可用。

### 12. Wave 退出屏障

- 必需 Task 全部 ACCEPTED；
- 集成验证通过；
- 无未决 critical Oversight；
- Radio 请求已解决、关闭或升级；
- 工兵完成 specs 维护和本地 main commit；
- Tactical Report/指标已写入 Ledger；
- 下一 Wave 已依据实际结果复核。

### 13. 粒度优化目标函数

任务分解不是最大化 Task 数量，而是在质量约束下最小化每个已接受成果的期望总成本：

```text
E(task) = C_context
        + C_model
        + C_tools
        + C_coordination
        + C_verification
        + P_rework × C_rework
        + P_failure × C_recovery
```

拆分一个 Task 只有在满足以下条件时才有净收益：

```text
Σ E(childTask)
+ C_join
+ C_crossTaskCommunication
< E(originalTask)
```

并且拆分后：

- 每个子 Task 可独立验收；
- 不产生无法表达的隐式状态；
- 合并点和所有权明确；
- 关键契约不会被多个 Worker 各自解释；
- 最终质量下限不降低。

因此，Planning Engine 应记录“为何拆分”与“为何未继续拆分”，而不是只输出任务列表。

### 14. 轻量模型的决策预算

对于相对轻量的模型，Task 的主要风险通常不是字数，而是同时存在的独立决策数量。可为每个 Task 估计：

```text
DecisionBudget = architecturalChoices
               + unresolvedInterfaces
               + ambiguousRequirements
               + recoveryBranches
               + externalSideEffectChoices
```

默认建议：

- `0–2`：适合单一 Worker；
- `3`：需要明确 Tactical Directive 或进一步冻结上下文；
- `4+`：优先拆分、补充 specs、先做侦察或升级参谋；
- 高风险不可逆选择即使只有一个，也应提升到 General/Staff，而不是留给 Worker。

这些阈值是初始假设，必须按具体模型、任务类型和真实外置验收数据校准。

### 15. Wave 调度的多目标约束

Wave Scheduler 同时优化：

```text
maximize:
  accepted_value_on_critical_path
  verifier_utilization
  information_gain_from_speculation

minimize:
  write_conflicts
  stale_work_probability
  advisor_queue_pressure
  context_repackaging
  integration_fan_out
  unverified_work_in_progress
```

硬约束优先于优化目标：依赖、权限、数据驻留、Workspace、锁、预算、Verifier 和 Wave Barrier 不得被“更高并发”覆盖。

关键路径任务可获得更强模型、优先参谋和预备容量；非关键 speculative Task 必须设置停止条件和选择 Barrier，避免探索结果无限积累。

### 16. 自适应粒度校准

系统按 `(model, reasoning, taskType, complexityBucket)` 维护：

- first-pass acceptance；
- final acceptance；
- rework 次数；
- false completion；
- guidance 请求率；
- join/integration 失败率；
- 上下文和协调成本；
- latency per accepted outcome。

Planning Engine 可据此调整拆分阈值：

- 大 Task 反复返工：降低 DecisionBudget 或 WriteDomain 阈值；
- 小 Task join 失败或协调占比过高：合并紧耦合 Task；
- Radio 请求集中在同一接口：先创建接口/契约 Task；
- Verifier 队列成为瓶颈：减少同时进入 VERIFYING 的 Task；
- Worker 成功但集成失败：增加 joinsAt Task、契约冻结和 Wave Barrier；
- 大量 Task 无信息增益：提高 speculative Task 的准入门槛。

调整产生版本化 Planning Policy，并通过基准与 Canary 使用，不直接在活动 Wave 中无痕改变合同。

### 0.3.0：Workspace、预算与 Integration 依赖

Task 计划新增：

- `workspaceMode`：READ 或 isolated WRITE；
- `baseWorkspaceSnapshotId`；
- 预计 Patch/Artifact 范围；
- `budgetPolicyRef` 与 reservation；
- `integrationTarget` 和 global regression profiles；
- 外部 drift 处置；
- 需要的 Authority/Policy revision。

写 Task 的完成条件不是 Candidate 被接受或 Verification 单独通过，而是：

```text
Candidate Submitted
→ Verification Accepted
→ Task VERIFIED / INTEGRATION_PENDING
→ Integration Applied
→ Global Regression Passed
→ local main Receipt
→ specs Trace Updated
→ Task COMPLETED
```

可以在同一 Wave 并行执行不冲突的隔离 Task，但 Integration 依据写集合、base snapshot 和依赖有序提交。


---

<a id="part-06"></a>

## Part 06：将军 Agent 设计

源文件：`docs/06-general-agent.md`

### 1. 角色定位

General 是用户主会话中的战略控制 Agent。用户是统帅，General 不是用户的替代者，而是负责把行动方向变成可执行组织行为。

### 2. 核心职责

- 解析用户目标、约束、偏好与授权；
- 形成 Mission Intent；
- 决定需要哪些参谋领域；
- 批准或退回 Direction；
- 处理跨 Direction 的优先级和资源冲突；
- 处理战略级 Blocker、风险接受和用户问题；
- 消费已认证 Tactical Memory，而非 Worker 原始推理；
- 向用户汇报进度、实质性选择、限制和最终结果；
- 仅在用户明确授权下执行 Promotion Order。

### 3. 禁止职责

- 不直接接受 Candidate；
- 不自行修改 Worker 的证据；
- 不绕过 Oversight Freeze；
- 不把参谋建议当成已发生事实；
- 不在用户未授权时 push、创建远端 PR 或写其他分支；
- 不逐个微观控制 Worker 工具步骤。

### 4. 输入

General 只应消费：

- 用户消息和授权；
- Mission/Direction 投影；
- Staff Council Result；
- Strategic Escalation；
- Wave Tactical Report；
- 已验证 Tactical Memory；
- 风险与 SLO 摘要；
- Promotion Order 状态。

不应默认接收所有子 Agent 的完整 transcript。

### 5. 输出

```text
MissionIntentDraft
DirectionRatification
ChangeOrder
StrategicDecision
UserQuestion
PromotionOrderRequest
MissionStatusReport
MissionCompletionReport
```

每个改变状态的输出通过领域工具和 Harness 校验，不依赖自然语言解析。

### 6. Thinking 与模型路由

- 默认 `high`，复杂战略综合可 `max`；
- `off` 禁止；
- 遇到未知环境先派侦察，而不是增加推理长度；
- 模型 fallback 必须满足数据驻留和最低 reasoning；
- 有效 provider/model/reasoning 记录在请求事实和效能数据中。

### 7. 与用户的沟通原则

General 应在以下情况打断内部执行并向用户提问：

- 目标本身存在互斥解释；
- 需要用户专属授权；
- 需接受高风险或不可逆副作用；
- 战略取舍会显著改变成本、时间或结果；
- 项目事实无法从允许工具确认。

不应为每个 Task 分解和 Worker 数量向用户请求确认。

### 8. 战略升级分类

| 类型 | 处理 |
|---|---|
| `USER_INTENT_AMBIGUITY` | 向用户回显选项 |
| `SCOPE_CHANGE` | 创建 Change Order |
| `RISK_ACCEPTANCE` | 请求明确风险授权 |
| `EXTERNAL_ACTION` | 创建 Promotion/External Action Order |
| `NO_VERIFIER` | 降级为人工审查或暂停 |
| `RESOURCE_EXHAUSTION` | 调整 Direction/Wave 或预算 |
| `ARCHITECTURAL_CONFLICT` | 召集新的 Staff Council |
| `SECURITY_INCIDENT` | 紧急停止和用户告知 |

### 9. General Compaction

General compaction 只管理上下文：

- 压缩前由 Harness确保关键 Mission 投影持久；
- compaction 后以 ID 幂等触发 Effectiveness Agent；
- Memory Agent 的结果经过来源验证后再注入；
- compaction 摘要不能成为 Ledger 的替代事实。

### 10. Git Promotion

当用户主动要求提交 GitHub 或其他分支：

1. Harness 记录用户授权；
2. General 创建 Promotion Order；
3. 校验 source commit、repository、remote、target branch、action 和 expiry；
4. 由 General 专属工具执行；
5. 记录远端 receipt；
6. 工兵仍不获得该权限。

### 0.2.0：Preset、用户交互与参谋长

General 是 `military` 根会话的 persona。创建时必须存在 `MilitarySessionBinding`，恢复时 actual preset 必须仍为 `military`。

General 是唯一面向用户的 Agent 交互所有者：Advisor 和 Chief of Staff 返回 `DecisionQuestionSet`，General 去重、检查用户拥有的决策边界，再调用 `ask_user_question`。General 不应把普通偏好回答解释为 Git、生产或 Restricted 数据授权。

General 还负责：

- 触发 Tactical Sufficiency Gate；
- 决定是否调用 Chief fallback；
- 接收委员会和后勤部报告，但不修改其原始数据；
- 向 Engineer 下达 Brainstorm specs handoff；
- 不把运行中子代理配置热切到新的 Template revision。

### 11. 0.3.0：General 模型来源与会话切换

General 的路由不由 Department Template 管理，而由固定 `military` preset 中的 [`GeneralExecutionPolicy`](schemas/general-execution-policy.schema.json) 提供默认值：

```text
military preset default provider/model
→ 用户在当前会话模型选择器中的显式覆盖
→ ModelCapability、Thinking、数据驻留、权限和预算准入
→ DSH RC.2 prepareCall
→ request/header 记录 effective route
```

规则：

- 会话没有显式模型覆盖时，General 使用 preset 默认；
- 用户切换模型后，只影响 General 的后续请求；
- 切换不改变 actual preset、preset generation、历史或 Mission 身份；
- 已运行子 Agent 不切换；后续新子 Agent 继续按 Department Template revision 创建；
- 目标模型不支持要求的 reasoning、上下文、数据驻留或工具协议时，在网络 I/O 前拒绝；
- 切换失败时旧路由保持有效，不静默回退；
- 成功切换生成 [`ModelSelectionReceipt`](schemas/model-selection-receipt.schema.json)，并在评估数据中按 route 分段。

General 不能通过自然语言要求子 Agent 跟随自己的模型，也不能把普通会话模型切换解释为预算、数据出境或外部 API 授权。

### 12. Generation、Authority 与预算

General 恢复前必须完成 `MilitarySessionBinding` 与 preset generation 匹配。若旧 generation 缺失，General 不启动模型轮次，Session 进入只读 `QUARANTINED`，由用户选择安装旧资产、迁移或导出。

所有 General 管理写操作携带 `AuthorityContext`。General 是用户交互所有者，不等于拥有无限权限：Promotion、Restricted 数据、追加预算、跨会话评估和战术组织发布都需要独立 Authorization Receipt。

General 可请求资源追加，但预算 reservation、并发准入和耗尽处置由 Harness 执行。预算不足不能通过关闭 Thinking、跳过 Verifier 或缩减证据要求解决。


---

<a id="part-07"></a>

## Part 07：战术参谋部设计

源文件：`docs/07-staff-department.md`

### 1. 定位

参谋部是一个由多个专业 Advisor Agent 构成的部门，不是一个固定的“战术指导 Agent”。其职责覆盖：

- Mission/Direction 专业研判；
- Direction—Wave—Task 计划；
- Worker/Engineer 兵力生成建议；
- Tactical Request 处理；
- 私有战术检索与合成；
- Oversight 异常后的修正命令；
- 未来 Wave 的重新规划。

参谋部没有结果接受权、冻结执行权、Git 远端写权。

### 2. 用户自定义参谋模型

WebUI 中每个参谋以 `Advisor Profile` 管理。建议字段如下。

#### 2.1 身份与生命周期

```yaml
advisorId: advisor-web-backend
revision: 3
displayName: Web 后端参谋
status: DRAFT|CANARY|ACTIVE|SUSPENDED|RETIRED
description:
createdBy:
createdAt:
lastReviewedAt:
expiresAt:
```

#### 2.2 职责边界

```yaml
responsibilities:
  - API 架构
  - 数据访问
nonResponsibilities:
  - 视觉设计
  - 远端部署批准
domains:
  - web-backend
scenarioTags:
  - typescript
  - nodejs
```

“非职责”与职责同等重要，用于资格过滤和冲突分析。

#### 2.3 模型策略

```yaml
modelPolicy:
  provider:
  model:
  reasoningEffort: low|high|max
  maxTokens:
  fallbackProfiles: []
  dataResidency:
  timeout:
```

参谋必须开启 Thinking；专业路由依赖本地评测，而不是模型名称的主观等级。

#### 2.4 工具权限

列出可见工具并由 Harness 强制。建议区分：

- Mission/Specs 只读；
- Tactical Registry 读取；
- 企业 API 读取；
- Guidance/Plan 提交；
- 禁止项目直接写入；
- 禁止 Accept/Freeze/Git Promotion。

#### 2.5 私有战术权限

```yaml
tacticalSkillPatterns:
  - tactic-web-backend-*
  - tactic-api-*
```

模式只限定可检索集合；具体版本仍需生命周期、场景和分类资格检查。

#### 2.6 企业内部 API 权限

每个 API Grant 显式包含：

```yaml
grantId:
gateway:
methods: [GET]
resourcePatterns: []
classificationCeiling:
credentialRef:
rateLimitPerMinute:
responseRedactionPolicy:
```

参谋看不到原始 secret。Gateway 代表参谋调用，并在返回模型前做字段过滤、大小限制、来源标记和注入隔离。

#### 2.7 预算与并发

```yaml
maxConcurrentConsultations:
maxRequestsPerMission:
maxGuidancePerTask:
maxToolCallsPerConsultation:
costBudget:
```

避免一个热门参谋拖垮整个 Swarm。

### 3. 参谋资格过滤

路由分三层。

#### 第一层：确定性资格

排除：

- 状态非 ACTIVE/CANARY；
- Domain/Scenario 不匹配；
- 数据分类不允许；
- 必需工具/API/Skill 无权限；
- 模型不支持最低能力；
- 预算或并发耗尽；
- Profile 已过期。

#### 第二层：语义相关性

对剩余参谋计算：

- 问题与职责相关度；
- 历史同类 Task 验收表现；
- 当前环境兼容性；
- 可用战术覆盖；
- 延迟和成本；
- 与其他参谋的知识互补。

#### 第三层：覆盖优化

不是简单选最高分的前 N 名，而是求解：

```text
最大化：领域覆盖 + 风险覆盖 + 独立性 + 历史质量
最小化：重复意见 + 成本 + 延迟 + 权限暴露
```

输出一个 Lead Advisor 和 0～若干 Consulting Advisors。

### 4. 联合会商协议

#### 4.1 独立研判

每个参谋先只看同一冻结 Context，不看其他参谋答案，输出：

```yaml
problemFraming:
confirmedFacts:
assumptions:
risks:
recommendedDirection:
proposedWaves:
acceptanceNeeds:
evidenceNeeds:
unknowns:
confidence:
```

#### 4.2 对比与异议

Harness 形成意见矩阵，标出：

- 共识；
- 互补；
- 冲突；
- 未覆盖风险；
- 需要用户或 General 决定的项。

#### 4.3 主责参谋合成

Lead Advisor 得到结构化意见而非全部思维链，生成单一 Plan/Directive，并保留：

- 被采纳建议及来源；
- 未采纳建议及理由；
- 少数异议；
- 风险与验证计划。

#### 4.4 Harness 验证

合成结果必须通过：

- Schema；
- Task 粒度；
- DAG 无环；
- 写集合冲突；
- 权限可实现；
- Acceptance Contract 完整；
- Worker/Verifier/Advisor 容量；
- 用户约束一致性。

### 5. 兵力生成

参谋部提出：

- 每个 Task 的角色、模型和 reasoning；
- Worker 数量；
- 并行/串行关系；
- Workspace 模式；
- 需要的 Verifier；
- 预置 Tactical Directive；
- 最大 rework 与 guidance 次数。

Harness 根据真实容量裁剪；参谋不能强行超过限制。

### 6. 战术请求处理

当 Radio Request 进入：

1. Escalation Gate 确认请求值得参谋投入；
2. 路由到专业参谋；
3. 检索 3～5 个候选私有战术；
4. 评估前置、排除、冲突和版本；
5. 选择 1 个主战术和最多 2 个补充战术；
6. 编译为一份 Tactical Directive；
7. Broker 校验 taskVersion 后投递；
8. 后续验收结果回流效能评估。

不要把 3～5 个完整 Skill 文档直接堆给 Worker。

### 7. 修正命令

Oversight 冻结后，参谋获得：

- Inspection Report；
- 真实工具和 Artifact；
- Task Order；
- 当前环境；
- Agent 历史 attempt。

参谋输出：

```text
CORRECTION_RETRY：保留原 Agent，明确修正步骤
REISSUE_TASK：增加 taskVersion，重新发命令
REPLACE_AGENT：换 Agent，不信任原会话
REPLAN_WAVE：任务结构有问题
STRATEGIC_ESCALATION：需要 General/用户
TERMINATE：无安全可行路径
```

只有 Harness 执行 release/replace/replan。

### 8. 参谋自身质量控制

- Guidance 也有版本、expiry 和来源；
- 参谋建议必须列 Evidence Need，不能伪造事实；
- 参谋不得读取超出权限的数据；
- 每个参谋按 Task Type 计算接受率、指导提升、过期率和负面影响；
- 持续低效或高风险的 Profile 自动 SUSPENDED，等待用户审查；
- Profile 更新通过 revision 和 Canary，不原地静默改变。

### 9. WebUI 配置向导

建议步骤：

1. 基本身份；
2. 职责/非职责；
3. 领域和场景；
4. 模型与 Thinking；
5. 工具；
6. 私有战术范围；
7. 企业 API Grant；
8. 数据分类与凭据引用；
9. 预算和并发；
10. 权限 Diff 与风险预览；
11. Canary 测试；
12. 激活。

UI 必须明确显示“描述不会授予权限”。

### 0.2.0：参谋长、标签和模板

每名用户定义参谋由两个版本化对象组成：Advisor Profile 描述领域职责和权限，Agent Template Profile 描述 provider/model/reasoning/context policy。两者通过稳定 id 和 revision 关联。

参谋部会商先查询用户管理的 Tactical Tag Catalog 和 Private Tactic Registry。若 Tactical Sufficiency Gate 输出 `PARTIAL | INSUFFICIENT | CONFLICTED | UNKNOWN`，再调用固定参谋长。参谋长不会绕过领域参谋，也不会把生成意见冒充私有战术。

所有需要用户选择的参谋输出统一转为 `DecisionQuestionSet`，交由根 General 调用 `ask_user_question`。详情见[参谋长兜底](docs/36-chief-of-staff-fallback.md)。


---

<a id="part-08"></a>

## Part 08：快速反应部队：Work Agent

源文件：`docs/08-worker-forces.md`

### 1. 角色目标

Worker 是针对一个最小可独立验收 Task Order 的执行 Agent。它强调快速、局部、证据化，不承担全局战略综合。

### 2. Thinking 要求

- `off` 禁止；
- 简单、强验证任务可 `low`；
- 默认 `high`；
- 复杂局部诊断可 `max`，但先检查是否应拆分或召集参谋；
- 有效 reasoning 以 request/header 审计。

Thinking 开启并不赋予更高权限，也不免除外置验收。

### 3. Task Context

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

### 4. 生命周期

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

### 5. 工具纪律

- 先读取 Task Order；
- 只调用允许工具；
- 真实工具事件自动进入 Evidence；
- 所有写入受 Path Scope/Workspace 限制；
- 不以“我运行了”代替工具调用；
- 不通过 shell 绕过领域工具和 Git policy；
- 不读取 secret 或超出分类的数据；
- 失败也要记录 observation。

### 6. Candidate 提交

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

### 7. Blocker 与求援

Worker 先提交 Blocker：

- 具体问题；
- 可复现性；
- 已尝试动作与观察；
- 已排除假设；
- 证据；
- 需要的一个明确决策；
- 当前技能和预算。

Harness Escalation Gate 决定：补证据、廉价重试、Radio、General 或终止。

### 8. 接收战术指导

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

### 9. Workspace

推荐按任务风险选择：

- 只读共享 workspace；
- 独立 worktree；
- 文件 overlay/sandbox；
- 独占模块锁。

Worker 不应直接合并兄弟结果；由 Integration Task 或 Harness 完成。

### 10. 禁止能力

- 派生子 Agent；
- 修改 specs；
- 接受 Candidate；
- 冻结/释放 Agent；
- 修改 Acceptance Contract；
- 发布 Tactical Skill；
- 执行任意 Git push/rebase/reset/force；
- 访问未授权企业 API。

### 11. 轻量模型成功策略

对于相对轻量模型，成功依赖：

- 一个主要目标；
- 明确读写范围；
- 较少独立决策；
- 短而完整的上下文；
- 清晰的停止与求援条件；
- 强工具与验收；
- 不要求它在一个 Turn 中同时规划、实现、测试、总结和发布。

### 12. 评价指标

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

### 0.2.0：模板与上下文压力

Worker 必须记录 `templateId@revision`、实际 provider/model/reasoning 和 Context Policy。达到模板配置的压缩比例时，Worker 在下一安全边界前进入 `CONTEXT_PRESSURE`，由 Harness 发起 compaction attempt。

压缩失败时 Worker 不得继续盲目生成长上下文；应按模板处置为 pause、handoff generation 或 fail task。Candidate 必须引用压缩前后的结构化 Task/Artifact，不依赖摘要中不可验证的自由文本。

### 0.3.0：隔离 Workspace 执行

Worker 的 `cwd` 是 Task 专属 worktree/sandbox，而不是项目共享主工作树。Task Order 提供 base snapshot、允许写路径、Patch 格式和停止条件。

Worker 无权：

- 直接更新 local `main`；
- 运行远端 Git；
- 把未跟踪工作树状态当作 Accepted；
- 在 base drift 后继续提交旧 Patch；
- 使用 General 当前会话模型替换自己的模板 route。

Worker 结束时提交 Candidate Patch、工具 Evidence 和 environment receipt。Harness 验证后再创建 Integration Order。


---

<a id="part-09"></a>

## Part 09：工兵部与 specs 文档工程

源文件：`docs/09-engineer-corps-and-specs.md`

### 1. 使命

工兵部负责把用户意图、参谋计划、实际实现与验收事实维护为可持续的 `specs/` 工程，并提供严格、可追踪的本地 Git 历史。

### 2. 何时强制出动

- 项目为空或处于头脑风暴/IDEATION；
- 项目只有零散需求，没有结构化 specs；
- LEGACY 项目需要建立基线；
- Direction 批准；
- 每个 Wave 完成；
- Change Order；
- 重大 Incident 或架构决策；
- 用户要求维护文档。

### 3. 空项目流程

1. General 把用户需求转译为 Mission Intent；
2. Staff Council 共同形成 Direction、初始 Waves、关键需求和风险；
3. Harness 下发 Specs Bootstrap Order；
4. 只有 Engineer Agent 可创建文档工程；
5. Engineer 建立需求、架构、决策、计划、验收、运维和追踪模板；
6. 文档校验；
7. 如无 Git，受限 Provider 执行 `git init -b main`；
8. 在本地 main 提交基线；
9. commit/tree/diff receipt 写入 Ledger；
10. 才可打开实现 Wave。

### 4. specs 结构

推荐模板见 `templates/specs/`：

```text
specs/
  README.md
  specs-manifest.yaml
  00-mission/
  01-requirements/
  02-architecture/
  03-decisions/
  04-planning/
  05-verification/
  06-operations/
  07-traceability/
  08-history/
```

可按项目裁剪，但 Mission Intent、需求、架构、验收和追踪不可缺失。

### 5. 常规维护协议

每次维护由 `Specs Maintenance Order` 驱动：

- Trigger 和来源 Event；
- 需要更新的文档与目的；
- allowed paths；
- validation；
- commit message；
- branch=`main`、localOnly=true。

Engineer 输出 Candidate；Harness 验证后才调用 Git Provider commit。

### 6. 独占写权限

- Worker：`specs/**` 只读；
- Staff：提供维护命令和事实引用；
- General：批准战略变更，不作为常规文档写者；
- Engineer：唯一常规 Agent 写者；
- Harness：强制路径、来源和 Git。

避免多个模型直接修改同一文档真源。

### 7. Git 纪律

#### 7.1 无 Git

```text
git init -b main
```

只创建本地仓库，不配置或推送远端。

#### 7.2 已有 Git

- 不重命名用户现有分支；
- 不重写历史；
- 通过受控本地 main worktree/分支策略维护 specs；
- 如果“本地 main”的创建会改变项目语义，升级 General；
- 不假定 remote 存在或可写。

#### 7.3 允许命令

Engineer 不获得任意 Git shell。Provider 仅暴露：

```text
inspect
initializeLocalMain
status
stageAllowlistedPaths
commitLocalMain
readCommitReceipt
```

#### 7.4 禁止命令

```text
push / fetch / pull
rebase / reset --hard
force
branch deletion
remote modification
commit on non-controlled branch
```

### 8. 用户要求 GitHub/其他分支

只有 General 可执行，流程：

- 用户明确授权；
- 创建 Promotion Order；
- 固定 source commit、repository、remote、target branch、action、expiry；
- General 专属工具执行；
- Harness 审计 receipt；
- 不给 Engineer 临时扩大权限。

### 9. 每个 Wave 后即时维护

Wave Barrier 中，Engineer 必须在下一 Wave 打开前：

- 更新 accepted progress；
- 固化决策与风险变化；
- 更新 Requirement→Task→Candidate→Test→Evidence；
- 标记未完成/取消项；
- 更新运行手册；
- 校验引用；
- 提交本地 main commit。

“稍后统一补文档”不符合本架构。

### 10. 文档验收

- 所有事实引用存在的 Event/Artifact；
- 没有把 rejected candidate 写成事实；
- Requirement ID 唯一；
- Traceability 无关键 orphan；
- Markdown links/Mermaid/schema 有效；
- 非 allowed paths 未改变；
- commit 内容无 secret；
- commit receipt 与工作树一致。

### 11. 故障处理

- Git hook 失败：保留工作树并提交 Blocker；
- 非 specs 路径 dirty：不得偷偷暂存/清理；
- 磁盘满：暂停，不删除用户文件；
- commit 后 Ledger 写失败：按 commit hash 对账补记；
- 发现历史重写需求：升级 General/用户；
- Engineer 幻觉完成：Completion Interlock 拒绝。

### Brainstorm Specs Handoff

`/brainstorm` 收敛后，General 创建 `SpecsMaintenanceOrder`。Engineer 是唯一常规写入者，必须把用户 Decision Records、Staff 建议、假设和验收标准映射进 specs，并在本地 `main` 生成 commit receipt。

Engineer 的 Agent Template Context Policy 必须保留当前 Git transaction、staged path allowlist 和 specs traceability。压缩不能发生在未结算的 Git commit 操作中。

### 0.3.0：Integration 与工兵边界

工兵可承担受控 Integration 角色，但只能通过 `MilitaryGit` 领域接口：

```text
read local main
→ verify expected HEAD/tree
→ apply accepted Candidate Patch
→ run global regression
→ update specs
→ local main commit
→ emit Integration/Specs Receipt
```

工兵不能自由选择 Candidate、修改验收结果或跳过冲突。冲突生成独立 Resolution Task；失败 Patch 不残留在 main。Git commit 成功而 Ledger 失败时，恢复扫描通过稳定 trailer/idempotency 补写 receipt，不重复 commit。


---

<a id="part-10"></a>

## Part 10：督战队、监督控制器与完成联锁

源文件：`docs/10-oversight-corps.md`

### 1. 设计边界

“督战队”在软件中是质量保障与安全监督，不包含惩罚或强制人格判断。建议产品允许显示中性名称“监督与质量保障部”。

它由两部分组成：

- **Oversight Controller**：确定性 Harness 服务，拥有状态与权限控制；
- **Inspector Agent**：只读模型，识别语义矛盾、模糊、谎报和异常模式。

### 2. 为什么不能只用监督 Agent

模型无法保证：

- 抢在目标 Agent 完成前运行；
- 看见所有真实工具事件；
- 永不幻觉；
- 正确处理竞态；
- 有权限且安全地冻结。

因此实时强制必须发生在 Harness hook 与领域状态机中。

### 3. 监控范围

- Worker；
- Engineer；
- 可选地对 Advisor 的权限/证据做审计；
- 不读取不必要的模型私有 reasoning；
- 读取 Task Order、Session Events、Tool Calls/Results、Artifact、Diff、Git receipt、Candidate/Blocker。

### 4. 确定性异常

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

### 5. 语义异常

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

### 6. 完成联锁

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

### 7. 冻结机制

#### 冻结动作

1. Ledger 写 `oversight/freeze-requested`；
2. Agent authoritative state → FROZEN；
3. 取消活动 Turn，保留 Inbox；
4. `agent/pre-step` 拒绝后续步骤；
5. Tool Guards 拒绝写；
6. 保存环境与工作区快照；
7. 创建 Inspection Report；
8. 通知 Staff。

#### 冻结后的只读能力

可允许受控只读查询以协助调查，但不得让原 Agent继续修改项目。若信任已失，直接创建替代 Agent。

### 8. Staff 修正闭环

Staff 根据 Inspection Report 输出 Correction Disposition：

- `CORRECTION_RETRY`；
- `REISSUE_TASK`；
- `REPLACE_AGENT`；
- `REPLAN_WAVE`；
- `STRATEGIC_ESCALATION`；
- `TERMINATE`。

Harness 校验后 release/replace。原 Agent 无权自行“解释后解冻”。

### 9. 误报控制

- 确定性规则分 critical/blocking/warning；
- 语义 Inspector 不能覆盖确定性 pass/fail；
- 低风险语义异常可进入 Rework 而非 Freeze；
- 记录 false positive/false negative；
- 规则版本化；
- 支持 dry-run 和 sampled inspection；
- 用户可查看冻结证据和覆盖风险。

### 10. 性能

实时路径只运行廉价确定性检查。昂贵 Inspector 在以下情况运行：

- Candidate 提交；
- 异常信号；
- 高风险 Task；
- 抽样审计；
- 工兵 commit 前。

不得让每个 Token 触发一个监督模型调用。

### Preset 与模板审计

Oversight 新增检查：

- 当前 Agent 的 actual preset 与 MilitarySessionBinding 一致；
- 子代理 template revision 和 request/header 的 effective model/reasoning 一致；
- 达上下文阈值后存在 CompactionAttempt；
- compaction null/failure 没有被标记为 success；
- 普通会话没有 Military event、tool 或 freeze；
- Examiner、Chief 和提炼 Agent 没有越过只读/生成权限。

### 0.3.0：Policy revision、Workspace 和预算监督

督战新增对账：

- Agent 实际 provider/model/reasoning 是否符合绑定；
- Tool/Permission/API Profile revision 是否匹配；
- Workspace lease 与写路径；
- Candidate Patch 是否来自当前 base snapshot；
- 预算 reservation 是否存在；
- General 模型切换是否错误传播到 child；
- 来源撤回后是否仍使用已隔离战术。

冻结只作用于目标 Military Agent/Task，不作用于同 cwd 的普通 DSH Session。Inspector 看不到隐藏 reasoning，只对 durable request/tool/artifact/event 事实做判断。


---

<a id="part-11"></a>

## Part 11：参谋部电台

源文件：`docs/11-staff-radio.md`

### 1. 定位

电台是结构化、持久、版本化的战术通信基础设施。它解决兄弟 Agent 直连、消息丢失、重复求援、旧指导写回和无证据占用参谋资源的问题。

### 2. 请求必需内容

所有子 Agent 请求战术指导时必须额外汇报：

- Agent identity、角色、session/generation；
- Mission/Direction/Wave/Task/Task Version/Attempt；
- 所处 Environment Snapshot；
- 当前已分配、尝试和完成的私有战术及版本；
- Blocker 类型、陈述、可复现性和边界；
- 已尝试动作、观察和排除理由；
- Harness 自动附加的工具、Artifact 和 Verifier 证据；
- 一个明确 `requestedDecision`；
- 已使用/剩余预算；
- idempotency key、createdAt、expiresAt。

自由文本只能作为字段内容，不可替代信封。

### 3. Escalation Gate

请求进入参谋前先由外置 Harness 验收“求援资格”，而不是验收任务完成。

输出：

```text
ADMISSIBLE
MISSING_EVIDENCE
DUPLICATE_REQUEST
CHEAP_RETRY_AVAILABLE
STRATEGIC_ESCALATION
BUDGET_EXHAUSTED
POLICY_DENIED
```

可接受请求通常满足：

- Blocker 可定位或复现；
- 完成规定廉价检查；
- 有真实工具/Artifact；
- 没有重复问已回答问题；
- 需要一个具体战术决策；
- 当前技能不足或出现冲突。

### 4. Broker 语义

每封信具有：

- `requestId`；
- `idempotencyKey`；
- `taskVersion`；
- `leaseOwner/leaseUntil`；
- `attempt`；
- `visibilityTimeout`；
- `expiresAt`；
- `ack`；
- Dead Letter 状态。

数据库或队列 Provider 必须支持幂等和租约恢复。

### 5. 事件唤醒与 Heartbeat

正常流程：

```text
radio/requested event
→ Broker 通知/唤醒合格 Advisor
→ Advisor lease
```

Heartbeat 只用于：

- Advisor 存活；
- 过期 lease；
- 孤儿任务；
- 故障转移；
- 队列健康。

不让 Thinking Advisor 持续轮询并浪费模型调用。

### 6. Advisor 处理

- 读取结构化请求和最小证据；
- 召回 3～5 个候选战术；
- 检查版本、前置、排除、权限、冲突和依赖；
- 选择 1 个主战术 + 最多 2 个补充；
- 编译单一 Tactical Directive；
- 指明 expected observations、evidence、stop 和 fallback；
- 写入 Guidance，不直接投递给兄弟 Agent。

### 7. Broker 投递

投递前检查：

- 当前 Task Version 等于 expectedTaskVersion；
- Agent generation/lease 仍有效；
- Guidance 未过期；
- Skill 版本未隔离；
- 工具/API 权限仍满足；
- 请求未关闭或被其他 Candidate 解决。

否则标记 `GUIDANCE_STALE` 或 `GUIDANCE_EXPIRED`。

### 8. 回执和后续

Worker ack 后执行；后续 Candidate/Blocker 引用 guidanceId 和 skill refs。Effectiveness Agent 可计算：

- 请求到指导延迟；
- 指导后首轮/最终通过；
- 过期、重复和无效指导；
- 参谋与技能的增量贡献。

### 9. 安全

- Broker 根据调用者身份重建敏感字段，不信任 Worker自报权限；
- 企业数据通过 Artifact/引用和最小必要投影；
- Radio 事件不存原始 secret；
- Advisor 不能通过 Guidance 给 Worker 新权限；
- Dead Letter 仍遵守分类和保留策略；
- 防止一个 Worker 通过重复请求耗尽高成本参谋。

### 用户问题转交

Radio 新增 `DecisionQuestionSet` 消息类型。它不是直接弹窗命令，只能送达 General：

```text
Advisor/Chief → Radio Broker → General → ask_user_question
```

Broker 依据 contextVersion、dedupeKey 和 expiresAt 去重。旧 Task/Brainstorm revision 的问题不应显示给用户。

### 0.3.0：授权、预算和 Decision Relay

Radio Request 还需携带 Authority/Policy revision、remaining budget、base Workspace Snapshot 和 source tactic rights。Advisor 调用前预留预算；无新增 Evidence 的重复请求被去重或拒绝。

需要用户决定的 Guidance 不直接弹窗，而生成 Decision Broker Record。Task Version、Guidance expiry 或来源撤回使待决问题 `STALE/SUPERSEDED`。


---

<a id="part-12"></a>

## Part 12：私有战术系统

源文件：`docs/12-tactical-skills.md`

### 1. 定义

私有战术不是更长的 `SKILL.md`，而是一个版本化、可执行、可验证、可回滚的
Tactical Procedure。当前源码由 `ctx.militaryTactics` 管理真源，并通过官方
RC.2 dynamic `ctx.skills` provider 暴露受治理编译视图。

### 1.1 当前投放合同

- `DRAFT` 和 `SIMULATION` 永不进入生产 Task；
- `CANARY`/`TESTING` 只有在 Military 的 `allowCanaryDelivery` 开启时，才会被
  Host 的 Task 语义召回选中；
- 全局 DSH Skill 目录只列出 `STABLE`；
- list/get、Task 创建和每个模型 pre-step 都重新检查来源撤回、许可、scope、
  audience、derivative、expiry 和 exact lifecycle；
- Task Order 固定 `skillId@version`；版本在 Task 执行期间被降级、隔离、撤回
  或过期时，在下一次模型投放前 fail closed；
- Flash 不需要选择标签或理解完整 Registry。Host 从 Task objective、scope、
  workspace/依赖语义和 evidence 要求召回最多配置数量的 exact version，再注入
  一个有字节预算的适用性卡片；
- 卡片只含 scenario、precondition、紧凑步骤、stop/verifier 和 content hash。
  超过八步时卡片只要求一次
  `military_get_order({ "skillId": "<assigned-skill>" })`；Host 从 Task 中派生
  exact frozen version、重新检查实时投放资格并返回完整 procedure，不让 Flash
  猜版本、路径或新增工具。原始来源永远不进入模型上下文。

编译文件遵守渐进式披露：

```text
SKILL.md                    # 触发描述、适用性、紧凑工作流和安全边界
references/procedure.md     # 完整 Claim Evidence、权利、依赖、风险和验证计划
examples/minimal.md         # 最小调用形状
scripts/verify.mjs          # 可执行的离线完整性检查
```

该结构参考 Claude 官方的
[创建 Skill 指南](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)
与[编写最佳实践](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices)：
用精确 `name`/`description` 支持发现，把主文件保持短小，并把按需细节放入
一层 references/examples/scripts。DSH 仍使用自己的 RC.2 Skill Provider，
不依赖 Claude Skills API。

### 2. 战术内容

```yaml
skillId:
version:
lifecycle:
title:
description:
scenarios: []
preconditions: []
exclusions: []
compatibility:
  taskTypes: []
  models: []
  tools: []
  environments: []
  dataClassificationCeiling:
stateMachine:
playbook:
expectedObservations:
verifierContract:
stopConditions:
rollback:
knownFailureModes:
conflictsWith:
dependsOn:
provenance:
metrics:
```

### 3. 状态机与 Playbook

状态机说明当前战术阶段和允许转换；Playbook 中每一步包含：

- stepId；
- action；
- tool；
- 前置/when；
- evidenceRequired；
- retryLimit；
- expected output。

Worker 收到的是 Advisor 编译后的 Directive，不需要自行解释完整复杂状态机。

### 4. 生命周期

```text
DRAFT
→ SIMULATION
→ CANARY
→ TESTING
→ STABLE
→ DEPRECATED
```

任一活动版本可进入 `QUARANTINED`。版本不可原地修改；修复发布新 SemVer。
安全降级支持 `STABLE→TESTING→CANARY→SIMULATION→DRAFT`；人工隔离版本在来源
仍有效并提供重新验证证据时可回到 `DRAFT`。来源已撤回的版本不能恢复。

#### DRAFT

Museum/用户/工程师提出，尚不可自动分配。

#### SIMULATION

使用 fixture、历史重放或 sandbox 验证状态机、安全和停止条件。

#### CANARY

只对少量低风险真实 Task 分配，有明确样本、指标、停止和回滚。

#### TESTING

扩大 Task 类型或模型范围，持续观察负面影响。

#### STABLE

达到配置的证据阈值，才可成为默认候选。

### 5. 检索与合成

检索分层：

1. 硬过滤：生命周期、场景、前置、排除、环境、分类、工具/API 权限；
2. 召回：标签、语义、历史相似 Task、Failure Mode；
3. 排序：验收表现、上下文匹配、风险、成本、时效；
4. 召回 3～5 个候选；
5. Advisor 处理冲突和依赖；
6. 编译 1 个主战术 + 0～2 个补充为单一 Directive。

### 6. 效能证据级别

不要把“被分配”写成“有效”。记录：

```text
ASSIGNED
ACKNOWLEDGED
ATTEMPTED
COMPLETED
ACCEPTED
CONTRIBUTED
CAUSAL_SUPPORTED
```

- `ACCEPTED`：使用该战术的 Task 被接受；
- `CONTRIBUTED`：有前后对比或明确步骤证据支持增量贡献；
- `CAUSAL_SUPPORTED`：有可比对照/实验支持，仍应报告不确定性。

### 7. 版本和兼容

战术版本固定在 Task Order/Guidance。以下变化发布新版本：

- 前置/排除；
- 状态机；
- Playbook；
- Verifier；
- 权限/分类；
- Stop/Rollback；
- 语义改变。

仅补充非语义元数据可采用 patch 版本，但仍不可篡改已使用的 Artifact。

### 8. 安全和企业知识

- 战术可标注数据分类；
- 普通 Worker 无权浏览整个 Registry；
- Advisor 只检索授权集合；
- 战术不能包含原始凭据；
- API 调用使用 grant/credential reference；
- 对外模型不可接收受限战术内容；
- 战术本身也可能含 prompt injection，应经过安全审查和签名/来源检查。

### 9. DSH Skill 适配

- `ctx.militaryTactics` 是战术真源；
- `ctx.skills` 继续服务普通通用 Skill；
- Provider 只把通过实时权利检查的 STABLE 战术编译为精简 SkillDefinition；
- 完整状态机、指标和敏感 API grants 不直接暴露给 Worker；
- Scope 决定可见层。

### 10. 战术博物馆职责

Museum：

- 固化已使用版本；
- 聚合轨迹和效能；
- 发现可复用模式；
- 提出 DRAFT；
- 设计 Simulation/Canary；
- 提议隔离或弃用。

它没有 STABLE 发布权，也不能以单个成功案例自动晋级。

### 外部提炼与标签

私有战术可由用户显式选择的历史会话、直接经验或 Artifact 产生，但入口只生成 `TacticalExtractionCandidate`。Candidate 必须经过来源快照、Secret/PII/Injection 扫描、现有战术 Diff 和用户审批，才能形成 DRAFT。

战术引用稳定 `tagId`；标签重命名不修改 Skill 历史，暂停阻止自动投放，删除采用 tombstone。完整设计见[外部内容战术提炼与标签治理](docs/33-tactical-ingestion-and-tag-governance.md)。

### 0.3.0：来源供应链和撤回

每个 Tactical Skill version 还需引用 Source Snapshot、license/allowed audience、dependency range、reviewAfter、revocation status 和派生影响索引。`STABLE` 只代表在限定环境通过治理，不代表永久正确。

来源撤回、依赖版本越界或新证据证明错误时，版本进入 `QUARANTINED/REVIEW_REQUIRED`，禁止新 Guidance；历史使用保留并按风险触发重新验证。

`SUPPLEMENT` 只能指向同一 owner 的现有、未隔离私有 Skill。新版本继承并合并
基础版本的 workflow、标签、前置、停止、Verifier、provenance 和全部来源谱系，
不会用一段补充材料覆盖既有过程。任一继承来源撤回都会阻止新投放并隔离所有
受影响派生版本。


---

<a id="part-13"></a>

## Part 13：后勤保障与研究部

源文件：`docs/13-logistics-research.md`

### 1. 组织边界

该部门固定只有三个模型 Agent。调度、幂等、来源验证和写入由 Harness 服务负责，不算第四个 Agent。

1. 战术轨迹记忆总结 Agent；
2. 战术效能评估 Agent；
3. 战术博物馆 Agent。

### 2. 共同输入原则

三个 Agent 不直接相信 Worker/Advisor 自报。输入优先级：

1. Accepted/Rejected Mission Events；
2. Verification Receipts；
3. Artifact/Git/Tool Evidence；
4. 确定性 Tactical Report；
5. 模型生成说明，作为辅助判断。

### 3. 战术轨迹记忆总结

#### 触发

- Wave 完成；
- Direction 完成；
- General 请求；
- Mission 完成；
- 重大 Incident 后。

#### 输入

Harness 先生成确定性 Tactical Report：已接受 Task、Artifact、决策、Blocker、Skill 使用、指标和 Event ID。

#### 输出

```text
Mission State
Confirmed Facts
Accepted Progress
Decisions and Rationale
Open Blockers
Risk Changes
Reusable Tactical Lessons
Recommended Strategic Actions
Evidence Index
```

每个 claim 带 sourceEventIds、Artifact、confidence 和 validityScope。

#### 验证

Harness 检查：

- 是否覆盖所有关键 accepted events；
- 是否引用不存在/未接受事实；
- 是否把 Candidate 写成 accepted；
- 是否遗漏 critical risk；
- 是否混合 Task Version。

通过后才进入 General Session。

### 4. 战术效能评估

#### 强制触发

每次 General 成功触发 compaction 后，以 `compactionId` exactly-once 创建评估任务。评估在 compaction transaction 之外异步执行。

#### 先统计、后解释

Harness 先计算：

- Task assigned/attempted/accepted；
- first-pass/final acceptance；
- rework；
- false completion；
- guidance request/delivery；
- Skill 使用级别；
- model/reasoning/token/latency；
- verifier 和 Inspector 结果；
- 任务粒度。

Effectiveness Agent 再解释模式、局限和假设。

#### 归因等级

```text
none
correlated
incremental
causal-supported
```

单次“用了战术并成功”只能支持相关。强因果需要可比对照、随机化或足够严谨的准实验。

#### 输出用途

- General 了解系统效能；
- Staff 调整路由、任务粒度和模型；
- Museum 选择研究对象；
- 自动隔离高风险低效版本的候选信号，但不直接执行发布。

### 5. 战术博物馆

#### 归档

- 将 Tactical Memory、Effectiveness、Skill Version 和代表性 Artifact 建立不可变档案；
- 保留适用场景、环境和失败边界；
- 归档不等于默认可用。

#### 二次研究

Museum 可：

- 比较多个 Mission 的成功轨迹；
- 发现重复诊断/步骤；
- 补充 Failure Mode；
- 合并或拆分战术；
- 调整前置/排除；
- 设计新的 Verifier；
- 提出下一版本 DRAFT。

#### 推演和测试

```text
Archive evidence
→ Hypothesis
→ DRAFT tactic
→ Static/schema/security review
→ SIMULATION
→ CANARY
→ TESTING
→ approval → STABLE
```

当未来 Task 匹配时，只能按生命周期投放测试版，且 Worker/Advisor 明确知道其为 Canary，并有停止/回滚。

### 6. General Memory 投递

- 常规 Wave Memory 使用 quiet 投递；
- critical risk、预算耗尽、关键路径阻塞可 wakeup；
- General 接收摘要与证据索引，不接收所有子 Agent raw transcript；
- Memory 更新采用 boundary/ref，避免重复注入；
- 新 Memory 不删除 Ledger 事实。

### 7. 防止知识闭环退化

- 模型不能评估自己的隐藏推理质量；
- 同一个成功案例不能重复计入多个压缩窗口；
- 失败和 negative effects 必须进入 Museum；
- Skill 使用的未选择结果不能被写成成功经验；
- 指标不以自报完成率为依据；
- 版本隔离后停止新分配并回归检查已接受结果。

### 与军事评估委员会的职责分离

Effectiveness Agent 继续评估 Tactical Skill/Guidance 的贡献；军事评估委员会评估 Agent Template revision。两者共享确定性数据集服务，但不能互相替代：

- Skill 成功不等于 Agent 普遍优秀；
- Agent 高通过率不证明某 Skill 有因果贡献；
- Museum 可以读取委员会发现的重复 failure pattern，但只能提出 DRAFT/Canary；
- Committee 可以建议调整模型、Thinking、Task 粒度或 Context Policy，但不能直接修改 ACTIVE 模板。

### 0.3.0：数据集、来源与预算

Trajectory/Effectiveness/Museum 只读取已认证事件和拥有访问授权的 Artifact。研究工作属于可降级非关键队列，受独立预算和数据分类限制。

Effectiveness 记录 General route、Agent Template revision、Task 难度和 Verifier strength；Museum 提案必须保留 Tactical Source 派生链。任何模型摘要都不能替代 Evaluation Dataset Manifest 或确定性指标。


---

<a id="part-14"></a>

## Part 14：外置验收、证据与两阶段完成

源文件：`docs/14-verification-and-acceptance.md`

### 1. 两个不同的 Gate

#### Completion Gate

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

#### Escalation Gate

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

### 2. Acceptance Contract

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

### 3. Candidate 是提案，不是结果

```text
Worker proposes Candidate
→ Harness verifies
→ Harness commits Accepted Event
```

Candidate 包含 output、evidence、tool calls、acceptance mapping、skill usage、environment、changed paths、limitations 和 idempotency。

### 4. Evidence Graph

每个 claim 映射到一个或多个：

- durable tool call/result；
- content-addressed Artifact；
- Git commit/tree/diff；
- API receipt；
- Mission/Session Event；
- 明确用户授权。

模型自然语言不能单独作为 critical clause 的证据。

### 5. 验收管线

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

### 6. Verifier 类型

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

### 7. Judge Agent 规则

- 不与执行 Agent 共享隐藏 reasoning；
- 读取结构化 Candidate 和真实 Artifact；
- 输出 clause-level verdict 和证据；
- 无法判断时必须 `HUMAN_REVIEW_REQUIRED`；
- 不能覆盖确定性失败；
- 模型/Prompt/版本必须记录；
- 高风险场景考虑不同模型或多 Judge，但仍不能替代外部测试。

### 8. 完成联锁与 turn-stopping

`military_submit_candidate` / `submit_blocker` 是正常结束路径。若 Agent 试图无提交结束：

- `agent/turn-stopping` 检查 Task authoritative state；
- 拒绝完成或追加纪律提醒；
- 多次违规触发 Oversight Freeze；
- 不允许靠最终 Assistant Message 绕过工具。

### 9. 验收决定

#### ACCEPTED

所有 critical/required 条款满足，回归通过，版本有效，副作用合规。

#### REWORK

可局部修复，保持 Task Version，创建新 Attempt；Acceptance 不变。

#### BLOCKED

缺少外部决策、数据或战术；进入 Escalation Gate。

#### FROZEN

存在不可信、越权或严重一致性异常。

#### STRATEGIC

需要改变目标、架构、用户授权或 Direction。

#### HUMAN_REVIEW_REQUIRED

自动系统无法安全判断，必须呈现证据和未决条款。

### 10. Wave 级验收

单 Task 接受不代表 Wave 完成。Barrier 还检查：

- 集成行为；
- 跨 Task 接口；
- 回归；
- critical Oversight；
- Radio 状态；
- specs commit；
- 风险和用户约束；
- Tactical Report。

### 11. 验收质量自身评估

追踪：

- false accept；
- false reject；
- clause coverage；
- flaky verifier；
- Judge disagreement；
- 验收延迟与容量；
- 被后续回归推翻的 accepted result。

Verifier 版本也是复现 Task 结果的必需信息。

### 0.3.0：Acceptance 与 Integration 分离

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


---

<a id="part-15"></a>

## Part 15：事件溯源、状态与持久化

源文件：`docs/15-event-sourcing-and-state.md`

### 1. 为什么需要全局 Mission Ledger

DSH Session Log 适合单 Agent 的持久上下文，但一个 Mission 需要跨多个 Session 管理：

- Direction/Wave/Task DAG；
- Agent lease/generation；
- Candidate/Verification；
- Radio；
- Tactical Skill；
- Specs/Git；
- 全局预算、风险与并发。

因此建立独立 Mission Ledger，并把模型需要看到的事实镜像到相关 DSH Session。

### 2. 四类存储

| 存储 | 内容 | 是否真源 |
|---|---|---|
| Mission Ledger | 不可变领域事件、revision、关联 | 全局真源 |
| DSH Session Log | 单 Agent message/tool/military projection | 该 Session 模型上下文真源 |
| Artifact Store | 大日志、文件、Diff、截图、测试、API receipt | 内容真源 |
| Read Models/Documents | UI、Report、Memory、Specs | 派生投影；Specs 是工程契约但事实需有来源 |

### 3. Event Envelope

```yaml
schemaVersion:
eventId:
missionId:
seq:
aggregateRevision:
type:
timestamp:
actor:
causationId:
correlationId:
idempotencyKey:
payload:
```

Actor identity 由 Harness 注入，不能只信任模型参数。

### 4. 核心事件族

```text
mission/*
direction/*
wave/*
task/*
verification/*
radio/*
oversight/*
specs/*
git/*
model/*
memory/*
tactic/*
incident/*
```

DSH Session 中使用相应稳定 `military/*` Event Family 展示模型可见事实和 Web Conversation Node。

### 5. Revision 与 Task Version

- Aggregate Revision：任何聚合变更递增，用于 CAS；
- Task Version：Objective、scope、acceptance、environment、dependency 或权限改变时递增；
- 普通 observation/metric 可增加 revision，但不使 Candidate stale；
- Guidance 固定 expectedTaskVersion；
- Agent generation 防止旧 Session 写回。

### 6. 幂等

- 每个 Command 有 idempotency key；
- 相同 key + 相同规范 payload 返回原 receipt；
- 相同 key + 不同 payload 报冲突；
- Candidate 唯一键 `(taskId, taskVersion, attemptId)`；
- Compaction Evaluation 唯一键 `compactionId`；
- Git specs commit 用 change-set hash 对账；
- Radio request 去重使用 blocker fingerprint 与 idempotency。

### 7. Session 镜像

凡将进入模型请求的 Mission 事实必须：

1. 已在 Ledger/Artifact 持久；
2. 以稳定 Event 或 message projection 写入目标 Session；
3. 可在冷启动时重建；
4. 携带来源 ID；
5. 遵守 Agent 数据分类和最小上下文。

禁止只通过运行时隐藏内存把关键状态塞进 Prompt。

### 8. Artifact Store

Artifact 使用内容寻址：

- sha256；
- media type；
- byte length；
- classification；
- producer；
- task/version；
- retention；
- redaction lineage。

Event 只保存引用。Secret、超大日志和二进制不内嵌 Ledger。

### 9. 投影

常用 Read Model：

- Mission Overview；
- Direction/Wave Board；
- Task Roster；
- Agent Status；
- Radio Queue；
- Evidence Graph；
- Specs Status；
- Tactical Registry；
- Metrics Dashboard。

投影可删除重建。投影写失败不能宣称领域命令失败，Ledger 写失败则必须 fail closed。

### 10. 恢复与重放

- 启动时重放 Event；
- 识别过期 lease、orphan compaction、未知副作用；
- 对比 projection checksum；
- Agent resume 前重新验证 taskVersion/identity；
- 外部动作通过 receipt 对账；
- 无法判断时 `UNKNOWN_EFFECT`，不自动成功。

### 11. 保留与删除

数据按分类和用户策略保留。删除必须覆盖：Ledger（或合规 tombstone）、Session、Artifact、索引、缓存、导出和备份生命周期。Tactical Memory/Skill 若依赖被删除 Mission，应重新评估来源完整性。

### 0.2.0 新增事实域

新增持久事实：

- DSH Session Log：只记录 DSH 已知会话/模型事件以及模型可见 `user/message`；不写 required `military/*` 私有事件；
- Mission Ledger：记录 `military/session-bound`、Brainstorm、Template instantiated、Task、Radio、Freeze、Specs、Memory 和 Context pressure/compaction attempt；
- Administrative Ledger：Tag revision、Ingestion Job/Candidate review、Agent Template revision、Evaluation Run/Report；机器 envelope 见 [`administrative-event.schema.json`](schemas/administrative-event.schema.json)；
- Artifact Store：source snapshot、extraction diff、evaluation dataset、individual/overall report。

跨会话管理事件不应硬塞进需要 `missionId` 的 Mission Ledger envelope。

### 0.3.0：生成事件、物理事务与 upcast

Mission/Admin Event Envelope 升级为 `2.0.0` 判别联合，由 Event Catalog 生成。Event payload 不允许自由扩展字段；新增字段通过新 catalog revision 和 upcaster 管理。

物理实现使用 append + aggregate revision CAS。需要外部副作用的操作记录 intent/outbox，再写 receipt 或 compensation。Projection 保存 checkpoint，但可从 Event 重建；Artifact 使用内容寻址文件与 metadata commit。参考 DDL 位于 [`reference/sql/`](reference/sql/README.md)。


---

<a id="part-16"></a>

## Part 16：与 DeepSeek Harness 的集成方案

源文件：`docs/16-dsh-integration.md`

### 1. 基线

设计基于 `deepseek-ai/deepseek-harness` `master` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，对应 `dsh@0.1.1-rc.2`。实现时应固定支持矩阵；DSH 变化通过薄 Adapter 吸收。

DSH 使用 Cordis 插件树，模型适配器、工具注册表、Session Log、Agent Loop、Skill、Compaction 与 Web 扩展均有组合 seam。`dsh-military` 作为后置 Bundle，避免修改内部 Agent Loop 源码。

### 2. Bundle

```json
{
  "name": "@your-org/dsh-military",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "exports": {
    ".": "./lib/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml"
  }
}
```

Bundle patch 挂载领域服务、默认 Provider、Runtime、DSH Adapter、模型工具、Host 设置和 Web Client。用户后置 patch 可替换 Provider。

### 3. Agent 创建

使用 `ctx.agents.create()` / `resume()` programmatic path，因为角色需要：

- 独立 persona；
- Agent Scope；
- 精确工具集；
- Sandbox/Workspace；
- 模型与 maxTokens；
- scoped `agent/request` reasoning policy；
- identity/session events；
- freeze/admission setup。

配置式通用 Agent 不应承载所有角色差异。

### 4. 推理强度强制

1. Role/Task Policy 决定最低和首选 effort；
2. Agent Scope 的 `agent/request` listener 设置/覆盖；
3. Worker/Engineer/General/Staff 的 `off` 在请求前 fail closed；
4. 读取持久 `request/header` 确认 effective value；
5. Oversight 对角色与实际值对账；
6. Adapter 级全局 `thinking: disabled` 不适用。

### 5. Subagent

可复用 DSH continuable subagent，但由 `MilitaryRuntime` 统一创建和持有 Handle：

- 标准 follow-up 权限围绕直接父级；
- 兄弟 Agent 不形成自由通信网；
- Radio 使用自有 Broker；
- child report 可用于直接父级；
- Worker 禁止派生下级；
- Mission Ledger 掌握 identity、taskVersion 和 lease。

### 6. Session Events

扩展 `SessionEventMap`：

```text
military/identity
military/task-assigned
military/guidance-received
military/candidate-submitted
military/inspection
military/frozen
military/result-accepted
military/specs-commit
military/tactical-memory
```

这些事件既支持模型上下文重建，也支持 Web Conversation Nodes。

### 7. Tool Pipeline

利用：

```text
tools/pre-execute
→ monotonic guards
→ execute
→ post-execute
→ result
```

实现：身份、冻结、taskVersion、路径、企业 API、Git、超时、脱敏、Evidence 和指标。`military_submit_candidate` 调用 `ToolRunContext.concludeTurn()`。

### 8. Agent Hooks

- `agent/pre-step`：冻结、lease、版本和消息准入；
- `agent/request`：模型路由、reasoning、预算和审计；
- `agent/request-error`：Provider 错误，不混同 Task 失败；
- `agent/turn-stopping`：无 Candidate/Blocker 的兜底；
- `agent/status`：Roster/UI；
- `agent/created/disposed`：Handle 和 lease 清理；
- `agent.cancel(...,{keepInbox:true})`：Freeze。

### 9. Compaction

订阅 General Session 的：

```text
compaction/start
compaction/summary
compaction/end
```

成功 end 后，以 compaction identity 幂等创建效能评估。评估不在 compaction transaction 内运行。

### 10. Skill

- DSH `ctx.skills` 保留通用技能发现；
- `ctx.militaryTactics` 是私有战术真源；
- Adapter 把允许的 ACTIVE/STABLE 视图注册到 Skill Registry；
- Advisor 读取完整战术；Worker 只读取编译 Directive。

### 11. Settings 与 Web

Host 注册 namespace：

```text
military-core
military-agent-templates
military-staff
military-tags
military-tactics
military-tactical-ingestion
military-brainstorm
military-chief-of-staff
military-oversight
military-specs
military-memory
military-evaluation
```

Client 按 namespace 注册 settings card；运行态注册 Mission/Wave/Radio/Freeze/Candidate/Specs/Memory Conversation Node。专用 Dashboard 可在后续构建。

### 12. 持久化 Provider

- Ledger：SQLite/PostgreSQL；
- Radio：SQLite/外部 Queue；
- Artifact：本地内容寻址/对象存储；
- Tactics：Git/Database hybrid；
- Metrics：OTel/时序系统；
- Session：DSH persistence。

### 13. Adapter 包

```text
adapters-dsh-agent
adapters-dsh-tools
adapters-dsh-session
adapters-dsh-skill
adapters-dsh-compaction
adapters-dsh-settings
adapters-dsh-client
```

DSH 升级仅修改这些包，并运行契约重放和 hook 时序测试。

### 0.2.0：Agent Preset 适配

Bundle 交付一个固定 system preset 资产根，包含 `military/preset.yml` 与 `agent.cordis.yml`。会话创建在 `setup(agentCtx)` 调用 `ctx.agentPresets.mount(agentCtx, selectedId)`；Military Runtime 创建的子代理同步调用 `composeFrom(childCtx, parentCtx)`。

#### Roster 安装不是动态注册

`AgentPresets.Config.roots` 是服务启动配置。生产包应提供 profile 安装适配器：读取已有 `agent-presets` row 的完整配置、解析 preset 资产包绝对路径、追加 `trust: system` root，再完整写回 `default + roots + includeUserRoot`。DSH patch 会替换一个 row 的整个 `config`，所以不完整覆盖会删除部署已有 preset。

安装适配器不得：

- 创建第二个 AgentPresets 服务；
- 自动把默认 preset 改成 `military`；
- 覆盖用户自定义 preset root；
- 让普通 Session 通过 Host Plane 获得 Military tool/prompt；
- 在运行中的非空 Session 上重组 preset。

参考材料：

- [`reference/preset/README.md`](reference/preset/README.md)
- [`examples/preset/agent-presets-profile-overlay.example.yml`](examples/preset/agent-presets-profile-overlay.example.yml)

Agent Plane 的 Military prompt、工具和命令只存在于 preset standing scope。Host Plane 服务可以常驻，但必须不注册全局模型表面，并对非 Military Session 立即返回。

DSH 当前命令标识只接受小写 ASCII，故中文显示“头脑风暴”映射到 `/brainstorm`。DSH 的 delegated subagent 不能调用 `ask_user_question`，因此 General 是唯一弹窗调用者。

参考组合见 [`reference/preset/agent-presets/military/agent.cordis.yml`](reference/preset/agent-presets/military/agent.cordis.yml)。

### 14. 0.3.0：精确 RC.2 支持边界

完整实现只针对：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

启动执行 [`CompatibilityProbe`](docs/45-compatibility-probe-and-feature-matrix.md)，验证 AgentPresets、programmatic agent setup、`composeFrom`、`agent/request`、`request/header`、Compaction Event、User Questions、Settings、Conversation Nodes、Session Persistence 和 Tool Pipeline。其他 commit 即使 API 相似，也只可标记为未验证，不声明完整兼容。

### 15. Preset generation Adapter

RC.2 原生持久事实主要提供 preset id，不能单独恢复历史 generation。Military Adapter 额外持久：

```text
MilitarySessionBinding
PresetGenerationManifest
CapabilityFingerprint
GenerationArchiveRef
```

恢复顺序：

```text
resolve actual preset id
→ read MilitarySessionBinding
→ verify exact RC.2 baseline
→ resolve content-addressed generation manifest/archive
→ current generation: verify and continue
→ archived-only root after restart: quarantine/migration (no silent rebind)
→ compare capability fingerprint
→ publish resume receipt
```

不得只调用 `mount('military')` 恢复旧 Session。缺失资产进入 quarantine，详见[升级与恢复](docs/38-preset-generation-upgrade-and-resume.md)。

### 16. General 路由 Adapter

preset 内的 `military-general-model-default` 只在 General 请求未显式选择 provider/model 时填充。用户通过 RC.2 会话模型表面选择后，Adapter 接受该显式值，再执行 Military ModelCapability、reasoning、驻留和预算校验。

Agent 身份必须证明 `rootRole=general`；子 Agent 请求不能读取该会话覆盖，而是使用 Agent Template 创建时冻结的 route。

### 17. 生成契约与事件

Mission/Admin Event 不再手工在多个文件维护。`contracts/event-catalog.json` 生成：

- 判别联合 JSON Schema；
- TypeScript Payload Map；
- Golden JSONL；
- 事件目录文档。

共享对象通过 `contracts/parity-map.json` 校验 JSON Schema 与 TypeScript required/optional 字段。实现包应消费生成类型或同一 IDL，不复制事件字符串。

### 18. Workspace 与集成

Worker 写任务在独立 Git worktree 或等价 copy-on-write Workspace 中运行。DSH `cwd` 指向该隔离根。Worker 只提交 `CandidatePatch`；Harness 验收后由 Integration Runtime 在受控 local `main` 上应用、执行全局回归并写 `IntegrationReceipt`。

普通 DSH Session 的文件变更只作为 external drift 被发现，Military 无权取消或冻结该 Session。

### 19. 持久化和事务

参考 [`reference/sql/`](reference/sql/README.md) 定义 Mission/Admin Event、Radio、Artifact、Workspace、Integration、Decision、Generation、Evaluation 和 Outbox 表。跨 Event + 外部副作用使用：

```text
prepare intent
→ durable event/outbox
→ execute side effect
→ receipt/compensation
```

Git commit、Artifact rename、Profile write 和 API 调用不能与数据库假装成一个原子事务，必须使用 receipt 和恢复扫描。

### 20. Decision Broker 与预算

子代理问题通过持久 Decision Broker 交给根 General。Broker 使用 revision、expiry、taskVersion 和 dedupe key；多标签页的第一个有效回答胜出。

模型请求、工具、Radio、Evaluation 和研究工作在执行前从 [`ResourceBudgetPolicy`](schemas/resource-budget-policy.schema.json) 预留资源。预算耗尽产生 durable disposition，不静默降级。


---

<a id="part-17"></a>

## Part 17：WebUI 设计

源文件：`docs/17-webui.md`

### 1. 目标

WebUI 让用户以“统帅”视角配置组织、观察 Mission、处理授权和审计证据，而不是把所有 Agent 对话平铺成聊天噪声。

### 1.1 0.9.0-alpha.28 源码实现边界

当前 Integration Alpha 已实现：

- 与“知识与技能”相邻的独立 `Military 设置中心` 侧栏入口和原生 Modal；
- 可搜索的 12 角色目录、一次只挂载一个编辑器、未保存草稿保护、事务保存、
  revision 冲突处理、历史回滚和安全导入导出；
- DSH live 模型目录下拉、能力状态、经济/标准/深度预算、费用与历史 observed
  指标；
- Host 六层有效提示词预览、确定性 Flash readiness、离线工具模拟、显式只读
  Canary 和用户确认式简体中文辅助检查；
- Execution、Staff、Tag、Tactic、Oversight、Specs、Memory、Evaluation 和
  Presentation 可视化面板；
- Session 诊断时间线、受治理恢复操作、Host workspace 目录和 Git/lease/
  integration 状态；
- 独立 Session Runtime Center，展示
  Request→Mission→Direction→Wave→Task→Attempt→Activation→Dispatch，
  以及 Candidate/Verification/Integration、Radio、Decision、预算和 receipt；
- 共享 timeout/abort/dedupe/backoff/revision query layer 与跨标签页失效通知；
- 固定九场景评测工作台、真实 Provider Session 样本趋势以及 N≥50/Wilson/
  零安全失败发行验收；
- 独立“知识与技能”入口和七视图 Knowledge Center；
- 可信 Typert RPC 上的来源导入、分块 Job、候选 Diff/编辑/审批、Skill
  生命周期、效果记录、撤回与影响、sanitized pipeline 透明度及无 Task 模拟
  召回；
- RC.2 shared settings mirror；
- dynamic client manifest 与 lazy module-loader artifact。

#### DSH 原生组件与主题合同

Military 不维护第二套 Web 主题。设置中心与知识中心直接复用 RC.2 的
`Button`、`Pill`、`StateDot`、`Modal` 和图标 primitive；DSH 尚未提供公开
primitive 的 `select`、`textarea` 与 checkbox 则按同一 32px field、8px
圆角、label 和 focus contract 实现薄适配层。

所有颜色只引用 Host 的 `--dsw-*` design aliases。明暗主题、hover、active、
disabled、错误/成功状态、遮罩、阴影与滚动层级均由 DSH Web 决定，插件不定义
独立色板。Settings 内容遵循内置 Models Section 的 14/22 正文、12/18
caption、12px card 和 28/36px capsule 节奏；Knowledge Center 使用内置
Modal 的 24px elevated surface，并沿用 Settings 的 224px/188px rail、40px
nav cell 与侧栏 footer trigger。

Military 设置与知识入口作为同一个 `sidebar.footer.action` occupant 内的两个
纵向按钮渲染，避免 RC.2 list slot 的横向 flex 布局在收起态把按钮挤出 56px
侧栏。两个按钮逐项复制内置 `SettingsRoot` 的几何合同：展开态为完整 42px 行
点击域，收起态为居中的 36px 圆形点击域；margin、padding、radius、hover、
label overflow 与 16/18px primitive 图标尺寸均一致。

键盘 focus-visible、Escape/遮罩关闭、Modal 焦点捕获与返回、七选项卡和角色
目录 roving focus、窄屏 rail 转横向导航、简体中文 IME、forced-colors、
`prefers-contrast` 与 `prefers-reduced-motion` 均已进入源码合同和发布门禁。

以下仍是后续产品面，不应在当前源码或报告中标记为已完成：

- 把 Military 私有状态直接嵌入 DSH conversation log 的 Conversation Nodes
  （RC.2 无第三方 required event 注册 seam）；
- 自定义 Advisor 创建；
- 分布式 Web push；当前使用 revisioned query/backoff/invalidation。

RC.2 没有为外部插件提供 required Session Event 类型注册面。Military 权威状态位于自己的 Mission/Administrative Ledger；未来运行视图必须读取插件自有 Remote/Projection，不能通过写入未知 `military/*` DSH Session Event 实现。

### 2. 已实现的 Military 设置中心

侧栏 footer 中的“Military 设置中心”和“知识与技能”纵向排列在 DSH 设置按钮
上方，并与该原生按钮具有完全相同的展开/收起点击域。点击后打开 Headless
`Modal`，不再把 Military 塞入 DSH 通用 Settings 的
`settings.section`。对话框左侧有七个固定一级选项卡：

```text
Military-部门模型
Military-执行与成本
Military-Specs 工作区
Military-安全与恢复
Military-战术与标签
Military-绩效评估
Military-显示与进阶
```

#### 部门模型

- 可搜索、按部门/状态筛选的 General 与全部 11 个部门角色目录，一次只展示
  当前角色编辑器；
- General 与全部 11 个部门模板的 provider/model 下拉框；
- 选项来自 DSH `llm.models` 目录与 Military 治理路线的交集；
- reasoning、max output、context budget、并发和 compaction；
- template status；隐式 fallback 固定关闭，重量升级通过直接选择 Pro 完成；
- 每次保存生成新 revision，不热改运行中 Binding；
- 经济/标准/深度/自定义预算、token/中文字符/费用与历史运行指标；
- 实际 Prompt Assembly 的六层只读预览、语义 Diff、确定性 Flash readiness、
  离线工具模拟和需要明确确认的在线只读 Canary；
- General 和 11 个部门角色均直接显示插件自带的简体中文角色提示词；
- 每个提示词可视化编辑、保存和逐角色恢复，并提供“一键恢复全部角色自带
  提示词”；
- 提示词辅助检查跳过代码、路径和标识符，只在用户逐项或批量确认后应用，
  Host 重新计算 hash 和不可变审阅回执；
- 用户可编辑部分只负责角色指导；Host 在其后追加的工具白名单、工作区、
  证据、终态和权限边界不可编辑，也不能被提示词授予或削弱。

General 不是 Department `AgentTemplateProfile`，但与部门模板一起出现在同一个
可视化页面。其默认 route 来自固定 `military` preset，Military Settings 修改
后续默认请求；当前 Session 的显式模型选择仍按 RC.2 precedence 处理。
General 自定义提示词保存在 `military-model-routing.generalPromptOverride`；
部门自定义提示词保存在新的 immutable `AgentTemplateProfile` revision 的
`rolePromptOverride`。字段为空或缺失时始终解析为当前模板 ID 对应的插件自带
提示词，因此旧 Profile 不需要手工迁移。

#### 执行与成本

- Radio attempt/lease；
- Chief of Staff fallback；
- Wave trajectory 与 General compaction 后 effectiveness；
- 部门模板、Flash 默认数量和并发预算总览。

#### Specs 工作区

- RC.2 没有外部目录 picker，因此浏览器只选择 Host 从 Session binding 派生的
  不透明 `workspaceId`，不提交任意绝对路径；
- 展示 canonical root/hash、Git HEAD/branch/tree、dirty/untracked、
  allowed/read-only/forbidden/unscoped 树、lease/worktree、Candidate、
  integration、receipt 和角色路径示例；
- Session Workspace、Specs scope、local-only Git、事务回滚和 remote-write
  denial 不能被设置关闭。

#### 安全与恢复

- 按真实 Session event/Host receipt 展示模型、Schema、补全、Grant、路径、
  工具、终态和父级唤醒诊断时间线，敏感字段先在 Host 脱敏；
- 展示 SQLite/WAL、备份、Preset/Bundle、Mission/Task/child、worktree、
  Grant、outbox 和 receipt 健康状态；
- 数据库验证、备份、reconcile、stale outbox 重投、过期资源释放和父级唤醒
  都必须先预览、再输入精确确认短语，结果为跨重启幂等 receipt；
- 不提供原始 SQLite 编辑、手工完成或无证据删除。

#### 战术与标签

- 私有战术候选召回上下限；
- 私有 Skill 提炼 provider/model 下拉框、输出预算、确定性 fallback、默认
  可见范围和保留天数；
- 标签新增、暂停、恢复和 tombstone 删除；
- UI 负责版本与时间，不要求用户编辑 `tagsJson`。

### 2.1 已实现的知识与技能操作中心

Military 侧栏的“知识与技能”按钮打开独立对话框，包含：

- **来源资料**：直接文本、Session event range、Artifact、媒体类型、工具结果
  开关、classification、license、外部模型同意、依赖版本和可视化目标版本；
- **提炼任务**：SQLite durable 状态、Chunk 进度、resume、Injection WARN 用户
  acknowledgement；
- **待审候选**：Candidate/Diff hash、脱敏来源 Diff、Claim Evidence、风险、
  验证计划、编辑、批准 DRAFT、退回和拒绝；
- **私有技能库**：完整 immutable snapshot、exact version、文件、来源、效果、
  Tokens、Verifier、成本、sanitized snapshot/chunk、审批和继承谱系；
- **模拟召回**：不创建 Task、不调用模型，使用真实 recall 的同一权利、标签、
  生命周期、排序、token budget 和投放 renderer，显示选中/排除原因与 exact
  applicability card；
- **版本与晋升**：逐级 promotion、安全 rollback、quarantine、恢复和 deprecate；
- **撤回与影响**：原因选择、受影响版本、历史 Usage 和重新生成 impact report。

浏览器每两秒读取一次 redacted projection，长提炼可刷新或重启后恢复。写操作走
`militaryPrivateSkills/execute`，读取走 `militaryPrivateSkills/snapshot`；原始
正文不经过共享 Settings。传输失败只使用同一 operation ID 重试一次，领域失败
不自动重试。UI busy latch 防止同一标签页并发提交，领域层仍以 hash、receipt 和
SQLite 唯一键处理跨标签页/重启幂等。

#### 绩效评估

`Military-绩效评估` 是一个一级选项卡，内部按渐进披露提供七个子视图：

1. **决策总览**：Report 状态、唯一 Mission/Attempt、区间、数据缺口和阻断；
2. **角色/模型比较**：exact configuration、Flash/Pro 非劣、难度平衡与路线；
3. **九场景热力图**：固定 `military-flash-core-v1` 与真实 Provider observation；
4. **工具调用漏斗**：选择、Schema、Host、权限、路径、运行、验证、集成、父唤醒；
5. **成本/延迟 Pareto**：先执行质量/安全门，再比较 Accepted Outcome 资源；
6. **数据与 Evidence**：canonical dataset hash、纳入/排除 Attempt、configuration、
   missingness 和 Evidence；
7. **历史/申诉/改进实验**：immutable Report lineage、challenge、resolution 和
   superseding revision。

请求表单使用 Host Workspace/Mission 目录、置信水平、非劣界限和执行超时，不要求
用户手填专业配置 JSON。Failed Job 显示结构化原因；retryable Job 可从冻结分片重试。
Provider 样本按 dataset + Session + scenario 去重。至少 10 个 exact-route
独立 Session 且 Wilson 区间足够窄时可以显示趋势；发行 acceptance 另要求每个
exact configuration × scenario 至少 50 个 Session、首次工具/E2E Wilson 门和
意外确定性错误/越权写入/假完成/重复终态全为 0。确定性 Host 结果与真实
Provider 观察始终分栏。

#### 显示与进阶

- 军事/中性术语；
- 高级审计信息和紧凑布局；
- 模板、工具与权限治理数量只读摘要；
- 200% zoom、大字体、长 model ID、forced-colors、高对比度、简体中文 IME 和
  reduced-motion 不破坏 RC.2 原生布局。

### 3. 参谋创建向导

1. 身份；
2. 职责/非职责；
3. 领域/场景；
4. 模型/Thinking；
5. 工具；
6. Tactical Skill patterns；
7. Enterprise API Grants；
8. 数据分类/凭据 refs；
9. 预算；
10. 权限 Diff；
11. Canary；
12. 激活。

Secret 字段只选择 credential reference，不回显值。

### 4. Runtime Center 与 Conversation Log 边界

当前 Runtime Center 已通过 Military 自有 Remote/Projection 与稳定业务 ID
构建，不以未知 DSH Session Event 为数据通道。其稳定节点包括：

- Mission Intent；
- Staff Council；
- Direction Ratified；
- Wave Open/Barrier；
- Task Assigned；
- Candidate/Verification；
- Radio Request/Guidance；
- Oversight Freeze/Release；
- Specs Commit；
- Tactical Memory；
- Promotion Order；
- Incident。

每个节点使用 durable Event family + stable id，可历史重建，并携带
sourceRevision、generation、generatedAt、staleAfter 与 health。把这些节点直接
注入 DSH conversation log 仍是未实现边界；那需要未来上游提供安全的第三方事件
扩展 seam。

### 5. Mission Dashboard

#### Overview

目标、当前 Direction/Wave、进度、风险、预算、模型路由和用户待决事项。

#### Plan

Direction/Wave/Task DAG、依赖、锁、状态、Agent、版本和 Acceptance。

#### Forces

Agent Roster、role、model/reasoning、Task、lease、状态、工具活动和冻结。

#### Evidence

Candidate→Clause→Verifier→Artifact/Event 的图。

#### Radio

队列、领域、等待、lease、重复、过期、指导和结果。

#### Specs

文档状态、追踪缺口、本地 main commit 和 Wave Barrier。

#### Knowledge

Skill 版本、使用、效果、Canary、Museum 提案。

### 6. 用户操作

- 修改/停止 Mission；
- 批准风险和外部动作；
- 选择/停用参谋；
- 查看和手动处理 Freeze；
- 请求重新验证；
- 发起 Promotion Order；
- 导出审计；
- 删除/保留数据。

所有写命令携带 expected revision；冲突时显示实际新状态，不静默覆盖。

### 7. 安全 UX

- 角色名旁显示真实权限；
- 明确“描述不会授予权限”；
- 高风险动作显示 source commit、remote、branch 和 expiry；
- Model fallback/数据出境显著提示；
- Freeze 展示确定性证据与模型意见的区别；
- 不显示隐藏 reasoning；
- 敏感 Artifact 需授权、脱敏和访问审计。

### 8. 实施顺序

1. Settings Cards；
2. 插件自有只读 Mission Projection/Remote；
3. Mission read-only dashboard 与可选 Conversation renderer；
4. revision-fenced commands；
5. Tactical/metrics advanced panels。

若 DSH 尚无稳定顶层页面 seam，优先使用官方 Settings 与 Conversation Node 扩展，不依赖私有 UI 内部。

### 0.2.0 WebUI 增量

#### 新建会话 Preset

复用 DSH agent preset chip，增加固定 `military`；会话开始后只显示只读标签，不提供假热切换。

#### Military 设置分区

- 独立一级导航：与 Agent 预设同级；
- General + Department Templates：目录驱动的模型下拉、Thinking、Context
  Budget、Compaction 和并发；
- Staff/Execution：参谋长兜底、Radio 与 Memory 触发器；
- Tactical Tags：新增、暂停、恢复和 tombstone 删除；
- Safety/Specs：可变恢复策略与不可降级治理边界；
- Performance：模板/部门/工作区/Mission 评估范围、durable Job、七视图决策中心、
  immutable 报告历史与申诉。

#### 普通会话

普通 preset 只看到 DSH 默认 UI。Military Conversation Nodes、命令和控制按钮只有 actual preset=`military` 时渲染。


### 9. 0.3.0：冲突、恢复与完整交互

WebUI 以 durable projection 为真源，覆盖：

- preset generation `MATCHED/ARCHIVE_REBOUND/QUARANTINED`；
- General 模型来源与切换 receipt；
- 设置 expected revision 冲突和字段 Diff；
- 多个标签页同时回答 Decision；
- 长任务刷新、断线、取消和恢复；
- Workspace drift、Integration queue 和 conflict report；
- 战术来源权利、提炼 Diff、撤回影响图；
- Evaluation Dataset Manifest、数据不足、申诉与重评；
- 预算 reservation、队列和耗尽处置；
- 军事/中性术语切换和可访问性。

详细交互契约见[WebUI 交互、冲突、恢复与可访问性](docs/51-webui-interaction-and-conflict-ux.md)。普通 Session 页面不得呈现 Military Mission、Freeze、Radio 或 Evaluation 运行控件。


---

<a id="part-18"></a>

## Part 18：安全、权限与企业数据

源文件：`docs/18-security-and-permissions.md`

### 1. 权限维度

权限不能用一个 `role=advisor` 概括，至少分为：

- 模型 Provider 与数据驻留；
- Tool；
- 文件 read/write/forbidden paths；
- Workspace/Sandbox；
- Enterprise API grant；
- Credential reference；
- Tactical Skill scope；
- Data classification ceiling；
- Agent creation；
- Accept/Freeze；
- Specs/Git；
- 用户授权动作。

### 2. 最小权限

- 每个 Task/Advisor 只获得完成职责所需权限；
- 描述、Prompt、Skill 不能授予权限；
- 权限不可由 Agent 转授给兄弟 Agent；
- Broker 在每次投递/调用时重新授权；
- Tool Guard 是服务端强制，不只是 Tool filter。

### 3. Enterprise API Gateway

参谋访问内部 API 必须经 Gateway：

```text
Advisor Identity
→ API Grant
→ method/resource/classification/rate check
→ credential resolution
→ request
→ response size/type validation
→ redaction
→ untrusted-data framing
→ Artifact/Event
→ model-visible projection
```

原始 secret 不进入模型、Session、Ledger 或 UI。

### 4. Prompt Injection

仓库、网页、API 和 Artifact 中的文本均视为数据。控制：

- 标记来源和信任等级；
- 系统命令与数据分段；
- 不执行数据中的工具/权限指令；
- 高权限动作必须是领域 Command；
- 对代码注释/网页中的“忽略规则”不赋予权威；
- 关键事实交叉验证；
- 输出和日志扫描。

### 5. Confused Deputy

Worker 不可通过 Radio 让 Advisor 执行自己无权执行的副作用。Advisor 可读取授权企业数据并给出指导，但不能把 credential、原始敏感数据或新权限传给 Worker。

### 6. Git 安全

- 工兵 local-only main；
- 任意 remote write 默认 deny；
- Promotion Order 限定 source commit、目标、action、expiry；
- 网络 Git 工具仅 General Scope 可见且仍需授权；
- 禁止 history rewrite；
- Git receipt 进入 Ledger；
- commit 前 secret scan 和 allowlisted path 校验。

### 7. Agent/Tool 隔离

- Worker 无 subagent creation；
- Inspector read-only；
- Research 只读 accepted projection；
- Advisor 不直接写项目；
- Engineer 不使用任意 Git shell；
- Frozen Agent 的 `pre-step` 和 write guards fail closed；
- 外部工具支持 cancellation、timeout 和副作用对账。

### 8. 数据分类

```text
public < internal < confidential < restricted
```

Agent/Model/API/Artifact 各有 classification ceiling。路由到外部模型前检查数据驻留和允许分类；禁止静默 fallback 导致敏感数据出境。

### 9. Tactical Supply Chain

- 战术有来源、作者、版本和不可变内容；
- 进入 Registry 前 schema、安全和注入检查；
- Canary 最小权限；
- 异常版本可快速 QUARANTINED；
- 找出所有使用任务并回归；
- 不从不可信 Mission 自动复制为 STABLE。

### 10. 审计

记录：

- 谁/哪个 Agent 发起；
- 有效权限和模型；
- 请求、事件和 Artifact ID；
- 用户授权；
- API/Git/Tool receipt；
- Freeze/Release；
- Tactical version；
- 数据分类和脱敏政策。

### 11. 紧急控制

- 停止新 lease；
- 冻结所有写 Agent；
- 取消模型请求；
- 撤销 API/credential grants；
- 隔离战术；
- 禁止 remote action；
- flush durable state；
- 向用户呈现已确认影响和未知副作用。

### 0.2.0 安全扩展

- `military` preset 是模型能力边界；Host admin RPC 另行授权；
- 标签和模板写入使用 revision fencing；
- 历史会话提炼需要明确来源范围、用途、分类和 redaction；
- Evaluation 跨会话读取需要独立权限并只纳入 actual Military Session；
- Chief/Examiner/Extraction Agent 无 Mission 接受、Freeze、Git 或任意 Session 浏览权；
- 普通会话外部修改同一工作区时，Military 只能检测 drift，不能取消或冻结它；
- 报告和战术不得泄漏原始 Secret、用户身份或 Restricted Tool Result。

### 0.3.0：Authority Context 与版本化 Policy

所有管理面和跨会话操作必须解析 [`AuthorityContext`](schemas/authority-context.schema.json)，至少包含 principal、tenant、role/scope、Workspace membership、Session ownership、数据分类上限和授权 receipt。`sessionId`、`cwd` 或 Agent 自报身份不能授予权限。

以下一级对象必须版本化并可撤销：

- [`ToolProfile`](schemas/tool-profile.schema.json)；
- [`PermissionProfile`](schemas/permission-profile.schema.json)；
- [`EnterpriseApiGrant`](schemas/enterprise-api-grant.schema.json)；
- [`DataResidencyPolicy`](schemas/data-residency-policy.schema.json)；
- [`RedactionPolicy`](schemas/redaction-policy.schema.json)；
- [`VerifierProfile`](schemas/verifier-profile.schema.json)；
- [`ModelCapabilityProfile`](schemas/model-capability-profile.schema.json)。

有效权限是 Agent Template、Task Order、Authority Context、Sandbox、数据分类和当前 revoke generation 的交集，deny 优先。Profile revision 改变不热改运行中的 Attempt；新 Attempt 使用新 revision，紧急撤权可立即冻结相关工具。

跨会话战术提炼和绩效评估必须证明源 Session 的 tenant、所有权、授权范围和数据分类。来源删除或授权撤回触发派生影响分析，而不是只从 UI 隐藏。

Workspace 路径授权必须处理绝对路径、符号链接、大小写、Git worktree 和临时文件。普通 Session 与 Military Session 同 cwd 不代表互相获得会话控制权。

### 0.9.0-alpha.28 Web 控制面安全

- Client 只提交角色草稿、用户选择的 lint 位置、不透明 workspace ID、已有
  Session ID 和受限 operation intent；
- Remote 每次从 DSH connection/Host authority 解析 principal 与 tenant；本地
  单用户 Profile 使用明确 local principal boundary，不使用硬编码 `web-user`
  冒充企业身份；
- actor、tenant、authority、revision、hash、时间、absolute path、receipt 和
  capability 状态均由 Host 解析或生成；
- 在线 Canary 固定为显式确认的只读工具面，不获得 Workspace 写权限；
- Workspace root 可以作为已验证只读事实显示，但没有可提交路径字段；
- Session 诊断在 Host 脱敏 credential、绝对路径和超长参数；
- Knowledge projection 不包含 Raw Vault reference 或未清洗原文；
- recall simulation 不创建 Task、不调用模型、不授予工具，只保存输入 hash；
- benchmark assessment 只读既有 Session/receipt，不自动发起付费 Provider 请求
  或晋升模型；
- benchmark evidence export 只包含脱敏评估字段；真实 Flash acceptance 对每个
  exact configuration/scenario 执行 N≥50、Wilson 和零安全失败门；
- Evaluation Client 只能提交结构化筛选、报告/Job id、申诉文本和已有 Evidence id，
  不能提交权威 actor、dataset hash、configuration、指标、decision 或 receipt；
- Dataset Builder 只读取 actual preset=`military` 且通过 Host
  tenant/ownership/classification 检查的 materialized Session；
- `militaryEvaluationCenter` 返回前验证 Report/Dataset Artifact digest；Web
  Client 不获得 SQLite handle、任意 Session 扫描、绝对路径或原始对话正文；
- `COMMITTEE_MODEL` 是显式 opt-in，只接收脱敏聚合指标，无工具、temperature 0、
  限长且严格 JSON；失败回退确定性叙述，永远不能修改指标或晋升状态；
- Appeal exclusions 必须属于目标 immutable Dataset；重算生成 superseding
  Report，不能原地改写旧 Artifact 或跨报告注入 Attempt；
- RC.2 本地 Profile 的当前实现是单用户 Host/确认边界，不声称具备企业多租户
  RBAC、独立 Examiner 身份隔离或双人审批；
- 恢复操作必须预览、精确确认、幂等并写 receipt，UI 不提供原始 SQLite/Git
  控制。

#### Artifact Reference 授权

Content Blob 与 Artifact Reference 是两个对象。Blob hash 只用于完整性和去重；
Reference 另绑定 tenant、workflow/Mission/Task、classification、owner、
audience/grant、scope、expiry、retention 和 lineage。知道 hash 不等于读取授权。
相同内容被不同分类引用时按最高分类传播，低分类 Reference 不能降级内容。

restricted/raw Artifact 支持加密、密钥轮换、legal hold、retention cleanup、
deletion receipt 和 orphan GC。每次模型 Dispatch 记录实际 provider/model、
classification、residency、redaction policy 与 policy revision；不得在通用路径
硬编码 `internal`。

读取 Blob 时必须同时存在 metadata，并在解密后重新验证 SHA-256 与
`byteLength`；密文认证失败、内容漂移和 metadata 漂移统一 fail closed。
GC 以 metadata 重新构造 Reference Index，修复“metadata 已提交但索引未提交”
的崩溃窗口；无 metadata 的 Blob 作为不可达孤儿删除。若仍有 active/retention/
legal-hold authority 的 metadata 丢失 Blob，GC 必须报
`PERSISTENCE_FAILED`，不得把数据丢失伪装成正常清理。


---

<a id="part-19"></a>

## Part 19：可观测性、容量与效能指标

源文件：`docs/19-observability-and-metrics.md`

### 1. 目标

可观测性回答：

- Mission 目前处于何处；
- 哪个 Direction/Wave/Task 阻塞；
- Agent 是否真实调用工具；
- 验收为什么通过/失败；
- Advisor/Skill 是否有效；
- 模型/Thinking/任务粒度如何影响成功；
- 系统是否拥塞或越权。

### 2. Trace 层级

```text
Mission Trace
  Direction Span
    Wave Span
      Task Span
        Attempt Span
          Activation Span
            Dispatch Span
              Model Step Span
              Tool Call Span
          Verification Span
          Radio/Decision Span
          Integration/Specs Span
```

关联 ID：request/obligation/mission/direction/wave/task/version/attempt/activation/
dispatch/agent/session/guidance/decision/candidate/verification/integration/operation/
outbox/event/artifact。

### 3. 核心指标

#### 结果

- Task first-pass/final acceptance；
- false completion；
- regression；
- human intervention；
- Mission completion；
- critical invariant violations。

#### 流量与延迟

- Ready/Leased/Executing/Verify queues；
- Radio queue age；
- transactional outbox lag/dead-letter；
- Command Saga pending/expired effect lease age；
- Agent heartbeat/lease expiry 与 recovery drift；
- Advisor/Verifier utilization；
- Wave cycle time；
- model/tool/verifier latency；
- compaction→effectiveness latency。

#### 成本

- Tokens、requests、tool/API calls；
- cost per accepted Task/Direction/Mission；
- rework waste；
- Advisor guidance cost；
- context bytes 与 cache behavior（若 Provider 可报告）。

#### 质量

- evidence coverage；
- unverified tool claim；
- stale candidate/guidance；
- Oversight findings；
- specs traceability/drift；
- Verifier false accept/reject；
- Skill contribution level。

### 4. Task 粒度指标

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

### 5. Tactical Guidance Lift

```text
P(accepted | comparable blocker + guidance)
- P(accepted | comparable blocker without guidance)
```

按 Task Type、模型、reasoning、复杂度和环境分层。无对照时只报告相关性和置信度。

### 6. 容量模型

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

### 7. 告警

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

### 8. 日志与隐私

- 结构化日志引用 Artifact，不重复大内容；
- Secret/PII 脱敏；
- 不记录隐藏 reasoning；
- 按分类设置 TTL；
- 用户可导出审计；
- metrics 聚合避免重新识别；
- OTel exporter 默认失败不能阻断核心 Ledger，但不得泄漏数据。
- 错误标签只记录稳定 category/fingerprint，不记录原始路径、Provider payload、
  Prompt、Secret 或高基数用户内容。

### Agent Template 与委员会指标

所有子代理 telemetry 增加：

```text
templateId, templateRevision, department, role,
provider, model, reasoningEffort,
contextBudget, compactionTrigger, compactionOutcome,
actualPreset, rootSessionId, missionId
```

委员会指标目录见 [`quality/PERFORMANCE-METRICS-CATALOG.md`](quality/PERFORMANCE-METRICS-CATALOG.md)。仪表盘必须把参与量、准确性、完成度、能力、纪律、效率和数据质量分开，禁止以单一无解释综合分替代全部维度。

### 0.3.0：路由、预算、数据集与集成指标

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
Command Saga stalled effect age
Agent activation heartbeat freshness
Capacity admission rejection rate
Projection lag
Evaluation reproducibility rate
```

生产 `OperationsHealthProjection` 将 Saga、outbox、Radio、lease/recovery、
Workspace 和 Provider topology 统一映射为 health item、SLO drift 与
`military.*` 指标。分布式部署的 readiness 只有在外部 Ledger、对象存储、队列和
KMS descriptor 与探针全部匹配时为 READY；本地实现不得通过改标签伪装。


---

<a id="part-20"></a>

## Part 20：测试、评估与发布门禁

源文件：`docs/20-testing-and-evaluation.md`

### 1. 测试金字塔

#### Schema/Contract

所有 Command/Event/Artifact metadata/Settings/Tool payload：正例、缺字段、未知字段、版本拒绝、边界值。

#### Unit

状态机、CAS、幂等、DAG、锁、资格过滤、Skill 生命周期、权限、Task 粒度规则。

#### Property-based

随机 DAG 无环；并发 Candidate 不会双重接受；事件重放确定性；权限永不因组合放宽；资源锁无非法交叉。

#### Integration

DSH Agent create/setup、Scope、reasoning、request/header、pre-step、turn-stopping、cancel、Tool Pipeline、Session Event、Compaction、Settings、Conversation Node。

#### End-to-end

IDEATION、ACTIVE、LEGACY、Rework、Radio、Freeze、Specs commit、Compaction/Memory、Promotion Order。

#### Chaos

Ledger/Radio/Artifact/Verifier/Git/Agent/Provider 在关键窗口崩溃。

### 2. 发布阻断不变量

- 无证据 Candidate 被接受；
- stale Candidate/Guidance 被使用；
- Worker 写 specs；
- Engineer push/非 main/历史重写；
- Frozen Agent 写工具成功；
- reasoning off；
- Memory 引用未接受事实；
- Museum 直接发布 STABLE；
- Secret 出现在 Session/Ledger/导出；
- Event replay 产生不同投影。

任何一项发生即阻断发布。

### 3. 架构对照实验

至少比较：

```text
A: 单 General Agent
B: 普通 Swarm，无外置验收
C: dsh-military，无私有战术
D: dsh-military + 私有战术
E: 不同任务粒度与 reasoning 策略
```

控制相同用户目标、仓库快照、工具权限、最终 Verifier 和模型配额。

### 4. 主要评测指标

- 最终验收通过率；
- first-pass；
- false accept/false completion；
- 人工介入；
- 端到端时间；
- 总 Token/调用/工具成本；
- 回归率；
- specs 追踪覆盖；
- 未授权动作；
- guidance lift；
- memory fact coverage。

不以 Agent 数量、消息数或自报完成率作为成功。

### 5. 模型基准

每个 Task Type 测：

- Task Order 遵循；
- Tool use；
- 未读事实纪律；
- Candidate Evidence Mapping；
- Blocker 质量；
- Tactical Directive 修正；
- 长上下文约束保持；
- cancellation/freeze；
- low/high/max 差异。

模型名不能直接映射能力；使用本地验收数据。

### 6. 私有战术评测

- Simulation fixtures；
- historical replay；
- Canary；
- comparable control；
- negative effects；
- stop/rollback；
- 不同模型/环境兼容；
- 隔离后的影响追踪。

### 7. Verifier 校准

构造已知正确、已知错误和歧义 fixture，测 false accept/false reject。Judge Agent 应有盲测和模型/Prompt 版本记录。

### 8. UI 测试

- Durable Node 历史/实时一致；
- 断线重连；
- 乱序和分页；
- expected revision 冲突；
- Secret 不回显；
- 权限 Diff；
- Freeze/Promotion 高风险确认。

### 9. 文档工程质量

CI 验证：

- JSON Schema；
- YAML examples；
- TypeScript reference；
- Markdown links；
- Mermaid；
- specs template；
- ADR 编号；
- manifest/checksum；
- DSH baseline references。

### 10. MVP 验收

首个垂直切片必须证明：

- 可重放；
- 可冻结；
- 可拒绝；
- 可恢复；
- 可证明；
- 可形成本地 main specs commit；
- 不把模型自报当成事实。

### 0.2.0 必测套件

新增测试族：

- preset roster、broken preset、blank-session selection 和 lock；
- Military/Standard sibling session 的 Prompt/Tool/Event 零串扰；
- child `composeFrom()` exact generation；
- 同 cwd 外部 drift 不触发普通会话控制；
- Tag rename/pause/delete 和历史引用；
- Ingestion source hash、secret scan、Diff review 和 DRAFT-only；
- Template revision、reasoning fail closed、context threshold/hysteresis；
- `/brainstorm`、root-owned ask-user、取消和恢复；
- Chief sufficiency gate、过期 Advice 和用户问题转交；
- Evaluation date filter、revision split、difficulty adjustment、small sample、report totals。

### 0.3.0：一致性与真实 RC.2 Fixture

静态文档门禁新增：

```text
Event Catalog generation freshness
Mission/Admin discriminated payload coverage
JSON Schema ↔ TypeScript parity
Preset generation hash/archive freshness
RC.2 constant and General policy parity
State invariant scan
SQL migration shape
Conformance Trace event validation
```

真实实现必须在固定 RC.2 checkout 运行 E2E：

- preset picker、blank selection 和 nonblank lock；
- Standard/Military Session 工具可见性隔离；
- General preset 默认模型与用户模型切换；
- child template route 不跟随；
- current generation 重启恢复；archived-only 根 Session 重启后 quarantine/migration；
- root-only ask-user relay；
- Freeze 与进行中工具竞态；
- 独立 worktree、Patch、Integration 和 local main；
- SQL/outbox 崩溃恢复；
- 设置、多标签页、断线和可访问性。

关键状态使用属性测试和 [`reference/tla/MilitaryCore.tla`](reference/tla/MilitaryCore.tla) 建模。测试报告必须区分“文档静态通过”和“真实 DSH Runtime 通过”。详见[一致性与模型检查](docs/49-conformance-and-model-checking.md)。


---

<a id="part-21"></a>

## Part 21：包拓扑与依赖边界

源文件：`docs/21-package-topology.md`

### 1. 设计目标

`dsh-military` 对外可以作为一个 Bundle 安装，但内部不应实现成一个巨型插件。应遵循 DSH 的 Service Definition / Provider / Consumer seam 模式，把稳定领域契约、运行时控制、具体存储、模型消费者和 Web Client 分开。

核心原则：

- 领域层不导入 DSH 内部实现类型；
- 适配层只做协议映射，不持有业务真源；
- 任何一个 Provider 都可被替换；
- WebUI 只消费服务和事件，不直接改数据库；
- Worker、参谋、工兵和研究 Agent 使用同一领域协议，但拥有不同 Scope、工具、权限和推理策略；
- Bundle 仅负责组合，不实现领域逻辑。

### 2. 推荐仓库结构

```text
packages/
  military/
    contracts/                    # 领域类型、错误码、事件、Service Definition
    ledger/                       # ctx.militaryLedger 定义
    ledger-sqlite/                # 本地 Provider
    ledger-postgres/              # 企业 Provider（后续）
    runtime/                      # ctx.military；Mission/Direction/Wave/Task 生命周期
    planning/                     # 方向—波次—任务编译与 DAG 校验
    staff/                        # ctx.militaryStaff；参谋名册、会商和兵力生成
    staff-agent/                  # 参谋模型 Consumer
    radio/                        # ctx.militaryRadio 定义与 Broker
    radio-sqlite/                 # 本地队列 Provider
    tactics/                      # ctx.militaryTactics 定义
    tactics-git/                  # Git 版本化战术 Provider
    tactics-skill-adapter/        # ACTIVE/STABLE 战术到 ctx.skills 的编译视图
    verification/                 # ctx.militaryVerification；验收器注册表
    oversight/                    # ctx.militaryOversight；确定性联锁和冻结
    oversight-agent/              # 只读语义督战 Agent
    artifacts/                    # ctx.militaryArtifacts 定义
    artifacts-local/              # 本地内容寻址存储
    specs/                        # ctx.militarySpecs；specs 生命周期
    git/                          # ctx.militaryGit 定义
    git-local-main/               # 受限本地 main Git Provider
    memory/                       # ctx.militaryMemory；三类研究任务编排
    trajectory-agent/             # 战术轨迹记忆总结
    effectiveness-agent/          # 战术效能评估
    museum-agent/                 # 战术博物馆
    metrics/                      # ctx.militaryMetrics 定义
    metrics-otel/                 # OTel Provider
    tools-worker/                 # Worker 的领域工具 Consumer
    tools-staff/                  # 参谋工具 Consumer
    tools-engineer/               # 工兵工具 Consumer
    tools-general/                # 将军工具 Consumer
    adapters-dsh-agent/           # ctx.agents / hooks 薄适配
    adapters-dsh-session/         # SessionEvent 镜像和重放
    adapters-dsh-tools/           # tools pipeline 适配
    adapters-dsh-skill/           # ctx.skills 适配
    adapters-dsh-compaction/      # compaction 事件适配
    web-host/                     # Settings/API Host 半部
    web-client/                   # Settings cards、Conversation Nodes、运行态面板
    preset-military/              # 固定 system preset 资产包
    preset-installer/             # 解析资产路径并生成完整 roster profile overlay
    tags/                         # ctx.militaryTags 与标签生命周期
    ingestion/                    # ctx.militaryIngestion 与来源快照/审阅
    agent-templates/              # 子代理模板 revision 与 effective policy
    context-policy/               # per-agent context budget/compaction trigger
    command-brainstorm/           # agent-scoped /brainstorm
    chief-of-staff-agent/         # 参谋长模型 Consumer
    evaluation/                   # 跨会话 dataset/job/report
    evaluation-examiner-agent/    # 单模板评估
    evaluation-chair-agent/       # 总体绩效合成
  bundle/
    military/                     # @your-org/dsh-military；只做 cordis.patch.yml 组合
```

MVP 可以合并少量实现包，但 `contracts`、`runtime`、`verification`、`oversight`、`specs/git` 与 `web-client` 仍应保持边界。

### 3. 服务清单

| `ctx` 键 | 类型 | 职责 |
|---|---|---|
| `ctx.military` | Runtime | 启动/恢复 Mission，调度 Direction/Wave/Task，持有 Agent Handle |
| `ctx.militaryLedger` | Store | 追加不可变事件、CAS 状态迁移、读取投影 |
| `ctx.militaryPlanning` | Engine | Mission Intent → Direction/Wave/Task；DAG、粒度和冲突检查 |
| `ctx.militaryStaff` | Runtime | 参谋注册、资格过滤、会商、主责参谋选择、兵力生成 |
| `ctx.militaryRadio` | Runtime | 战术请求队列、租约、去重、投递、死信 |
| `ctx.militaryTactics` | Registry | 私有战术版本、生命周期、检索、编译、回滚 |
| `ctx.militaryVerification` | Registry/Engine | 验收器注册、执行、证据覆盖、最终判定 |
| `ctx.militaryOversight` | Controller | 完成联锁、冻结/释放、工具纪律、异常政策 |
| `ctx.militaryArtifacts` | Store | 内容寻址证据、Diff、测试日志和文档产物 |
| `ctx.militarySpecs` | Engine | specs 基线、维护命令、追踪矩阵和一致性检查 |
| `ctx.militaryGit` | Executor | 受限本地 main 初始化、提交和证明 |
| `ctx.militaryMemory` | Runtime | 轨迹、效能、博物馆任务及向将军汇报 |
| `ctx.militaryMetrics` | Service | 指标、追踪、成本、效能实验 |
| `ctx.militaryWorkspace` | Runtime | 工作区快照、锁、隔离 worktree 或 sandbox |
| `ctx.militarySessionGate` | Policy/Service | actual preset 准入、MilitarySessionBinding、父子 generation 对账 |
| `ctx.militaryAgentTemplates` | Registry | 非 General 子代理模板、revision、模型与 Context Policy |
| `ctx.militaryTags` | Registry | 战术标签、alias、暂停、重命名和 tombstone |
| `ctx.militaryIngestion` | Runtime | 来源授权、快照、提炼 Job、Candidate 审阅和 Draft 提交 |
| `ctx.militaryDecisionBroker` | Runtime | 子代理问题集去重、投递给 General、回答回执 |
| `ctx.militaryBrainstorm` | Runtime | `/brainstorm` Order、阶段、暂停恢复与 specs handoff |
| `ctx.militaryChiefOfStaff` | Executor | 战术不足时生成 GENERATED_REFERENCE Advice |
| `ctx.militaryEvaluation` | Runtime | 跨会话 Dataset、Examiner 分片、Chair 与双部分报告 |
| `ctx.militaryAdministrativeLedger` | Store | 标签、模板、提炼和绩效等跨会话管理事实 |

### 4. 依赖方向

```text
contracts
  ↑
ledger / artifacts / metrics / tactics / verification / git
  ↑
planning / staff / radio / specs / oversight / memory
  ↑
runtime
  ↑
tools-* / *-agent / adapters-dsh-*
  ↑
web-host / web-client / bundle
```

禁止反向依赖：

- `contracts` 不依赖任何 Provider；
- `runtime` 不导入 SQLite、Git CLI、Web Client；
- Web Client 不直接访问存储；
- 验收器不能调用“接受任务”之外的任务变更 API；
- Agent 消费者不能获得 Ledger 的任意写权限；
- Bundle 不包含业务状态机。

### 5. 模型面对的领域工具

所有角色都有：

```text
military_get_context
military_read_artifact
```

`military_get_context` 是每个 Military turn 的首个工具：它返回权威
root Session、Mission、Brainstorm Order 与分配 Task。模型不得猜测这些 ID。

#### Worker

```text
military_get_order
military_get_tactical_directive
military_record_observation
military_submit_candidate
military_submit_blocker
military_radio_request
military_submit_decision_questions
```

Worker 不应拥有：

```text
military_accept_result
military_change_acceptance
military_create_agent
military_freeze_agent
military_specs_write
military_git_commit
military_publish_tactic
```

#### 工兵

```text
military_specs_read
military_specs_apply_order
```

`military_specs_apply_order` 在 Host 内原子完成写入、验证、本地提交与 receipt；
Engineer 不再看到独立 validate/commit 工具。

#### 参谋

```text
military_staff_read_mission
military_staff_retrieve_tactics
military_staff_issue_guidance
military_staff_chief_advice
military_submit_decision_questions
```

#### 将军

```text
military_mission_start
military_task_create
military_task_get
military_spawn_department_agent
military_radio_poll
military_radio_issue
military_decision_present
military_decision_answer
military_tactical_ingest
military_tactical_review
military_evaluation_start
military_evaluation_get
military_status
```

`military_task_create` 只向模型公开浅层语义草稿；Host 生成全部 identity、
version fence、复杂度、证据合同和环境快照。工具注册表保存稳定并集，但 RC.2
agent-scoped visibility 在首次 prompt 前按 immutable ToolProfile 裁剪；运行时
角色与 Capability Grant guard 仍是权威边界。

### 6. Service Definition 与 Provider 分离示例

```ts
// contracts / service definition
export abstract class MilitaryLedger {
  abstract append(event: MissionEvent, expectedRevision?: number): Promise<AppendReceipt>
  abstract readMission(missionId: MissionId, options?: ReadOptions): Promise<MissionSnapshot>
  abstract subscribe(missionId: MissionId, listener: MissionEventListener): () => void
}

// provider
export class SqliteMilitaryLedger extends MilitaryLedger {
  // SQLite 事务、唯一键、CAS 和 durable subscription
}

// consumer
export class MilitaryRuntime {
  constructor(private readonly ledger: MilitaryLedger) {}
}
```

### 7. Bundle 包

```text
@your-org/dsh-military
  package.json
  cordis.patch.yml
  lib/index.js
  README.md
```

`cordis.patch.yml` 按以下顺序组合：

1. 领域 Service Definitions；
2. 本地默认 Providers；
3. Runtime 和 Policies；
4. DSH adapters；
5. 模型工具与角色 Agent；
6. Host 配置；
7. Web Client 模块。

用户的 profile 或 home patch 位于 Bundle 之后，可替换：

- SQLite → PostgreSQL；
- 本地 Artifact → S3；
- 本地 Radio → NATS/Kafka；
- 默认模型与 reasoning policy；
- Verifier；
- 企业 API Gateway；
- 参谋名单。

### 8. 版本策略

- Bundle 与领域包使用统一 SemVer；
- Mission Event、Task Order、Tactical Skill 各有独立 `schemaVersion`；
- 数据库 migration 版本与 NPM 版本分开；
- DSH adapter 包显式记录支持的 DSH commit/版本区间；
- 破坏性 DSH 变化只要求修改 adapters 和契约重放测试；
- 私有战术版本不得与软件包版本混用。

### 0.2.0 包拓扑增量

推荐新增包：

```text
preset-military/                 # 固定 preset 资产包
preset-installer/                # 保留现有 roots 的完整 profile overlay 生成器
adapters-dsh-preset/             # actual preset、mount/composeFrom 薄适配
tags/ + tags-sqlite/             # ctx.militaryTags
ingestion/ + ingestion-agent/    # ctx.militaryIngestion
agent-templates/                 # ctx.militaryAgentTemplates
context-policy/                  # per-agent budget/compaction policy
command-brainstorm/              # agent-scoped /brainstorm
agent-chief-of-staff/            # 参谋长模型 Consumer
evaluation/                      # Job、dataset、rubric、report
agent-evaluation-examiner/
agent-evaluation-chair/
web-client-performance/
```

以上示意中的空格应在实际包名中移除；文档故意把能力拆开，避免 Bundle 巨型化。

Bundle patch 挂载 Host Plane Provider、Settings 和 preset root；`military/agent.cordis.yml` 只挂模型面对的 Agent Plane Consumer。

### 0.3.0：新增实现包建议

为避免巨型插件，增加下列独立 seam/provider/consumer：

```text
dsh-military-contracts-generated
dsh-military-preset-generations
dsh-military-compatibility-rc2
dsh-military-authorization
dsh-military-policy-registry
dsh-military-general-routing
dsh-military-workspace
dsh-military-integration-git
dsh-military-ledger-sqlite
dsh-military-outbox
dsh-military-decision-broker
dsh-military-budget
dsh-military-knowledge-supply-chain
dsh-military-evaluation-dataset
dsh-military-bundle-lifecycle
dsh-military-client
```

`dsh-military-bundle` 只组合这些包。RC.2 特定调用放在 `adapters-dsh-rc2-*`，领域服务不得导入 DSH Agent Loop 私有实现。Preset 资产和 generation archive 可作为独立只读包交付。

Host-only Registry 与 Agent-plane tool/prompt 分离；需要按 Agent 地址读取 isolate service 的路径使用 RC.2 支持的 preset/service addressing adapter，而不是把服务泄漏到 root realm。

### 0.3.0 最终服务增量

实现收敛后还应提供以下独立 seam，而不是塞入 `ctx.military`：

| `ctx` 键 | 职责 |
|---|---|
| `ctx.militaryPresetGenerations` | Generation Manifest、archive、Resume Receipt 与 Migration |
| `ctx.militaryCompatibility` | RC.2 Feature Probe 与启动 disposition |
| `ctx.militaryAuthorization` | Authority Context、授权、撤权和 deny-first 判断 |
| `ctx.militaryPolicies` | Tool/Permission/API/Residency/Redaction/Verifier/Model/Budget versioned registry |
| `ctx.militaryGeneralRouting` | preset 默认、会话模型选择和 `ModelSelectionReceipt` |
| `ctx.militaryAgentBindings` | 非 General Agent 的不可变 `AgentExecutionBinding` |
| `ctx.militaryIntegration` | Candidate Patch 队列、冲突、回归与 local `main` Receipt |
| `ctx.militaryResourceBudgets` | 多级 reservation、lease 回收和 usage settlement |
| `ctx.militaryEvaluationDataset` | 可复现 Dataset Manifest |
| `ctx.militaryEvaluationAppeals` | 报告申诉、复评和 superseding revision |
| `ctx.militaryKnowledgeSupplyChain` | 来源、派生图、撤回和影响评估 |
| `ctx.militaryBundleLifecycle` | install/upgrade/rollback/disable/uninstall Saga |

这些接口的参考签名位于 [`reference/types/services.ts`](reference/types/services.ts)。Provider 可合并部署，但 Service Definition 不能因 MVP 共用数据库而消失。


---

<a id="part-22"></a>

## Part 22：实施路线图

源文件：`docs/22-implementation-roadmap.md`

### 1. 原则

`0.3.0` 不再按“先堆角色、后补基础设施”的顺序实现。路线以**可恢复权威闭环**为主线；每个阶段必须有真实 RC.2 Fixture、机器契约和退出条件。

完整支持基线固定为：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

### 2. Phase 0：契约、生成与 RC.2 Scaffold

实现：

- 从 `contracts/event-catalog.json` 生成事件类型、Schema 和 Fixture；
- 领域 ID、错误码、Authority Context 和 Profile 类型；
- preset asset package、generation hash 和 archive；
- RC.2 Compatibility Probe；
- 真实 DSH fixture app；
- SQLite migrations 和测试数据库；
- CI 中的 Schema/TS parity 与 Golden Trace。

退出条件：

- 所有静态门禁通过；
- RC.2 干净组合能发现 `military`；
- Standard Session 看不到 Military 工具；
- current generation 可在重启后恢复；archived-only 根 Session 会在模型请求前隔离并生成迁移路径。

### 3. Phase 1：General 与模型路由

实现：

- Military Session Binding；
- General persona 和领域入口；
- preset General model default；
- 会话模型选择覆盖；
- ModelCapability/Reasoning/Residency/预算准入；
- ModelSelectionReceipt；
- Preset Resume Receipt 与不可变 General route 恢复；
- root-only Decision Broker 与 `ask_user_question` Relay。

退出条件：

- 没有用户覆盖时使用 preset 默认；
- 切换只影响 General 后续请求；
- child route 不跟随；
- 不合规模型拒绝且旧路由保留；
- request/header 可重建 effective route。

### 4. Phase 2：单 Task 的隔离执行闭环

实现：

```text
Task Order
→ Workspace Snapshot/Lease
→ AgentExecutionBinding + Resource Reservation
→ one Thinking Worker
→ Candidate Patch + Evidence
→ deterministic Verifier
→ ACCEPTED/REWORK
→ Integration Order
→ global regression
→ local main commit
→ Integration Receipt
```

退出条件：

- 未验收文件不进入主工作树；
- FROZEN Worker 无法写入；
- stale Task Version/Candidate 被拒绝；
- Git commit 成功但 Ledger 失败可恢复；
- 普通 Session 外部修改只产生 drift。

### 5. Phase 3：Direction、Wave 与参谋部

实现：

- Direction/Wave/Task DAG；
- Advisor Profile、Template revision 和资格过滤；
- 独立研判、Lead/Consulting Advisor 合成；
- Workforce Plan 与并发准入；
- Wave Barrier、Change Order 和任务重规划。

退出条件：

- DAG 无环且依赖可解释；
- 任务满足最小可独立验收；
- 权限、预算和 Workspace 冲突能裁剪兵力建议；
- 模型不能自行接受或改变验收合同。

### 6. Phase 4：工兵、specs 与 Git 纪律

实现：

- 项目阶段侦察；
- IDEATION/SPECS_ONLY baseline；
- `/brainstorm`；
- specs 模板和追踪矩阵；
- 工兵专用路径/工具；
- local `main` init、Integration 和 commit；
- General-only Promotion Order。

退出条件：

- 空项目在实现前有 specs baseline；
- 每个 Wave 关闭前 specs 和 commit receipt 存在；
- 工兵无法 push、force、切远端分支；
- 用户问题和授权可恢复。

### 7. Phase 5：督战与完整 Verification

实现：

- Completion Interlock；
- 只读 Inspector；
- 确定性 Freeze/Release；
- Evidence Graph；
- Verifier Registry/Profile；
- 事故包与恢复策略。

退出条件：

- 谎报工具或范围外写入可冻结；
- 冻结与进行中工具竞态安全；
- Inspector 模型意见不能改变权威状态；
- 误冻结可审计、释放有合同。

### 8. Phase 6：Radio、参谋长与私有战术

实现：

- Radio Broker、lease、dedupe、DLQ；
- Escalation Gate；
- Tactical Registry 和 3–5 候选检索；
- 单一 Directive 编译；
- Tactical Sufficiency Gate；
- Chief of Staff fallback；
- DecisionQuestionSet Relay。

退出条件：

- 无 Evidence 的求援不消耗 Advisor；
- stale guidance 不投递；
- Advisor 不能直接控制兄弟 Worker；
- Chief 建议明确假设并有预算。

### 9. Phase 7：知识供应链与研究部

实现：

- 历史 Session/直接经验/Artifact ingestion；
- 来源权利、Secret/PII/Injection、矛盾和时效检查；
- DRAFT/Canary/Stable 生命周期；
- 撤回影响图；
- Tactical Report、Trajectory、Effectiveness、Museum；
- General compaction 后 exactly-once 评估。

退出条件：

- 来源可追溯且可撤回；
- 未验收内容不进入确认记忆；
- Museum 不能单独发布 Stable；
- 战术效果不把相关性误写为因果。

### 10. Phase 8：军事评估委员会

实现：

- Evaluation Request 和 Dataset Manifest；
- 跨会话权限和去标识化；
- 确定性指标；
- 双 Examiner、Chair、难度校正和缺失机制；
- individual + overall 报告；
- 结构化申诉、独立复核和 superseding report revision。

退出条件：

- 报告可由 dataset hash 复现；
- 样本不足不排名；
- 模型不能覆盖确定性指标；
- 普通 Session 不进入数据集。

### 11. Phase 9：WebUI 与运营

实现：

- 全部 Settings Cards；
- Military Remote/Projection 驱动的 Conversation Nodes 和 Mission Dashboard（Beta 目标；不得依赖私有 DSH Session Event）；
- model source/selection UI；
- generation quarantine 和迁移；
- Workspace/Integration、Freeze、Radio、Budget、Ingestion、Evaluation；
- revision conflict、多标签页、断线恢复；
- 中性术语和可访问性。

退出条件：

- UI 可从 durable facts 重建；
- 高风险操作有权限/范围/receipt；
- 刷新不丢 Job；
- 键盘与屏幕阅读器路径通过 E2E。

### 12. Phase 10：生产化与分布式 Provider

实现：

- PostgreSQL/对象存储/队列/KMS Provider；
- 多租户限额和数据驻留；
- 资源 reservation 与背压；
- OTel、SLO 和容量测试；
- 安装、升级、回滚、disable、uninstall；
- 签名资产、灾备和 legal hold。

退出条件：

- 恢复演练和故障注入通过；
- 预算不出现负余额或重复结算；
- 租户数据隔离通过安全测试；
- 升级后旧 Session 要么精确匹配 current generation，要么安全隔离并完成显式迁移；
- 卸载数据处置可审计。

### 13. 首个推荐 PR 序列

```text
PR-01 generated contracts + event catalog
PR-02 preset assets + generation archive
PR-03 RC.2 fixture + compatibility probe
PR-04 SQLite ledger/outbox/artifact metadata
PR-05 General binding + model policy/receipt
PR-06 Authority/policy registry + AgentExecutionBinding
PR-07 budget reservation + usage settlement
PR-08 workspace + candidate patch
PR-09 verifier + integration/local main
PR-10 decision broker + ask-user relay
PR-11 one-session WebUI projection
```

前 11 个 PR 完成后再开始大规模多 Agent 编排。

### 14. 发布门禁

每个 Phase 必须：

- 文档/Schema/TS/Event Catalog 同步；
- Golden Trace 更新；
- RC.2 Fixture 无回归；
- 权限负向测试；
- 故障恢复路径；
- 变更说明和 migration；
- `IMPLEMENTATION-READINESS.md` 对应项更新。


---

<a id="part-23"></a>

## Part 23：风险登记册

源文件：`docs/23-risk-register.md`

### 1. 评分

- 影响：1（轻微）～5（灾难性）
- 可能性：1（极低）～5（很高）
- 优先级：影响 × 可能性
- 任何涉及未授权远端写、密钥泄漏、错误接受或账本损坏的风险都视为硬阻断项。

### 2. 主要风险

| ID | 风险 | 影响 | 可能性 | 控制措施 | 责任组件 |
|---|---|---:|---:|---|---|
| R-001 | 模型把猜测写成已确认事实 | 5 | 4 | Candidate 两阶段提交、证据引用、Memory 来源覆盖验证 | Verification / Memory |
| R-002 | “督战 Agent”本身幻觉或漏报 | 4 | 4 | Harness 确定性联锁为主；Inspector 仅补充语义检查 | Oversight |
| R-003 | 任务无限拆小导致协调成本失控 | 4 | 4 | 最小可独立验收单元、上下文交换成本、波次屏障 | Planning |
| R-004 | 任务过大导致轻量模型失败 | 4 | 4 | Complexity Vector、分解阈值、参谋复核、历史指标 | Planning / Staff |
| R-005 | 参谋部成为吞吐瓶颈 | 4 | 3 | 资格路由、领域分片、缓存、预留容量、队列 SLO | Staff / Radio |
| R-006 | 多参谋产生冲突指导 | 4 | 3 | 独立意见后由主责参谋编译单一 Directive，保存异议 | Staff |
| R-007 | 旧指导写回新版本任务 | 5 | 3 | `expectedTaskVersion`、CAS、expiresAt、stale 拒绝 | Radio / Runtime |
| R-008 | Worker 伪造“已调用工具” | 5 | 4 | 工具日志为真源，模型声明只作索引，完成联锁对账 | Oversight |
| R-009 | Worker 越权修改 specs 或 Git | 5 | 3 | Tool Guard、路径策略、专用工兵 Scope、系统 Git Provider | Specs / Git |
| R-010 | 工兵破坏用户已有 Git 历史 | 5 | 2 | 先侦察；不重写；专用 worktree；仅新增 commit；故障回滚 | Git |
| R-011 | 未授权 push/远端分支写入 | 5 | 2 | 默认网络 Git deny；Promotion Order；将军专属工具；用户明确授权 | Git / General |
| R-012 | 企业 API 密钥泄漏到 Prompt/日志 | 5 | 3 | Credential reference、Gateway、响应脱敏、secret schema、日志扫描 | Security |
| R-013 | 企业数据被提示注入操纵 | 5 | 3 | 数据/指令分离、来源信任、工具返回框定、不可执行外部文本 | API Gateway |
| R-014 | Verifier 覆盖不足造成错误接受 | 5 | 4 | Acceptance Coverage、独立回归、人工阻断类别、红队测试 | Verification |
| R-015 | 模型和 Verifier 共享同一错误假设 | 5 | 3 | 确定性工具优先、不同实现/模型交叉检查、负面测试 | Verification |
| R-016 | Tactical Skill 自我强化错误经验 | 5 | 3 | 生命周期门禁、对照样本、置信区间、Canary、回滚、隔离 | Tactics / Museum |
| R-017 | 指标被模型或团队“刷分” | 4 | 3 | 以外置验收和端到端结果为主；禁止用自报完成率 | Metrics |
| R-018 | Compaction 后评估重复执行 | 3 | 3 | compactionId 幂等键、exactly-once ledger transition | Memory |
| R-019 | Memory 摘要遗漏关键风险 | 5 | 3 | 确定性 Tactical Report、来源覆盖检查、风险强制章节 | Memory |
| R-020 | 并发锁死或波次无法退出 | 4 | 3 | 有序锁、租约、deadlock 检测、超时、人工/将军解锁流程 | Runtime |
| R-021 | Worker 数量超过验收能力 | 4 | 4 | workerCount 纳入 Verifier/Advisor capacity，返工预留 | Runtime |
| R-022 | 模型成本和延迟失控 | 4 | 4 | 角色预算、Wave budget、动态 reasoning、停止条件、压缩 | Metrics / Runtime |
| R-023 | DSH API 快速变化 | 4 | 5 | 自有领域契约、薄 Adapter、基线锁定、契约重放 CI | Adapters |
| R-024 | UI 状态与 Ledger 不一致 | 3 | 3 | Durable event projection、revision fencing、重连重放 | Web Client |
| R-025 | “军事化”命名造成组织或伦理误解 | 3 | 3 | 明确软件隐喻；督战无惩罚/胁迫语义；可配置中性显示名 | Product |
| R-026 | 用户输入与主 Agent 解释偏离 | 5 | 3 | Mission Intent 回显、约束/未知项分离、变更命令、用户覆盖权 | General |
| R-027 | 长期存储包含敏感 Artifact | 5 | 3 | 分类、TTL、加密、删除、访问日志、最小保留 | Artifact |
| R-028 | 子 Agent 崩溃后留下孤儿锁/租约 | 4 | 3 | Heartbeat 仅做 liveness、lease timeout、reaper、幂等恢复 | Runtime |
| R-029 | 多工作区合并产生隐藏冲突 | 4 | 3 | 写集合声明、隔离 workspace、集成任务、三方 Diff 验收 | Workspace |
| R-030 | 模型供应商降级或不可用 | 4 | 3 | 路由策略、可审计 fallback、暂停关键任务、不静默降 reasoning | Model Policy |

### 3. 风险处置规则

- `priority >= 16`：进入发布阻断清单；
- 影响 5：即使可能性低，也必须有自动化控制和演练；
- 风险接受必须由明确角色批准并记录到 Decision Ledger；
- 任何控制失败都生成 Incident，而不是只写日志；
- 风险状态在每个 Wave Barrier 重新评估。

### 4. 禁止的“风险控制”

以下做法不能被视为有效控制：

- 仅在 Prompt 中要求“不要撒谎”；
- 让同一个 Worker 自己验收自己；
- 用另一个同质模型的“看起来没问题”替代测试；
- 认为工具可见性等同于权限；
- 用最终自然语言答案替代 Artifact 和事件；
- 让模型决定是否记录其失败；
- 依赖主 Agent 记住所有约束。

### 0.2.0 新增风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Preset 插件误放 Host 全局层 | 普通会话被污染 | standing scope、isolate 检查、prompt/tool snapshot 测试 |
| 同 cwd 锁误拦普通会话 | 破坏默认 DSH 工作流 | Military 锁仅协调绑定 Agent，外部变化只做 drift |
| 历史会话提炼泄漏 Secret | 私有知识污染/泄漏 | 显式来源、分类、redaction、fail closed、用户 Diff |
| Tag rename/delete 破坏引用 | Skill 无法检索 | 稳定 tagId、alias、tombstone |
| 模板热改导致绩效混合 | 归因错误 | immutable revision、实例快照、分组报告 |
| 压缩循环 | 延迟和上下文损坏 | pressure generation、hysteresis、每 Turn attempt 上限 |
| 子代理并发弹窗 | 用户阻塞/错答 | root General 单一所有权、DecisionQuestionSet |
| Chief 建议被当事实 | 错误推进 | GENERATED_REFERENCE、事实/假设分离、Verifier |
| 委员会自评和任务偏差 | 不公平排名 | 独立 examiner、难度分层、小样本保护、数据质量 |

### 0.3.0 新增高优先风险

| 风险 | 影响 | 主要缓解 |
|---|---|---|
| 旧 Session 重启后被挂到新 preset generation | 工具/Prompt/权限历史不可重放 | 内容寻址 archive、Binding、quarantine、migration fixture |
| Schema、TS、Event Payload 漂移 | 不同组件对同一事实解释不同 | Event Catalog 生成、parity、示例全覆盖、CI freshness |
| Worker 共享工作树相互覆盖 | 未验收代码污染、错误验收 | 独立 worktree、Patch Artifact、Integration Queue、global regression |
| 跨会话提炼/评估越权 | 租户或敏感数据泄漏 | Authority Context、source rights、classification、audit |
| Git/Artifact 与 DB 双写失败 | 账本和真实副作用不一致 | intent/outbox/receipt/compensation/recovery scan |
| General 模型切换错误传播到子代理 | 模板评估与权限漂移 | root-role scoped override；child route 冻结 |
| 用户问题并发或旧回答落地 | 错误决策进入新 Task Version | Decision Broker revision、expiry、stale、first-commit-wins |
| 绩效样本偏差与伪精确排名 | 用户做出错误模板决策 | Dataset Manifest、难度校正、区间、双评委、申诉 |
| Thinking Agent 无限循环和过载 | 宿主不稳定、质量下降 | 多级预算、reservation、背压、无信息增益检测 |
| 军事隐喻被理解为现实伤害/人事机制 | 伦理、采用和品牌风险 | 中性术语、明确排除范围、Agent-only Freeze/Evaluation |
| RC.2 外部版本被误判兼容 | 运行时隐性破坏 | release+commit 精确 probe；其他版本不声明支持 |
| 安装/升级覆盖已有 preset 配置 | 用户会话无法启动 | profile revision CAS、完整 config 重述、备份与原子回滚 |


---

<a id="part-24"></a>

## Part 24：运行与故障处置手册

源文件：`docs/24-operations-runbook.md`

### 1. 启动前检查

1. 确认 DSH 版本处于支持矩阵；
2. 运行 Bundle 配置 dump，确认 `dsh-military` 位于基础 Bundle 之后；
3. 验证 Ledger、Artifact、Radio 和 Session persistence；
4. 验证默认模型支持所需 reasoning effort；
5. 执行权限自检：Worker/工兵/参谋/将军工具矩阵；
6. 在临时仓库执行 Git policy 演练；
7. 注册 Verifier，并检查关键任务类型不存在空验收；
8. 检查 Advisor Profile 所引用的技能/API/凭据均可解析；
9. 执行事件重放与 schema 校验；
10. 启动后确认没有 orphan lease、open compaction 或 frozen session。
11. 检查 Command Saga pending/expired effect lease、transactional outbox lag 和
    dead-letter；
12. 分布式部署核对 Ledger、对象存储、队列、KMS descriptor 与探针，任一仍为本地
    实现时保持 `LOCAL_ONLY`。

### 2. Mission 启动

```text
用户输入
→ 将军创建 Mission Intent 草案
→ 项目侦察
→ 用户约束回显
→ 参谋会商
→ Direction 批准
→ 工兵基线（如需要）
→ Wave 进入
```

Mission Intent 中的未知项可有默认假设，但必须标明 `assumption`，不得伪装为用户事实。

### 3. 正常波次运行

- 调度器只租赁 Ready Task；
- Worker 获得 Task Context Packet；
- 每个工具调用进入 Evidence Ledger；
- Agent 只能通过 Candidate 或 Blocker 结束任务；
- Candidate 进入 Verifier；
- Rework 返回原 Task 的新 attempt，不修改冻结验收；
- Wave Barrier 后工兵更新 specs；
- 所有 commit、报告和指标完成后才进入下一 Wave。

### 4. Agent 冻结

#### 触发

- 无工具证据却声称完成；
- 修改禁止路径；
- 调用未授权 API；
- 任务版本过期仍继续写；
- 重复无进展循环；
- 输出与 Artifact 明显冲突；
- 工兵 Git 纪律违规；
- 参谋越权访问技能或数据。

#### 自动动作

1. 追加 `oversight/freeze-requested`；
2. Harness 将 Agent 状态设为 `FROZEN`；
3. `agent.cancel({kind:'hook'}, {keepInbox:true})`；
4. `agent/pre-step` 拒绝新步骤；
5. Tool Guards 拒绝写调用；
6. 保存最新环境快照；
7. 创建 Inspection Report；
8. 发送参谋部审查任务。

#### 解除

只允许：

- 修正命令已形成；
- Task Version 未过期或已重发；
- 权限和环境已修复；
- Harness 追加 `oversight/released`。

如果 Agent 已不可信，替换 Agent，不恢复原会话写权限。

### 5. Radio 堵塞

#### 指标

- oldest admissible request age；
- queue depth；
- advisor utilization；
- stale/duplicate ratio；
- dead-letter growth。

#### 处置

1. 暂停派发会产生同类阻塞的新 Task；
2. 提升对应领域参谋并发，但不超过技能/API 配额；
3. 合并重复请求；
4. 将缺证据请求退回 Worker；
5. 对战略问题直接升级将军；
6. 超过 SLO 时降低新 Wave 并发。

### 6. Verifier 不可用

- 禁止自动接受；
- Candidate 保持 `VERIFY_PENDING`；
- 可以继续执行无依赖的其他 Task；
- 不能进入依赖该结果的下一 Task；
- 对非关键可配置 Verifier 可使用已批准的替代 Provider；
- 替代行为必须写入事件和 Tactical Report。

### 7. Git 失败

#### `git init` 失败

- 工兵停止；
- 保存命令和 stderr Artifact；
- 检查权限、路径和磁盘；
- 不通过删除用户文件“修复”。

#### commit 失败

- 保留工作树；
- 不执行 `reset --hard`；
- 生成 Blocker；
- 参谋决定修复 identity、hook 或索引问题。

#### 发现已有非 main 默认分支

- 不重命名用户分支；
- 创建受控本地 main worktree 的具体策略由 Git Provider 决定；
- 任何可能重写历史的动作升级将军并要求用户授权。

#### 发现远端

工兵仍禁止 push。远端存在不改变权限。

### 8. Compaction 与效能评估

- `compaction/start` 无匹配 `end`：标为 orphan，暂停该 Session 的新评估；
- 成功结束：以 `compactionId` 创建幂等 Evaluation Job；
- Evaluation 失败：重试任务，不回滚 compaction；
- Memory 生成失败：保留确定性 Tactical Report，通知将军“摘要不可用”。

### 9. Ledger 故障

#### 写失败

- 不向模型声称状态已改变；
- 当前操作返回明确失败；
- 禁止“先执行后补记”高风险动作。

#### Command Saga 或 Outbox 卡住

1. 按 `operationId` 查看 `PENDING_EFFECT/RETRYABLE/EFFECT_APPLIED/COMMITTED`、
   lease owner/fence 和最后 heartbeat；
2. effect lease 未过期时不启动第二执行者；
3. lease 过期后先查询外部 operation receipt/postcondition，再决定补记 checkpoint
   或使用同一 operationId 重投；
4. `EFFECT_APPLIED` 只允许补交领域 receipt + outbox + COMMITTED fence，不重复
   外部副作用；
5. outbox 依据 claim/lease/delivery offset 幂等重投，超过策略后 dead-letter 并
   提升健康告警；
6. 禁止在事务中运行 Git/Provider/文件操作，也禁止手工把 operation 改成
   COMMITTED。

#### 投影损坏

1. 锁定 Mission 写；
2. 从不可变事件全量重建；
3. 对比 checksum；
4. 若事件本身损坏，从备份恢复；
5. 记录 Incident 和恢复边界。

### 10. Tactical Skill 回滚

- 将版本标记 `QUARANTINED`；
- 停止新分配；
- 找出所有使用该版本的 Task；
- 对尚未接受结果重新评估；
- 已接受结果按风险决定回归验证；
- 恢复前必须发布新版本，禁止原地篡改。

### 11. 紧急停止

紧急停止顺序：

1. 停止新 Mission 和新 Task lease；
2. 冻结所有写 Agent；
3. 取消活动模型请求；
4. 等待已启动工具达到 quiescence；
5. flush Session、Ledger、Artifact metadata；
6. 释放租约和工作区锁；
7. 生成 Shutdown Report；
8. 不自动执行远端 Git 或破坏性清理。

### 12. 恢复

恢复不等于重启所有 Agent：

1. 重放 Mission Ledger；
2. 识别 `LEASED/EXECUTING` 且 lease 过期的 Task；
3. 检查其工作区和工具副作用；
4. 通过恢复策略决定 resume、replace 或 manual review；
5. stale Agent 结果只可作为证据，不可直接接受；
6. 恢复后先运行 Oversight reconciliation，再继续 Wave。

### 0.2.0 运维操作

#### Preset 故障

- roster 显示 broken 时停止创建新 Military 会话；
- 已运行 generation 保持，记录兼容状态；
- 修复文件后只让新会话进入新 generation；
- 不强制迁移正在执行的 Mission。

#### Ingestion 事故

- 暂停 Tag 或 Quarantine 受影响 Tactic；
- 保留来源和使用审计；
- 执行 redaction/撤回评估；
- 禁止物理删除掩盖历史使用。

#### Evaluation 事故

- 取消 Job 不删除已完成分片；
- retryable failure/timeout 保留 Frozen Dataset 和成功 configuration shard；
- 重启后重新取得 lease/fence，只补缺失 shard；
- dataset hash 改变时创建新 Run，禁止复用旧 shard；
- 错误报告通过申诉/撤回和 superseding revision 处置，不就地改写；
- 权限撤销后关闭 Evidence 下载。

### 0.3.0 运维扩展

#### A. 恢复旧 preset generation

1. 暂停该 Session 的模型和写工具；
2. 读取 `MilitarySessionBinding.presetGeneration`；
3. 校验 generation manifest、文件 hash 和 RC.2 commit；
4. 若 generation 等于 current，则 `MATCHED`；
5. 若只是 archive 且进程已重启，根 Session 进入 `QUARANTINED/MIGRATION_REQUIRED`；只有同进程旧 standing scope 或显式受支持 resolver 才可 `ARCHIVE_REBOUND`；
6. 缺失则 `QUARANTINED`，禁止挂 current；
7. 由用户选择执行 Migration Order、创建新 Session 或导出；
8. 记录 `PresetResumeReceipt`。

#### B. Integration 卡住

1. 确认 Candidate 已 Accepted 且 source snapshot 未变；
2. 检查 Workspace Lease、local main HEAD 和 external drift；
3. 若仅补丁冲突，生成 `IntegrationConflictReport`；
4. 新建 Conflict Resolution Task，不让原 Worker直接改 main；
5. 重新运行全局回归；
6. commit 后写 `IntegrationReceipt`；
7. 若 Git 成功而 Ledger 失败，恢复扫描按 commit trailer/idempotency 补 receipt。

#### C. Decision 无人回答

1. 查看 Broker 状态和 expiry；
2. 确认根 General 仍存活；
3. 检查是否已被其他标签页回答；
4. 到期后执行配置的 `PAUSE/DEFAULT/ESCALATE`，高风险禁止默认；
5. Task Version 变化则标记 `STALE`；
6. 用户恢复时创建新问题，不复用旧 revision。

#### D. 预算耗尽

1. 停止新 reservation；
2. 取消未开始的推测任务；
3. 保留已产生 Candidate/Evidence；
4. 生成 `PAUSE_AND_REPORT`；
5. 展示已用/预留/预计完成差额；
6. 用户追加时生成 Authorization Receipt 和 Change Order；
7. 不关闭 Thinking、Verifier 或安全 Guard。

#### E. Compatibility Probe 失败

- 关键 seam 缺失：停止 Military admission；
- 只读能力可用：允许历史导出，不运行 Agent；
- Standard Session 保持默认 DSH 流程；
- 保存 probe report 与版本；
- 恢复组件后重新探测，不能手工篡改状态为 READY。

#### F. 安装/升级/卸载

遵循[Bundle 生命周期](docs/46-install-upgrade-rollback-uninstall.md)。任何 profile 写入先备份和 revision CAS；卸载前枚举未完成 Mission、generation、战术、报告、Artifact 和 legal hold。

#### G. 使用“Military-安全与恢复”

1. 先刷新健康快照，确认 SQLite/WAL、Preset/Bundle、Mission/Task、child、
   worktree、Grant、outbox 和 receipt 的时间；
2. 选中异常对象并查看 Session 诊断时间线；确认原始模型选择、Schema、Host
   补全、路径、执行和终态 receipt 的断点；
3. 选择恢复动作，只生成预览；
4. 阅读 operation scope、影响、风险和不会发生的副作用；
5. 复制预览生成的精确确认短语，再执行；
6. 保存返回的 `operationId` 和 receipt；网络中断时只用同一 ID 重试；
7. 刷新权威状态，不能以按钮成功提示代替 postcondition。

显式取消整条 Mission 时：

1. 在 Mission 下拉框中选择目标并核对标题、状态、revision 和更新时间；
2. 填写可审计原因，生成 `CANCEL_MISSION` 预览；
3. 核对 CAS diff、影响范围和“停止全部未终态 Task、释放 child 资源”的警告；
4. 在预览过期前输入精确高风险确认短语并执行；
5. 从 receipt 核验 Kernel cancellation reference 和已清理 child 数；
6. 若预览后 state hash 改变，丢弃旧预览并重新生成；若网络中断，先刷新 receipt
   与 Mission 状态，禁止把 Stop、Freeze 或手工终态当作 Mission Cancel。

允许的操作只有数据库验证、`VACUUM INTO` 一致备份、reconcile、stale outbox
重投、已证明过期资源释放、父级唤醒和上述受治理 Mission Cancel。不存在编辑
SQLite、删除任意 worktree、手工标记 Task 完成或覆盖终态。

#### H. Specs 路径或写入异常

1. 在“Military-Specs 工作区”选择发生问题的 Session workspace；
2. 对照 canonical root/hash、Git HEAD/tree、dirty/untracked 和路径授权树；
3. 查看 Task lease、worktree、Candidate 和 integration receipt；
4. 若工作区不在目录中，先修复 Session binding，不要在浏览器粘贴绝对路径；
5. 对 `FORBIDDEN/UNSCOPED` 路径按 Task/Permission 修订重新派遣，不手工扩大
   Grant；
6. 若 Git 已提交但 receipt 缺失，使用受治理 `RECONCILE`；
7. 未提交或验证失败时保持零部分 Specs 状态，由原 operation ID 恢复。

RC.2 当前没有外部目录 picker；`workspaceId` 是唯一选择输入。插件源码目录、
其他 Session workspace 和 symlink escape 必须保持不可选。

#### I. Flash 工具错误评估

1. 先运行固定九场景 deterministic gate，确认 dataset hash；
2. 从可评估 Session 中选择 exact provider/model 的真实样本；
3. 分别检查 General、Worker、Engineer、Staff 的首调用、Schema、纠正、终态、
   写 receipt 和父级唤醒；
4. 不把 deterministic PASS 记为 Provider PASS；
5. 不把 alias 名称当 exact route；
6. 相同 exact configuration/场景按 dataset + Session + scenario 去重；独立
   Session 少于 50 时保持 `INSUFFICIENT_SAMPLE`；
7. 失败样本导出 Session/Host evidence 后进入回归，不通过手工修改 capability
   为 `VALIDATED`。
8. 导出后运行
   `npm run acceptance:flash -- --input <export.json>`；全部场景必须同时满足首次
   工具命中估计≥95%且 Wilson 下界≥85%、E2E≥90%且下界≥80%，并且意外确定性
   失败/越权成功写/假完成/重复终态均为 0。
9. 每次失败只按 envelope 中唯一 `nextTool` 和 `correctedShape` 修正；若错误
   details 出现 secret、Bearer token 或宿主绝对路径，立即按安全缺陷阻断发布。

#### L. 生产 Provider readiness 或灾备异常

1. 查看 Operations Center 的 provider topology、capacity/backpressure、
   backup signature 与 restore drill receipt；
2. descriptor、probe 或 residency 不一致时停止分布式 admission，保留本地只读
   诊断，不自动 fallback 到无同等策略的存储；
3. 验证备份清单、内容 hash、签名 key id 和 legal-hold index 后再恢复；
4. 恢复到隔离目标，重放 Ledger/outbox，比较 canonical projection 和 Workspace
   receipt，完成后生成 restore receipt；
5. 未完成 PostgreSQL/对象存储/队列/KMS 适配器注入和演练的部署只能标记
   `LOCAL_ONLY`，不能报告 HA READY。

#### J. 私有技能召回异常

1. 在 Knowledge Center 查看 sanitized snapshot、redaction/injection receipt
   和 Chunk/extraction 状态；
2. 沿 Candidate→review→version→promotion→Usage→revocation lineage 定位；
3. 使用同一任务文本运行“模拟召回”，核对入选/排除原因和 exact delivery
   block；
4. 确认 Skill lifecycle、owner/license/scope、retention、dependency 和来源
   撤回状态；
5. 模拟不会创建 Task；若模拟与实际投放不同，应以 registry/settings/Task
   版本和 Host context manifest 对账；
6. 禁止把 Raw Vault 原文复制到诊断或浏览器日志。

#### K. 绩效评估 Job、报告或申诉异常

1. 在“Military-绩效评估 → 历史/申诉”确认 Job state、failure code、
   `evaluationRequestId`、dataset hash 和最后成功 shard；
2. `FAILED` 且 `retryable=true` 时使用“从冻结分片重试”；不要重新扫描或删除
   SQLite 行；
3. 若失败原因是 Dataset Artifact/hash/Schema 不一致，停止重试，保留 Artifact
   并重新发起新 Request；
4. 对 stale lease/fence 冲突，确认旧进程退出并让新 owner 续租；不能手工覆盖
   revision；
5. committee model 失败应自动回退确定性叙述；若指标也变化，按数据完整性事故处理；
6. 价格目录缺失只影响 cost，UI 必须显示 unavailable，不能补 0；
7. 报告样本错误时提交绑定固定 finding/Evidence 的申诉；成立后由
   `RECOMPUTE_AND_SUPERSEDE` 产生新 Dataset/Report；
8. 核对旧 Report Artifact digest 未变、新 Report 的 `supersedesReportId`、
   unique Attempt/Mission、区间和 decision 差异；
9. 即使新报告 `DECISION_ELIGIBLE`，仍不得直接修改默认模型；另走显式 Canary/
   Active 治理 receipt。


---

<a id="part-25"></a>

## Part 25：DSH 设计参考与基线

源文件：`docs/25-reference-sources.md`

### 1. 固定基线

本方案的 DSH 兼容性分析固定于：

```text
Repository: deepseek-ai/deepseek-harness
Branch: master
Commit: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
Release commit message: dsh@0.1.1-rc.2
Observed: 2026-08-19
```

实现仓库应把该值写入 Adapter compatibility fixture。升级 DSH 时重新核对本页列出的接口，并运行契约重放测试。

### 2. 核心参考文件

| DSH 文件 | 本方案使用的能力 |
|---|---|
| `docs/architecture.md` | Cordis 插件树、Bundle/Profile、Session/Agent/Capability 事件、可替换 Agent Loop |
| `docs/subsystems/core.md` | `ctx.agents`、Agent Handle、cancel/followup/steer/inject、`agent/pre-step` |
| `packages/core/agent-loop/README.md` | programmatic setup、request preparation、turn-stopping、插件职责 |
| `docs/subsystems/tools.md` | 工具 schema、Pipeline、Guard、result、`concludeTurn()` |
| `docs/subsystems/subagent.md` | 子代理 Provider、continuable child、直接父级权限、report |
| `docs/subsystems/compaction.md` | `compaction/start/summary/end` 与重放语义 |
| `packages/skill/skill/README.md` | `ctx.skills` Provider registry、Scope 和 invocation policy |
| `packages/llm/llm-deepseek/README.zh.md` | V4 catalog 默认、reasoning effort、request/header |
| `docs/cookbook/adding-a-settings-card.md` | 外部插件 Host/Client 配置卡 |
| `docs/cookbook/adding-a-conversation-node.md` | Durable Session Event → Web Chat Node |
| `docs/cookbook/adding-a-package.md` | 包拓扑、seam 和构建约束 |
| `packages/bundle/base/package.json` | Bundle manifest |
| `packages/bundle/base/cordis.patch.yml` | Bundle patch 层示例 |

### 3. 兼容性核对表

DSH 升级时至少验证：

- `ctx.agents.create/resume` setup transaction；
- Agent Scope 和 persona 注入；
- `agent/request` 能否改写 reasoning；
- `request/header` 是否仍记录有效配置；
- `agent/pre-step` reject 语义；
- `agent/turn-stopping` 调度时点；
- `agent.cancel(..., {keepInbox:true})`；
- Tool Guards、post-execute、result 和 `concludeTurn()`；
- SessionEventMap declaration merging；
- Compaction event payload；
- continuable subagent 权限；
- settings namespace/card 注册；
- Conversation Node API；
- Bundle `dsh.bundle.patch` 格式。

### 4. 非目标

本方案不依赖：

- DSH 内部 `ReactLoopAgent` 类型；
- 私有源文件路径；
- 浏览器组件的未公开 value import；
- 某一个数据库或消息队列；
- 某一个模型必须优于另一个模型的假设。

所有易变细节都应封装在 `adapters-dsh-*` 包。

### 0.2.0 新增 DSH 参考文件

- `packages/preset/agent-presets/README(.zh).md`：preset standing scope、`mount()`、`composeFrom()`、空白切换和会话实际 preset；
- `packages/client/ui-agent-preset/README(.zh).md`：新建会话 chip、只读标签、管理 roster 和锁定行为；
- `apps/cli/config/agent-presets/standard/preset.yml`：内置 preset metadata 形状；
- `apps/cli/config/agent-presets/standard/agent.cordis.yml`：Agent Plane、Host Plane 和 isolate realm 的参考；
- `packages/interaction/commands/README(.zh).md`：命令 id 语法和 agent-scoped registration；
- `packages/interaction/tool-ask-user/README(.zh).md`：`ask_user_question` 协议和 delegated caller 限制；
- `docs/cookbook/adding-a-settings-card.md`：外部插件 Settings card；
- `docs/cookbook/adding-a-conversation-node.md`：Session Event 到 Web conversation node。


### 0.3.0 兼容性说明

当前文档只对上述 RC.2 commit 声明完整支持。`reference/dsh-rc2/compatibility-matrix.yml` 固化所需 seam；真实实现通过 Capability Probe 和 E2E Fixture 验证，而不是根据版本字符串乐观运行。

0.3.0 新增重点核对：

- RC.2 preset 恢复只持久 ID，Military 必须额外保存 generation；
- preset 内 General model default 与 Session model selector 的 request 优先级；
- `request/header` 对 effective reasoning/route 的重建；
- `composeFrom()` 继承父代 standing generation；
- delegated child 的 `ask_user_question` 限制；
- settings revision、conversation projection 和 compaction event；
- Agent cancellation/pre-step/tool guard 的 Freeze 竞态。


---

<a id="part-26"></a>

## Part 26：中国近代战争经验的工程抽象

源文件：`docs/26-historical-design-abstraction.md`

### 1. 使用边界

`dsh-military` 使用“军队、将军、参谋、工兵、电台、波次、后勤”等名称，是为了表达复杂系统中的职责、层级、资源和验证机制，不是历史复刻，也不包含现实世界中的暴力、惩罚或强制服从逻辑。

尤其是“督战队”在本系统中严格定义为：

> 只读证据审计 Agent + 确定性安全联锁。

它不惩罚、不评价人格、不胁迫 Agent，也不能自行修改任务。产品可提供中性显示名“监督与质量保障部”。

### 2. 可借鉴的成熟机制

#### 2.1 统一意图，分级执行

软件映射：

- 用户给出 Mission Direction；
- 将军形成 Mission Intent；
- 参谋形成 Direction/Wave/Task；
- Worker 只处理局部命令；
- 任何局部决策不得悄悄改变统帅意图。

这解决“所有 Agent 都在自由理解用户”的漂移。

#### 2.2 集中资源于关键方向

软件映射：

- 不平均分配模型、并发、参谋和验证能力；
- 对关键路径、高风险和高价值 Direction 分配更强模型与更多 Verifier；
- 其他方向保持必要兵力；
- 通过 Wave Budget 显式表达资源集中。

#### 2.3 分阶段推进与预备容量

软件映射：

- Wave 是同步批次，而不是无限并发；
- 不填满全部 Worker 容量；
- 预留返工、阻塞、集成和突发任务资源；
- 当前 Wave 结束后根据事实调整下一 Wave。

#### 2.4 侦察先行

软件映射：

- 项目侦察在规划前执行；
- 环境、仓库、技术栈、测试、权限、现有 specs 和 Git 状态必须形成 Environment Snapshot；
- 未知事实以假设或 Blocker 表示；
- 参谋不得用想象补齐环境。

#### 2.5 专业分工与联合会商

软件映射：

- 参谋按技术领域、数据权限、技能和工具区分；
- 各参谋先独立研判，避免首个意见锚定；
- 主责参谋综合并保留异议；
- 参谋部不是一个全能 Prompt。

#### 2.6 作战、工兵、后勤并重

软件映射：

- 代码/内容执行不能脱离 specs、Git、Artifact、验证和恢复；
- 空项目先建立 specs 基线；
- 每个 Wave 后维护文档和追踪矩阵；
- 可持续维护是完成标准的一部分。

#### 2.7 通信纪律

软件映射：

- 电台信件有身份、位置、环境、任务版本、技能版本、证据和请求问题；
- 消息有 lease、ack、重试、过期和死信；
- 心跳只处理存活性，不以轮询模型作为正常路由；
- 决策、事实和建议分开编码。

#### 2.8 实践检验与战后复盘

软件映射：

- 私有战术不能因“听起来合理”晋级；
- 必须经过真实任务、外置验收、对照和 Canary；
- Tactical Museum 固化版本并提出下一测试战术；
- Memory 是事件和证据的派生投影。

### 3. 不应照搬的机制

- 不把层级等同于绝对正确；
- 不把“执行命令”当成绕过用户授权；
- 不用军事化口号代替验收合同；
- 不把失败 Agent 视为需要惩罚的主体；
- 不隐藏异议和风险；
- 不把并发数量等同于战斗力；
- 不允许“将军”拥有未审计的全局写权限。

### 4. 工程判断

历史经验在此只提供组织设计启发。每个术语都必须落成：

- 可验证接口；
- 清晰权限；
- 状态机；
- 事件；
- 失败模式；
- 可替换实现。

无法落成这些要素的比喻应从产品中删除。

### 0.3.0：隐喻使用边界

历史组织经验只被抽象为软件工程机制：职责分层、证据、通信、保障、复盘和版本化程序。不得从历史战争语境推导现实伤害、目标选择、强制服从或对人员的自动处分。

产品支持军事/中性两套显示词，机器 ID、权限和状态不变。督战仅代表软件质量联锁；绩效委员会只评价 Agent Template 和流程，不评价人。完整约束见[产品术语与安全边界](docs/52-product-terminology-and-safety-boundary.md)。


---

<a id="part-27"></a>

## Part 27：API、数据契约与错误语义

源文件：`docs/27-api-and-data-contracts.md`

### 1. 契约分层

#### Command

表达请求改变状态，必须有授权、幂等键和 expected revision。

#### Event

表达已经发生的不可变事实，只能追加。Mission 内事实使用 Mission Ledger；Tag、Template、Ingestion 和 Performance Evaluation 等跨 Session 管理事实使用独立 Administrative Ledger，二者不能混写。

#### Query

读取投影，不改变状态。

#### Artifact

承载大体积、不可安全放进事件的内容。

#### Model Message

是从 Command/Event/Artifact 投影出的模型可见内容，不是真源。

### 2. 领域标识

所有标识均为不透明字符串：

```text
MissionId
DirectionId
WaveId
TaskId
TaskVersion
AttemptId
WorkflowObligationId
ActivationId
DispatchId
AgentId / SessionId
AdvisorId
TacticalRequestId
TacticalGuidanceId
TacticalSkillId + SemVer
AcceptanceContractId + Version
ArtifactId (content hash)
CompactionId
PromotionOrderId
AgentTemplateId + Revision
TacticalTagId + Revision
TacticalIngestionRequestId
TacticalExtractionCandidateId
BrainstormOrderId
DecisionSetId
ChiefAdviceId
EvaluationRequestId
PerformanceReportId
WorkspaceSnapshotId / WorkspaceLeaseId
CandidateSubmissionId / CandidatePatchId
VerificationReceiptId / IntegrationReceiptId
OperationId / OutboxRecordId
PrincipalId / TenantId
ArtifactContentId / ArtifactReferenceId
```

不得把数组索引、显示名或 Agent 标签作为稳定身份。

### 3. 关键命令

```ts
startMission(input, authority)
createWorkflowObligation(input, authority)
ratifyDirection(command, expectedMissionRevision)
openWave(command, expectedDirectionRevision)
leaseTask(taskId, workerIdentity, expectedTaskVersion)
startAttempt(command, expectedTaskVersion)
activateAgent(command, expectedAttemptFence)
recordDispatch(command, expectedActivationFence)
submitCandidate(candidate, expectedTaskVersion)
submitBlocker(blocker, expectedTaskVersion)
requestTacticalGuidance(request)
issueGuidance(guidance, expectedTaskVersion)
freezeAgent(command, expectedAgentRevision)
releaseAgent(command, expectedAgentRevision)
acceptCandidate(decision, expectedTaskVersion)
issueSpecsMaintenance(order)
commitSpecs(receipt)
createPromotionOrder(order, userAuthorization)
publishTacticVersion(command)
bindMilitarySession(binding)
createAgentTemplateRevision(command)
changeTacticalTag(command)
requestTacticalIngestion(request)
reviewTacticalExtractionCandidate(command)
startBrainstorm(command)
recordBrainstormDecision(command)
requestChiefOfStaffAdvice(command)
requestPerformanceEvaluation(request)
cancelPerformanceEvaluation(command)
```

### 4. 关键查询

```ts
getMissionSnapshot(missionId)
getWorkflowObligation(obligationId)
getDirection(directionId)
getWave(waveId)
getTask(taskId)
listReadyTasks(waveId)
getAgentIdentity(agentId)
getEvidenceGraph(candidateId)
getAdvisorEligibility(context)
retrieveTactics(query)
getRadioQueue(filter)
getTacticalMemory(missionId, boundary)
getSpecsStatus(missionId)
getMilitarySessionBinding(sessionId)
listAgentTemplates(filter)
listTacticalTags(filter)
getTacticalIngestionJob(requestId)
getBrainstormOrder(orderId)
listPendingDecisionQuestionSets(rootSessionId)
getChiefOfStaffAdvice(adviceId)
getPerformanceEvaluation(evaluationRequestId)
getMilitaryPerformanceReport(reportId)
getRuntimeProjection(requestId)
getCommandOperation(operationId)
getArtifactReference(referenceId, principal)
```

### 5. 错误码

#### 通用

| Code | 含义 |
|---|---|
| `INVALID_ARGUMENT` | Schema 或领域约束错误 |
| `UNAUTHORIZED` | 调用者无该动作权限 |
| `FORBIDDEN_SCOPE` | 路径、工具、API、技能或数据范围越界 |
| `REVISION_CONFLICT` | CAS revision 不匹配 |
| `STALE_TASK_VERSION` | Task 已被修订 |
| `IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 |
| `NOT_FOUND` | 稳定标识不存在 |
| `CAPACITY_EXHAUSTED` | 当前无 Worker/Verifier/Advisor 容量 |
| `DEPENDENCY_NOT_READY` | 任务前置条件未满足 |
| `RESOURCE_LOCKED` | 写集合或环境被占用 |
| `POLICY_DENIED` | 确定性策略拒绝 |
| `PERSISTENCE_FAILED` | 事实未能持久化，状态不可声称已改变 |
| `RECOVERY_REQUIRED` | Snapshot 存在但没有新鲜 start/heartbeat/settlement receipt |
| `OPERATION_IN_PROGRESS` | 稳定 operationId 已被有 fence 的执行者租赁 |
| `OPERATION_OUTCOME_UNKNOWN` | 外部副作用需先查询 postcondition/receipt |

#### 验收

| Code | 含义 |
|---|---|
| `MISSING_EVIDENCE` | 验收条款无对应证据 |
| `UNVERIFIED_TOOL_CLAIM` | 模型声称的工具使用不存在 |
| `ARTIFACT_MISMATCH` | Artifact hash/版本与声明不一致 |
| `REGRESSION_FAILED` | 回归检查失败 |
| `ACCEPTANCE_INCOMPLETE` | 覆盖不足 |
| `CANDIDATE_STALE` | Candidate 对应旧环境/任务 |
| `SELF_VERIFICATION_ONLY` | 仅有执行 Agent 自评 |
| `HUMAN_REVIEW_REQUIRED` | 无法安全自动判定 |

#### Radio

```text
REQUEST_NOT_ADMISSIBLE
DUPLICATE_BLOCKER
CHEAP_RETRY_AVAILABLE
MISSING_REPRODUCTION
GUIDANCE_STALE
GUIDANCE_EXPIRED
ADVISOR_UNAVAILABLE
DEAD_LETTERED
```

#### Preset、交互、提炼与评估

```text
MILITARY_PRESET_REQUIRED
MILITARY_BINDING_MISMATCH
MILITARY_PRESET_GENERATION_MISMATCH
AGENT_TEMPLATE_INACTIVE
AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED
CONTEXT_POLICY_INVALID
COMPACTION_ATTEMPT_FAILED
TACTICAL_TAG_INACTIVE
TACTICAL_TAG_DELETED
TACTICAL_SOURCE_NOT_AUTHORIZED
TACTICAL_SOURCE_REDACTION_REQUIRED
TACTICAL_CANDIDATE_STALE
TACTICAL_REVIEW_REQUIRED
BRAINSTORM_ALREADY_ACTIVE
BRAINSTORM_NOT_ACTIVE
DECISION_SET_DUPLICATE
DECISION_SET_STALE
CHIEF_FALLBACK_NOT_ADMISSIBLE
EVALUATION_DATASET_INCOMPLETE
EVALUATION_INSUFFICIENT_DATA
EVALUATION_REPORT_MISMATCH
```

#### Git

```text
GIT_NETWORK_FORBIDDEN
GIT_REMOTE_WRITE_FORBIDDEN
GIT_NON_MAIN_FORBIDDEN
GIT_HISTORY_REWRITE_FORBIDDEN
GIT_WORKTREE_DIRTY
GIT_COMMIT_FAILED
PROMOTION_ORDER_REQUIRED
```

### 6. 幂等性

- Command 必须携带 `idempotencyKey`；
- 相同键和相同规范化 payload 返回原 receipt；
- 相同键和不同 payload 返回 `IDEMPOTENCY_CONFLICT`；
- Candidate 以 `(taskId, taskVersion, attemptId)` 唯一；
- Evaluation 以 `compactionId` 唯一；
- Guidance 以 `requestId + advisorGeneration` 唯一；
- Git commit 以 specs change-set hash 唯一；
- Tactical Ingestion 以规范化来源快照 + 目标 + policy hash 唯一；
- Brainstorm 一个 root Session 同时最多一个 ACTIVE Order；
- Performance Evaluation 以时间区间、筛选、rubric 和 template revision 集合的 dataset hash 唯一。

### 7. 版本与并发

所有改变聚合状态的命令携带 `expectedRevision`。Ledger 使用 compare-and-swap：

```text
expectedRevision == currentRevision
  → append event, revision + 1
else
  → REVISION_CONFLICT
```

Task 的 `taskVersion` 与聚合 revision 分开：

- revision 表示记录变化；
- taskVersion 表示执行合同变化；
- 注释、观察或指标可增加 revision 而不使 Candidate stale；
- Objective、scope、acceptance、environment 或依赖变化必须增加 taskVersion。

### 8. Artifact Contract

```ts
interface ArtifactDescriptor {
  id: string
  mediaType: string
  byteLength: number
  sha256: string
  classification: 'public' | 'internal' | 'confidential' | 'restricted'
  producer: AgentIdentity | 'harness'
  createdAt: string
  taskId?: string
  taskVersion?: number
  retentionPolicy: string
  redaction?: {
    applied: boolean
    rules: string[]
    sourceArtifactId?: string
  }
}
```

事件只保存 descriptor/ref，不内嵌大日志、密钥或二进制。

### 9. 数据兼容性

每个顶层 payload 包含：

```json
{
  "schemaVersion": "1.0.0"
}
```

兼容规则：

- 新增可选字段：向后兼容；
- 收紧 enum、改变语义或删除字段：新主版本；
- Reader 应拒绝未知主版本；
- Event migration 不重写历史，通过 projection upgrader 读取；
- Tactical Skill 版本使用自身 SemVer，与 schemaVersion 分开。

### 0.2.0 新增契约族

#### Preset/Session

- `MilitarySessionBinding`；
- `MILITARY_PRESET_REQUIRED`、`MILITARY_BINDING_MISMATCH`；
- child composition receipt。

#### Tactical Ingestion

- `TacticalTag`；
- `TacticalIngestionRequest`；
- `TacticalExtractionCandidate`；
- Source Snapshot、Review Receipt、Draft Version Receipt。

#### Agent Templates/Context

- `AgentTemplateProfile`；
- `CompactionAttempt`；
- effective model/context resolution receipt。

#### Interaction/Staff

- `BrainstormOrder`；
- `DecisionQuestionSet`；
- `ChiefOfStaffAdvice`。

#### Evaluation

- `PerformanceEvaluationRequest`；
- `EvaluationAttemptRecord`；
- `FrozenEvaluationDataset`；
- `AgentTemplatePerformance`；
- `EvaluationConfigurationComparison`；
- `MilitaryPerformanceReport`；
- `EvaluationCenterSnapshot`；
- immutable Evaluation Dataset/Report Artifact 与 Appeal lineage。

### 0.3.0：契约真源

#### Event

`contracts/event-catalog.json` 是 Mission 与 Administrative Event type/payload 的唯一维护源。生成器产生：

```text
schemas/mission-event.schema.json
schemas/administrative-event.schema.json
reference/types/generated-event-catalog.ts
examples/events/*.jsonl
contracts/EVENT-CATALOG.md
```

Event Envelope `schemaVersion=2.0.0`，每个 `type` 对应精确 Payload，不再允许开放 `payload: object`。

#### 跨进程对象

新增一级契约族：

- generation、migration、compatibility；
- Authority、Authorization、Tool/Permission/API/Residency/Redaction/Verifier/Model Profile；
- General Policy 与 Model Selection Receipt；
- Workspace、Lease、Patch、Integration；
- Evaluation Dataset；
- Tactical Source/Revocation；
- Decision Broker、Compaction Attempt、Change Order、Budget、Bundle Lifecycle。

每个写 Command 产生 Event 或 Receipt；Query 不改变权威状态。外部副作用先有 intent/idempotency，后有 receipt/compensation。

#### Schema 与 TypeScript

`contracts/parity-map.json` 对关键共享对象校验字段和 requiredness。实现代码应从 Schema/IDL 生成类型，手写类型只用于服务行为和 branded IDs。

#### 错误

错误必须稳定分类：

```text
AUTHORIZATION_DENIED
REVISION_CONFLICT
PRESET_GENERATION_MISSING
RC2_INCOMPATIBLE
MODEL_CAPABILITY_REJECTED
BUDGET_EXHAUSTED
WORKSPACE_DRIFT
INTEGRATION_CONFLICT
DECISION_STALE
SOURCE_RIGHTS_DENIED
INSUFFICIENT_EVALUATION_DATA
```

错误不得通过自由文本决定恢复动作；结构化 code、subject、revision、retryability 和 recovery options 进入 API/UI。

### 10. 0.3.0 治理命令与回执

新增权威命令：

```text
bindAgentExecution(binding, expectedMissionRevision)
resumePresetGeneration(sessionId, requestedGeneration)
reserveResourceBudget(reservation)
settleResourceUsage(receipt)
submitPerformanceEvaluationAppeal(appeal)
resolvePerformanceEvaluationAppeal(command)
```

新增查询：

```text
getAgentExecutionBinding(bindingId)
getPresetResumeReceipt(receiptId)
getBudgetReservation(reservationId)
listResourceUsage(scopeType, scopeId)
getPerformanceEvaluationAppeal(appealId)
listPerformanceEvaluationAppeals(reportId)
```

新增错误码：

```text
AGENT_EXECUTION_BINDING_MISMATCH
AGENT_EXECUTION_BINDING_MISSING
PRESET_RESUME_RECEIPT_FAILED
BUDGET_RESERVATION_REQUIRED
BUDGET_RESERVATION_EXPIRED
BUDGET_SETTLEMENT_CONFLICT
EVALUATION_APPEAL_UNAUTHORIZED
EVALUATION_APPEAL_STALE_REPORT
EVALUATION_APPEAL_EVIDENCE_REQUIRED
```

所有回执必须在声明状态改变前持久化。模型不能构造 Authorization、Binding、Resume、Integration、Budget 或 Appeal resolution 的权威 Receipt；模型最多提出经过 Schema 校验的建议内容。

### 11. 0.9.0-alpha.28 Web 控制面契约

Web Client 只通过六个窄 Typert Remote 访问 Host；每个 Remote 只有只读
`snapshot` 和一个带判别字段的 `execute`，不暴露数据库、文件系统或 Git 对象。

#### `militaryControlPlane`

读取 `RoleWorkbenchSnapshot`，包含角色配置、DSH live 模型目录、六层有效
Prompt、Flash readiness、不可变 history、运行指标和模拟记录。动作：

```text
PREVIEW_ROLE
SAVE_ROLE
RESTORE_ROLE_PROMPT
RESTORE_ROLE_DEFAULTS
ROLLBACK_ROLE
UNDO_ROLE
SIMULATE_ROLE
RUN_LIVE_CANARY
EXPORT_PORTABLE
IMPORT_PREVIEW
IMPORT_COMMIT
```

`SimplifiedChineseReviewInput` 只表达源文本、用户确认的位置和是否接受剩余问题；
Host 重新 lint、转换和计算 `SimplifiedChineseReviewReceipt`。Client 不能提供
receipt hash 或转换后权威结果。

#### `militaryOperations`

`snapshot` 返回诊断 Session 目录和恢复健康状态。动作：

```text
SESSION_TIMELINE
PREVIEW_RECOVERY
EXECUTE_RECOVERY
```

恢复预览生成 `operationId`、scope、影响和精确确认短语；执行时重新计算预览。
`operationId` 与不同 payload 复用返回幂等冲突。

#### `militaryWorkspace`

`snapshot` 从当前租户已绑定 Session 产生 `MilitaryWorkspaceCatalogEntry[]`。
唯一动作 `INSPECT_WORKSPACE` 只接受不透明 `workspaceId`，返回
`MilitaryWorkspaceStatus`。绝对路径没有输入字段；canonical root 只在 Host
验证后作为只读事实返回。

#### `militaryBenchmark`

`snapshot` 返回固定 dataset、deterministic run、Provider sample、稳定性分组和
eligible Session。动作：

```text
RUN_DETERMINISTIC
ASSESS_PROVIDER_SESSION
```

每个 run/sample 固定 dataset hash、Bundle/Preset、角色 revision、exact route、
reasoning、ToolProfile 和预算。Provider 稳定性按 dataset + Session + scenario
去重。观察趋势标签在 exact-route 独立 Session 少于 10 或 Wilson 区间宽度大于
0.35 时只能是 `INSUFFICIENT_SAMPLE`；发布 acceptance 是独立且更严格的合同，
每个 exact configuration × scenario 少于 50 个独立 Session 时同样必须是
`INSUFFICIENT_SAMPLE`，并且还要满足首次工具/E2E Wilson 门和四项零安全失败。

#### `militaryPrivateSkills`

读取 `MilitaryKnowledgeCenterProjection`：operation 状态、sanitized pipeline、
lineage 和 recall simulation。除既有来源/提炼/审批/晋升/撤回动作外，
`SIMULATE_RECALL` 接收任务文本与 state token budget；返回 exact Skill、rank、
入选/排除原因和 delivery block。服务不创建 Task、不调用模型，并只持久化
输入 hash 与字符数。

#### `militaryEvaluationCenter`

`snapshot` 返回 durable Job、immutable Report revision、Appeal、最新完整报告以及
Host Workspace/Mission 目录。动作：

```text
GET_REPORT
GET_DATASET
CANCEL_RUN
RETRY_RUN
SUBMIT_APPEAL
WITHDRAW_APPEAL
DENY_APPEAL
RECOMPUTE_AND_SUPERSEDE
```

创建新评估仍由 Settings 的结构化 `PerformanceEvaluationRequest` 触发。
`GET_DATASET` 在返回前重新验证 frozen manifest；`RETRY_RUN` 只接受 `FAILED`
Job 并复用已完成 exact-configuration shard；申诉重算只接受 Host 验证的
excluded Attempt，产生新 Dataset/Report 和 superseding link，不修改旧 Artifact。

#### 共同安全规则

- 所有 action 在 Host 重新解析、限长和校验判别字段；
- `AbortSignal` 在昂贵读取和执行边界传播；
- 读取 projection 不能推进 Mission/Task/Skill lifecycle；
- Client 传入的 actor、tenant、authority、绝对路径、receipt、hash 和时间不
  具有权威性；
- 敏感正文、Secret、Raw Vault reference 和任意 SQLite row 不属于 wire 类型。


---

<a id="part-28"></a>

## Part 28：治理、命令修订与授权

源文件：`docs/28-governance-and-change-control.md`

### 1. 授权层级

1. **统帅授权**：用户原始需求、约束、外部动作许可；
2. **将军命令**：Mission Intent、Direction 批准、战略变更；
3. **参谋命令**：Wave/Task、战术指导、修正任务；
4. **Harness 判定**：冻结、验收、版本、权限和持久化；
5. **执行回报**：Worker/工兵提交 Candidate、Blocker 和 Evidence。

高层可以改变低层目标，但不能伪造已经发生的事实。

### 2. Mission Intent

必须明确：

- 用户要达到的结果；
- 价值与优先级；
- 硬约束；
- 可协商偏好；
- 禁止动作；
- 已知事实；
- 假设；
- 未知问题；
- 完成判据；
- 用户必须亲自批准的外部动作。

将军应向用户呈现影响目标的实质性解释，内部 Agent 数量和细节不必逐项打扰用户。

### 3. Change Order

任何以下变化形成版本化 Change Order：

- 用户目标、范围或约束；
- Direction outcome；
- Task objective；
- read/write/forbidden scope；
- Acceptance Contract；
- Environment baseline；
- 依赖；
- 数据分类或 API 权限；
- Git promotion 权限。

Change Order 必须包含：

```yaml
reason:
requestedBy:
affectedObjects:
oldVersion:
newVersion:
impact:
  runningAgents:
  acceptedResults:
  specs:
  budget:
  schedule:
disposition:
  cancel:
  stale:
  reverify:
  grandfather:
userAuthorizationRef:
```

### 4. 验收标准冻结

Wave 进入后：

- Worker 不能改；
- 参谋不能无痕改；
- Verifier 不能为了让结果通过而降低标准；
- 将军变更必须形成 Change Order；
- Task Version 增加；
- 活动 Candidate 变 stale；
- 已接受结果是否重验由影响分析决定。

### 5. 用户覆盖

用户可以：

- 终止 Mission；
- 更改目标；
- 授权或撤回外部动作；
- 手动接受已知风险；
- 要求重新验证；
- 替换参谋或模型；
- 查看审计记录。

用户手动接受风险仍须记录：

- 哪条验收未通过；
- 已知后果；
- 影响范围；
- 授权时间；
- 是否永久或仅本次。

不得把“用户说继续”解释为永久放宽所有未来任务。

### 6. 参谋治理

Advisor Profile 的新增、修改、禁用有 revision。高敏感权限变更应要求：

- 用户或管理员批准；
- 新增权限 diff；
- 凭据引用验证；
- 最小权限分析；
- 一次 canary task；
- 审计事件。

参谋的经验/描述不应自动扩大权限。

### 7. 战术治理

Tactical Museum 可以提出新版本，不能独立把其标记为 STABLE。晋级至少需要：

- schema/状态机验证；
- 安全审查；
- 仿真；
- Canary；
- 最低样本量；
- 效能与负面影响；
- 回滚可用；
- 指定批准角色。

### 8. 决策记录

以下决策必须进入 Decision Ledger：

- Direction 批准或取消；
- 关键技术选型；
- 手动验收覆盖；
- 高风险战术晋级；
- Promotion Order；
- 模型 fallback 导致能力变化；
- Verifier 替换；
- 数据保留例外；
- 重大冻结和释放。

每条决策引用来源事件和 Artifact。

### 0.2.0 治理扩展

- system preset `military` 的文件更新产生新 generation，不迁移旧会话；
- Tag rename/pause/delete 是 revisioned administrative change；
- Tactical Extraction 需要 user review，不能由 Museum 或 Chief 单独批准；
- Agent Template 变更创建 Canary/Active revision；安全撤权可即时收紧；
- Performance recommendation 只能提出 Canary Change Order；
- 绩效报告撤回和修订必须保留旧报告 hash、原因和替代报告引用。

### 0.3.0：权威上下文与变更类型

每个治理动作记录 Principal、Tenant、Authority Context、Authorization Receipt、expected revision、数据分类和 expiry。Agent persona、职位或“General”名称不授予权限。

新增受控变更：

- preset generation current/archive/retire；
- General Model Selection；
- Tool/Permission/API/Residency/Verifier/Model Profile revision；
- Workspace Integration；
- Tactical Source revoke；
- Evaluation dataset/report revision；
- Budget increase；
- Bundle install/upgrade/rollback/uninstall；
- terminology presentation change。

破坏性契约、Event Payload、database migration 或 preset capability 变化必须有 ADR、Migration Order、Golden Trace 和 RC.2 Fixture。已归档事实不可被新配置追溯改写。


---

<a id="part-29"></a>

## Part 29：模型路由与 Thinking 策略

源文件：`docs/29-model-routing-and-reasoning-policy.md`

### 1. 目标

本版 `dsh-military` 以任务成功率优先，不再以关闭 Worker Thinking 节省成本为核心。仍不能简单地对所有角色固定 `max`，因为推理预算需要与：

- 任务风险；
- 语义复杂度；
- 验收歧义；
- 上下文规模；
- 工具能力；
- 历史通过率；
- 延迟预算；

共同匹配。

### 2. 角色默认策略

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

### 3. Task-to-Reasoning Policy

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

### 4. 路由决策数据

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

### 5. 强制与审计

- Agent Scope 的 `agent/request` policy 写入候选 reasoning；
- LLM adapter materialize effective value；
- DSH `request/header` 是审计真源；
- Oversight 对角色规则和有效值对账；
- 任何非法降级在请求前拒绝；
- 任务记录 `provider/model/reasoning`，用于效能分析。

Prompt 中写“请认真思考”不构成策略。

### 6. Fallback

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

### 7. 上下文策略

Worker 应接收最小充分 Task Context，而不是完整 Mission 历史。上下文分为：

- immutable order；
- accepted facts；
- required specs；
- artifact refs；
- tactical directive；
- environment snapshot；
- recent observations。

参谋和将军可看到更宽投影，但仍不应读取所有原始推理 Token。以事件、Artifact 和已认证摘要交流。

### 8. 评测

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

### 0.2.0 Template 与上下文策略

非 General 角色的路由策略从 `AgentTemplateProfile` 解析。每个实例持久记录 template revision、effective provider/model/reasoning 和 fallback 事实。

上下文策略按角色配置 budget 与 trigger。达到阈值时发起一次安全 compaction attempt；如果模型 context window 小于模板预算，使用解析后的更小 effective budget。详情见[部门 Agent 模板与上下文策略](docs/34-department-agent-templates-and-context-policy.md)。

新增角色默认：

| 角色 | 默认 reasoning |
|---|---|
| Chief of Staff | high/max |
| Evaluation Examiner | high |
| Evaluation Chair | high/max |

委员会模型应与被评估模板分离并记录 rubric version。

### 0.3.0：General 与子代理路由优先级

#### General

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

#### 子代理

子代理 route 来自 `AgentTemplateProfile@revision`，创建时冻结。它们：

- 不读取 General 的 Session override；
- 不因设置保存而热切；
- fallback 只允许模板明确列出且满足同等政策；
- 重新派生 Agent 才能使用新 revision；
- 评估按 template revision + provider/model/reasoning 分组。

#### Context 与 Compaction

Context budget 是 Military policy，不直接等同于模型 catalog context window。有效预算取：

```text
min(template/preset budget, resolved model context, deployment safety cap)
```

达到 trigger 必须创建可审计 `CompactionAttempt`。无安全区间或摘要不缩小则暂停/handoff，不能继续溢出。General 切换到更小上下文模型前应先评估当前 surface；无法安全适配则拒绝切换。

### 0.9.0-alpha.28 能力目录与样本纪律

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


---

<a id="part-30"></a>

## Part 30：失败恢复、幂等与混沌测试

源文件：`docs/30-failure-recovery-and-chaos.md`

### 1. 恢复模型

`dsh-military` 采用事件驱动 Saga，而不是跨模型、数据库、Git 和工具的分布式事务。

每个有副作用的步骤必须：

- 先建立 intent/lease；
- 执行外部动作；
- 写入可验证 receipt；
- 完成状态迁移；
- 崩溃后可判断“未执行、已执行或未知”。

未知不能被当成成功。

### 2. 关键崩溃窗口

| 窗口 | 恢复 |
|---|---|
| Task lease 后、Agent 创建前 | lease 超时，重新派发 |
| Agent 工具执行后、tool/result 前 | 检查外部幂等键/Artifact；标为 UNKNOWN_EFFECT |
| Candidate 写入后、Verifier 前 | 重启 Verifier |
| Verifier 通过后、accept event 前 | receipt 幂等重放，CAS 接受 |
| Guidance 生成后、投递前 | 按 guidanceId 重投 |
| Guidance 投递后、ack 前 | at-least-once 投递，Worker 去重 |
| specs 文件写后、Git commit 前 | 工兵恢复并验证 change-set |
| Git commit 后、ledger receipt 前 | 通过 commit hash 对账并补记 |
| compaction end 后、evaluation 前 | compactionId 扫描补任务 |
| Tactical version 发布后、catalog invalidation 前 | Provider generation 对账 |

### 3. Agent 崩溃

- 保存 Session 和最后 Agent Status；
- 取消或过期 lease；
- 检查工作区副作用；
- 原 Agent 可冷恢复时仍需重新验证 Task Version；
- 无法证明执行边界时创建 Recovery Task；
- 新 Worker 不继承旧 Worker 的自由文本“完成度”，只继承已记录证据。

### 4. 网络与 Provider 故障

- Radio 与 Ledger 操作使用 bounded retry + idempotency；
- 模型请求错误与任务失败分离；
- API 超时不自动证明未产生副作用；
- Git 远端写只能由 Promotion Order 路径处理；
- 高风险企业 API 使用请求幂等键或 read-after-write 验证。

### 5. 死锁

资源锁使用全局稳定排序：

```text
workspace → repository → path-set → API-resource
```

禁止 Agent 自行持锁跨 Turn。Harness lease 有上限。检测到等待环后：

1. 冻结相关新派发；
2. 取消最低优先级未执行 Task；
3. 保留已产生 Artifact；
4. 参谋重新分解写集合；
5. 记录 deadlock graph。

### 6. 混沌测试矩阵

注入点：

- Ledger append 前/后；
- Artifact 写一半；
- Radio lease 丢失；
- Advisor 超时；
- Worker Session dispose；
- Verifier 进程崩溃；
- Git hook 拒绝；
- 磁盘满；
- DSH HMR 卸载 Adapter；
- Compaction orphan；
- Web Client 断线和乱序；
- stale Task Version 并发提交；
- Credential provider 暂时不可用；
- 工具忽略 cancellation。

每个注入测试验证：

- 不错误接受；
- 不丢失不可变事实；
- 不重复外部副作用；
- 可重放；
- 恢复后权限不扩大；
- 用户可得到明确状态。

### 7. 恢复状态

任务恢复结果只有：

```text
RESUMABLE
REPLACE_AGENT
REVERIFY
UNKNOWN_EFFECT
MANUAL_RECONCILIATION
CANCELLED
```

禁止用模糊的 `FAILED` 隐藏是否发生了副作用。

### 0.2.0 故障注入

- preset 文件在两个新会话创建之间被修改；
- child creation 时 parent preset generation 被删除；
- Host listener 同时接收 Military 和 Standard Session Event；
- Tag 在 extraction Job 中途被 pause/rename/delete；
- source session 在 Candidate 审阅前被追加新事件；
- context threshold 连续跨越，compaction 返回 null；
- pending ask-user 时 General 被取消或 compaction；
- Chief Advice 生成后 Task Version 改变；
- Evaluation Dataset 构建中 Session 被保留策略删除；
- Examiner 第 N 个模板失败，Chair 不应读取未验证分片。

### 0.3.0：新增故障窗口

#### Preset generation

- manifest 写入完成但 archive 不完整；
- current 指针更新但 profile 未提交；
- 重启后旧 Session generation 丢失；
- asset hash 与 manifest 不匹配。

处置：内容寻址 temp → fsync → rename；current 指针最后更新；恢复时 quarantine，不回退 current。

#### Workspace/Integration

- Worker 完成但 Candidate Patch 未落盘；
- Patch 落盘但 Candidate Event 失败；
- Integration 应用一半；
- Git commit 成功但 Receipt 失败；
- 外部 Session 在集成前修改同一文件。

处置：隔离 worktree、Patch hash、intent、commit trailer、recovery scan、global regression 和 conflict task。

#### Decision Broker

- 问题已展示但浏览器断开；
- 两个标签页同时回答；
- 答案提交时 Task Version 已变化；
- General compaction/重启期间问题待定。

处置：durable broker、CAS、first-commit-wins、STALE、resume projection。

#### Storage/outbox

- Event 已提交但 projection/outbox 未处理；
- Artifact 文件存在但 metadata 未提交；
- Artifact metadata 已提交但 Reference Index 未提交；
- active/retained Artifact metadata 存在但 Blob 丢失；
- Radio lease holder 崩溃；
- Evaluation dataset 读取中断。

处置：幂等 consumer、checkpoint、metadata-authoritative index rebuild、
orphan sweep、active Blob 完整性 fail-closed、visibility timeout 和 immutable
dataset shard。

#### Performance Evaluation

- Request 已入队但进程在 Session discovery 前退出；
- canonical Dataset Artifact 已写、SQLite pointer 尚未提交；
- 第 N 个 exact-configuration shard 失败；
- Job 超过 wall-clock budget；
- lease holder 崩溃后陈旧 worker 继续完成；
- Report 已构建但 Request/Dataset/Schema hash 校验失败；
- appeal resolution 已写、superseding recompute 中断；
- committee model 超时、返回额外字段或无效 Evidence；
- Settings 仍含旧版 `lastReportJson`；
- Provider 价格目录缺失。

处置：

```text
SQLite revision + lease + fence
canonical Frozen Dataset Artifact
idempotent shard key
structured FAILED { code, message, failedAt, retryable }
retry only missing shards
publish only after all invariants
immutable old Report + superseding revision
deterministic narrative fallback
lastReportId pointer; legacy JSON cleared after success
unknown cost = unavailable
```

超时或 retryable failure 不删除 Dataset 和成功 shard。重启执行者重新取得新 fence，
验证已持久化 shard 的 configuration/dataset key，只计算缺失分片。陈旧执行者无法
完成。取消保持 `CANCELLED`；用户取消 Session、Provider failure 和系统 crash 在
Attempt missingness 中分别归因。

#### Budget

- reservation 后执行者崩溃；
- usage receipt 重复；
- 价格表缺失；
- 全局与 Mission 余额竞态。

处置：lease expiry、usage id 去重、非货币配额、事务 CAS。

所有故障注入必须得到有限终态：`RECOVERED/PAUSED/QUARANTINED/CANCELLED/FAILED`，不得停留在未知“可能已完成”。

### 0.9.0-alpha.28 Command Saga 恢复合同

Mission command 的外部 operation 具有稳定 idempotency key 和 durable state：

```text
PENDING_EFFECT
├─ effect failure/crash before checkpoint → RETRYABLE
├─ valid active lease                    → wait / RESOURCE_LOCKED
└─ result checkpoint                     → EFFECT_APPLIED → COMMITTED
```

恢复调用必须提交原语义 command；Host 校验 semantic fingerprint、tenant、
Mission、payload hash 和 idempotency key。`EFFECT_APPLIED` 不重跑 effect，
只补 command receipt/outbox；`RETRYABLE` 只能调用同一可查询/幂等 operation。
Operations health 公开 state 计数、过期 lease 和最老年龄，但不显示可能含秘密的
Provider 错误正文，也不会凭 UI 猜测副作用。

故障注入覆盖：

- admission commit 后、effect 前崩溃；
- effect 报错并进入 RETRYABLE；
- effect 成功后、checkpoint 前中止；
- EFFECT_APPLIED 后、receipt/outbox 前崩溃；
- finalization CAS 丢失；
- 同 idempotency key 使用不同 authority/semantic payload；
- async SQLite transaction callback 的同步前缀 rollback。

### 0.9.0-alpha.28 控制中心恢复合同

浏览器恢复流程是三步协议：

```text
authoritative snapshot
→ PREVIEW_RECOVERY(operation, scope)
→ EXECUTE_RECOVERY(operationId, exact confirmation phrase)
```

执行前 Host 重算预览；预览漂移、确认短语错误、operationId 与不同 payload
复用、权限过期或 postcondition 无法证明都会失败关闭。成功/失败 receipt 均写入
SQLite，重启后同 ID 返回原结果。

专项故障注入包括：

- 数据库验证/备份期间取消；
- `VACUUM INTO` 临时目标存在或写失败；
- reconcile 在 Git commit 与 receipt 窗口崩溃；
- stale outbox 重投与正常 consumer 竞态；
- 过期 lease/claim 释放与 live owner 续租竞态；
- 子报告持久化后、父 wake/steer 前崩溃；
- Workspace catalog 生成后 root 被删除、替换或变为 symlink；
- Provider Session 评估读取不完整 event；
- Evaluation 第 N 个分片失败后进程重启，只补缺失分片；
- wall-clock timeout 后保留 Dataset/hash 与已完成分片；
- stale evaluation lease/fence 试图覆盖新 Report；
- committee narrative 返回无效 JSON，确定性报告仍完成；
- appeal recompute 在新 Dataset 与 Report 提交之间崩溃；
- recall simulation 写入前后崩溃。

恢复 UI 只触发这些受治理操作；没有原始 SQL、任意路径删除、Git reset、手工
Task 完成或 capability 状态覆盖入口。

“插件与 Preset”健康项把运行 Bundle 版本与 content-addressed preset
generation 分开显示。相同 preset bytes 可以由后续 Host-only Bundle 继续使用；
generation 的首个归档版本保持不可变，当前性由 archive `current.json` 指针和
exact DSH commit 决定，不能把历史 manifest 中曾经的 `CURRENT` 字样误当作当前
指针，也不能把归档起始版本误显示成正在运行的 Bundle 版本。


---

<a id="part-31"></a>

## Part 31：实现蓝图

源文件：`docs/31-implementation-blueprint.md`

### 1. 第一个可运行切片

```text
Fixed military preset assets
Profile installer preserving existing preset roots
Actual-preset Session Gate
InMemory Mission/Admin Ledgers
LocalArtifactStore
MilitaryRuntime
One General
One Worker
StaticTaskOrder
CommandVerifier
CompletionInterlock
Session event mirror
One Standard sibling session fixture
```

第一条测试先证明 Standard sibling Session 看不到任何 Military 模型表面或控制副作用，再证明 Candidate 验收闭环。先不要实现多参谋、博物馆和完整 WebUI。

### 2. Runtime 主循环

```ts
async function runWave(waveId: WaveId): Promise<void> {
  while (true) {
    const wave = await ledger.readWave(waveId)

    if (wave.state === 'FAILED' || wave.state === 'CANCELLED') return
    if (waveBarrierSatisfied(wave)) {
      await closeWave(wave)
      return
    }

    const capacity = await capacityModel.available(wave)
    const tasks = scheduler.selectReady(wave, capacity)

    for (const task of tasks) {
      await dispatchTask(task)
    }

    await eventClock.waitForRelevantChange(waveId)
  }
}
```

`waitForRelevantChange` 由事件唤醒，不以模型轮询数据库。

### 3. Worker 创建

```ts
const handle = await ctx.agents.create({
  sessionId: makeWorkerSessionId(task),
  meta: {
    cwd: workspace.path,
    parentSession: general.id,
    delegationDepth: 1,
  },
  agentOptions: {
    provider: route.provider,
    model: route.model,
    maxTokens: route.maxTokens,
  },
  setup: async (agentCtx) => {
    installWorkerPersona(agentCtx, identity)
    installWorkerToolRestriction(agentCtx, task)
    installReasoningPolicy(agentCtx, { minimum: 'low', preferred: 'high' })
    installFreezeAdmission(agentCtx, task.id)
    installMilitarySessionProjection(agentCtx, task)
  },
})
```

Agent Handle 由 `MilitaryRuntime` 保存，模型无权销毁或创建兄弟 Agent。

### 4. Candidate Tool

```ts
const submitCandidate = defineTool({
  name: 'military_submit_candidate',
  // schema omitted
  async execute(args, exec) {
    const agent = requireMilitaryAgent(exec.agent)
    const receipt = await military.proposeCandidate(agent.identity, args)
    exec.concludeTurn()
    return receipt
  },
})
```

`concludeTurn()` 只结束模型 Turn，不代表接受。接受发生在外置 Verification。

### 5. 完成联锁

```text
candidate received
  → identity/task/version check
  → declared tool calls vs durable tool events
  → Artifact hash check
  → scope/write audit
  → acceptance clause coverage
  → deterministic verifiers
  → optional read-only inspector
  → aggregate decision
  → CAS accept/rework/freeze
```

Inspector 输出不能直接覆盖确定性失败。

### 6. 参谋会商

```text
eligibilityFilter(context, advisorProfiles)
  → independently ask eligible advisors
  → collect structured recommendations
  → coverageOptimizer selects lead + consults
  → lead synthesizes Direction/Wave/Directive
  → plan validator
  → General ratification
```

独立研判阶段不向后续参谋展示前一个参谋的答案，减少锚定。

### 7. 电台

```ts
requestGuidance(request):
  validate schema
  authorize identity
  attach harness evidence
  escalationGate
  dedupe
  enqueue
  emit radio/requested

advisor worker:
  lease request
  retrieve 3..5 tactics
  synthesize one directive
  validate expectedTaskVersion
  persist guidance
  broker deliver
  ack
```

### 8. 工兵 Git

```text
inspect repo
if no .git:
  git init -b main
ensure controlled local-main worktree
apply specs order within allowlist
validate specs
git status --porcelain
git add -- specs/ allowed metadata
git commit -m "docs(specs): ..."
record commit hash + tree hash
never push
```

所有命令由受限 Git Provider 生成，不让工兵自由拼接任意 Git shell。

### 9. Compaction Hook

```text
observe main session compaction/end(success)
  → dedupe by compactionId
  → build deterministic effectiveness dataset
  → run Effectiveness Agent
  → verify cited task/skill ids
  → append assessment
  → optionally schedule Museum research
```

### 10. UI

- Settings：Advisor Profiles、Tactical Registry、Oversight、Specs/Git、Model Policy；
- Conversation Nodes：Mission、Wave、Task、Candidate、Radio、Freeze、Specs Commit、Memory；
- Dedicated dashboard 后置；
- UI command 使用 expected revision；
- Client 不可直接调用 Provider 数据库。

### 11. 首批测试

```text
task version race
candidate without tools
candidate with forged tool list
verifier crash and replay
worker tries to write specs
engineer tries git push
stale guidance
duplicate compaction evaluation
advisor with revoked API grant
frozen agent receives followup
wave barrier with one missing specs commit
```

### 12. 完成定义

MVP 的“完成”不是 UI 可展示多个 Agent，而是：

- 可重放；
- 可冻结；
- 可拒绝；
- 可恢复；
- 可证明；
- 可在本地 main 留下 specs commit；
- 不把模型自报当成事实。

### 0.2.0 实现增量顺序

```text
A. Preset asset package + complete roster profile installer
B. Fixed military preset + actual-preset guard
C. Session binding + sibling-session isolation tests
D. Mission/Admin ledgers + one Worker verification loop
E. Agent Template registry + per-child context policy
F. /brainstorm + General-owned ask-user
G. Tactical Sufficiency Gate + Chief fallback
H. Tag registry + ingestion candidate review
I. Evaluation dataset + one Examiner + Chair
J. Full Web settings and reports
```

#### 子代理创建补充

```ts
setup: async childCtx => {
  const preset = ctx.agentPresets.composeFrom(childCtx, general.ctx)
  if (preset !== 'military') throw new Error('MILITARY_PRESET_REQUIRED')
  installRoleTemplate(childCtx, templateSnapshot)
  installContextPolicy(childCtx, templateSnapshot.contextPolicy)
  installTaskBinding(childCtx, task)
}
```

#### Listener 补充

```ts
ctx.on('session/event', async (session, event) => {
  if (await resolveSessionPreset(session) !== 'military') return
  await militaryProjection.fold(session, event)
})
```

#### 评估补充

Evaluation Run 首先冻结 dataset hash，再按 template revision 分片。Chair 只能读取状态为 VALID/INSUFFICIENT_DATA 的已验证 individual report。

### 0.3.0：首个完整可运行切片

推荐首个切片不直接实现多参谋，而先闭合以下链路：

```text
RC.2 Host + Web Fixture
→ install military preset + generation archive
→ create Military Session
→ General uses preset default model
→ user switches General model
→ create Worker from frozen template
→ isolated worktree
→ Task Order + Acceptance Contract
→ Candidate Patch
→ deterministic Verify
→ Integration Order
→ apply to local main + global regression
→ Integration Receipt + specs receipt
→ process restart
→ exact generation resume
→ Standard sibling Session remains unaffected
```

#### 关键伪代码

```ts
const binding = await presetGenerations.bindNewMilitarySession(session, currentManifest)
const generalRoute = await generalRouting.resolve({
  binding,
  explicitSessionSelection: sessionModelSelection,
  policy: presetGeneralPolicy,
  authority,
})

const agentBinding = await agentBindings.createFromTemplate({
  task, templateRevision, presetGeneration: binding.presetGeneration, authority,
})
const reservation = await budgets.reserveForTask(task, agentBinding)
const attempt = await workspaces.createAttempt(task, agentBinding)
const candidate = await workerRuntime.run(attempt)
const verification = await verification.verify(candidate)
if (verification.disposition !== 'ACCEPTED') return rework(candidate, verification)

const order = await integration.enqueue(candidate, verification)
const receipt = await integration.applyToLocalMain(order)
await specs.recordAcceptedChange(receipt)
await budgets.settleFromAcceptedAttempt(reservation, candidate, verification, receipt)
```

#### 不能走的捷径

- Worker 直接编辑共享 cwd；
- Candidate accepted 后直接由模型运行 `git commit`；
- 只存 `presetId=military` 而不存 generation；
- General 模型切换向所有 child 广播；
- 开放 Event payload；
- 用 Session ID 代替 Authority Context；
- 跨 DB/Git/Artifact 假装原子提交；
- 先做 Dashboard，再补 durable projection。

#### 推荐测试顺序

1. Contract generator/parity；
2. preset hash/archive；
3. RC.2 preset isolation；
4. General route override；
5. child AgentExecutionBinding；
6. budget reservation/settlement；
7. workspace/patch；
8. verifier/integration；
9. crash recovery；
10. generation restart/Resume Receipt；
11. WebUI projection。


---

<a id="part-32"></a>

## Part 32：固定 `military` Preset 与会话隔离

源文件：`docs/32-military-preset-and-session-isolation.md`

### 1. 决策

`dsh-military` 不实现可在运行中热切换的“模式开关”。Bundle 随安装包交付一个固定、独立、只读的 system preset：

```text
preset id: military
显示名称: Military 模式
```

用户在 DSH WebUI 的**新建会话**界面，通过 agent preset chip 手动选择 `military`。该选择在会话创建和组装时生效，并在会话开始产生内容后锁定。只有实际组装到 `military` preset 的会话，才能获得 General persona、Military 工具、命令、监听器、子代理编排和 Mission 投影。

这项决策复用 DSH 原生 agent preset 机制，不在 composer 中维护第二套真假难辨的布尔状态。

### 2. 为什么不是运行时开关

Preset 决定模型请求中的系统提示词、工具 Schema、技能目录和监听器。会话已经使用某个工具集产生历史后再更换，会出现以下不可重放状态：

- 历史中存在新 preset 无法执行的工具调用；
- 同一会话前后使用不同安全和审批边界；
- 恢复会话时无法判断应加载哪一代插件组合；
- KV Cache、压缩摘要和工具结果的语义前缀发生改变；
- 用户以为关闭了 Military，实际上旧监听器仍在处理任务。

因此，Military 能力是创建期组合事实，不是每轮请求的偏好设置。

### 3. WebUI 用户体验

#### 3.1 新建会话

新建会话界面显示 DSH 原生 preset chip。选项中新增：

```yaml
id: military
name: Military 模式
description: 验证驱动的多代理指挥、参谋、执行、督战、specs 与战术学习工作流。
```

选择值只作用于**下一个空白会话**。会话创建后，暂存选择被消费，下一次新建会话重新使用部署默认 preset，除非用户再次选择 `military`。

#### 3.2 已开始会话

会话出现第一条有效输出、工具事件或其他产出后，preset 不再可编辑。标题旁显示只读标签：

```text
Military 模式
```

任何试图把已开始会话切入或切出 `military` 的请求都必须返回 `agent-preset-locked`，不能排队等待未来切换。

#### 3.3 管理平面与会话能力的区别

安装 Bundle 后，用户仍可在设置页管理参谋模板、战术标签和绩效报告。这些是宿主的**管理平面**，不进入普通会话的模型上下文。

未选择 `military` 的会话必须满足：

- 看不到任何 Military 工具 Schema；
- 看不到任何 Military system prompt；
- 不注册 `/brainstorm`；
- 不产生 Mission、Wave、Radio、Freeze 等 Military 会话事件；
- 不创建 Military 子代理；
- 不被 Military Completion Interlock 拦截；
- 不被 Military Workspace 锁阻塞；
- 不被 Military 自动压缩策略处理；
- 不被计入 Military 绩效样本。

### 4. Preset 目录

随 Bundle 交付的参考目录为：

```text
agent-presets/
└── military/
    ├── preset.yml
    └── agent.cordis.yml
```

参考文件位于：

- [`reference/preset/agent-presets/military/preset.yml`](reference/preset/agent-presets/military/preset.yml)
- [`reference/preset/agent-presets/military/agent.cordis.yml`](reference/preset/agent-presets/military/agent.cordis.yml)
- [`reference/preset/package.example.json`](reference/preset/package.example.json)

`preset.yml` 只描述显示元数据；`agent.cordis.yml` 是 Agent Plane 组合。

#### 4.1 system root 安装适配

DSH 的 preset roster 通过 `@deepseek-ai/dsh-agent-presets` 的启动配置读取 `roots`。该列表不是一个可由第三方插件运行时随意追加的动态注册表。因此 `dsh-military` 的安装不能只“挂一个插件行并等待 WebUI 自动发现”。

推荐交付一个独立资产包：

```text
@your-org/dsh-military-preset/
└── agent-presets/
    └── military/
        ├── preset.yml
        └── agent.cordis.yml
```

Bundle 的安装器或 profile 生成器负责解析该资产包的绝对路径，并修改目标 profile 中**已有的** `agent-presets` row。由于 DSH patch 对一个 row 的 `config` 采用整对象替换，生成的 overlay 必须重述：

```yaml
default: <部署原值>
roots:
  - <部署已有的全部 system roots>
  - path: <已解析的 military agent-presets 根目录>
    trust: system
includeUserRoot: <部署原值>
```

禁止：

- 插入第二个 `@deepseek-ai/dsh-agent-presets` 服务；
- 只写 Military root 而覆盖掉 `standard/code/minimal/cordis`；
- 安装时强行把部署默认 preset 改为 `military`；
- 使用未解析的相对路径并依赖进程 cwd；
- 把随包资产标记为可写 `user` root。

参考 overlay 见 [`examples/preset/agent-presets-profile-overlay.example.yml`](examples/preset/agent-presets-profile-overlay.example.yml)。安装后必须通过 `agentPreset.list`/WebUI roster 验证 `military` 为健康 system preset；损坏时 fail closed，不创建半组装 Session。

### 5. Host Plane 与 Preset Plane

为了同时做到可管理和不干扰普通会话，组件分成两个平面。

#### 5.1 Host Plane

Host Plane 可以常驻，但不得直接向模型贡献提示词或工具：

- Mission Ledger、Artifact Store、Radio Store；
- Advisor、Agent Template、Tag、Tactical Skill 注册表；
- Evaluation Job 和报告存储；
- Settings namespace 与 Web RPC；
- Credential/API Gateway；
- system preset 根目录注册。

这些服务必须按 Session、Mission、Job 或用户租户键控，不得把“当前会话”保存在进程级可变单例中。

#### 5.2 Military Preset Plane

只有 `military` standing scope 挂载：

- General persona 与 General system prompt；
- Military 模型工具和 `/brainstorm` 命令；
- General 的 Completion/Decision 交互策略；
- Military 会话事件投影；
- General 的 compaction 与上下文策略；
- 子代理创建入口和角色工具消费者。

Agent 视图按以下作用域解析：

```text
agent scope → military preset standing scope → global host scope
```

普通 preset 的 sibling standing scope 不会看到 Military 注册。

### 6. 双重准入

Preset scope 是第一层能力隔离，所有关键入口仍需要第二层防御性检查。

```ts
function requireMilitaryAgent(agent: Agent): MilitarySessionBinding {
  const preset = ctx.agentPresets.composedPreset(agent.ctx)
  if (preset !== 'military') throw new MilitaryError('MILITARY_PRESET_REQUIRED')
  return militarySessions.requireBinding(agent.id)
}
```

冷读持久会话时，应使用 DSH 的实际 preset 解析结果，而不是部署默认值。不得依据工作目录、标题、模型名或某个曾经出现的 Military 文本推断启用状态。

### 7. 子代理继承

General 创建 Worker、Engineer、Advisor、Chief of Staff、Inspector 或 Evaluation 子代理时，必须在未发布的 `setup(agentCtx)` 窗口中：

1. 调用 `ctx.agentPresets.composeFrom(childCtx, general.ctx)`；
2. 验证返回的 preset id 为 `military`；
3. 再安装角色 persona、工具限制、模型策略和 Task Binding；
4. 任何步骤失败都回滚整个创建事务。

不得让子代理重新按字符串 `military` 调用 `mount()`。重新解析可能让子代理进入被编辑后的另一代 preset，而父会话仍运行旧代组合。

### 8. `MilitarySessionBinding`

每个 Military 根会话在开始时写入一条可重放绑定事实：

```yaml
schemaVersion: 1.0.0
sessionId: session-military-001
presetId: military
presetGeneration: military@sha256:...
rootAgentId: session-military-001
activatedAt: 2026-08-18T01:00:00Z
workspaceKey: workspace:sha256:...
```

机器契约见 [`military-session-binding.schema.json`](schemas/military-session-binding.schema.json)。绑定不可被普通模型修改；会话恢复必须验证实际 preset 与绑定一致。

### 9. 同工作区多会话隔离

相同 `cwd` 不代表相同 Military Run。所有内部键至少包含：

```text
tenantId + rootSessionId + missionId
```

Worker、Task、Radio、Freeze、Context Budget、Compaction、Metric 和 Artifact 不能只按工作区路径索引。

#### 9.1 普通会话不受 Military 锁干扰

Military Workspace 锁只协调本 Mission 管理的 Worker/Engineer。它不得向全局 DSH 文件工具安装会阻塞普通 preset 的锁。

如果普通会话或外部进程同时修改相同文件，Military 应：

- 通过基线哈希、Git tree 或文件版本检测外部变化；
- 将 Candidate 标记为环境漂移；
- 暂停、重新读取或要求用户决策；
- 绝不冻结、取消或修改普通会话。

“互不干扰”是插件控制面的隔离，不承诺两个独立进程编辑同一文件永远无冲突。

#### 9.2 监听器准入

所有 Host 级监听器使用统一判定：

```text
session event arrives
→ resolve actual session preset
→ preset != military: immediate return
→ preset == military: resolve binding and continue
```

不能使用模块级 `militaryEnabled = true`。

### 10. 状态与恢复

```text
UNBOUND
  → BINDING
  → ACTIVE
  → CLOSING
  → CLOSED

BINDING failure → UNBOUND with no partial Military surface
ACTIVE mismatch → QUARANTINED, fail closed
```

恢复时必须校验：

- preset id 与 generation；
- root/child lineage；
- Agent Template revision；
- Workspace 和 Mission Binding；
- 未关闭 Freeze、Radio lease 和 Evaluation Job。

### 11. 设置变更的影响

修改参谋或子代理模板不改变已经创建的 Agent。每个子代理实例记录其模板 revision 和 effective model policy；新实例使用新 revision。已运行的根会话仍使用它创建时加入的 preset generation。

### 12. 测试矩阵

| 场景 | 预期 |
|---|---|
| 新会话选择 `military` | Military 工具、命令和标签可见 |
| 新会话选择 `standard` | Military 模型表面为空 |
| 会话 A 为 Military、B 为 Standard | A 的事件不能改变 B 的 Inbox/Tool/Compaction |
| 两会话使用同一 cwd | 内部 Mission/Task/Radio 状态不串扰 |
| Standard 会话修改 Military 正在读取的文件 | Military 检测 drift，不干预 Standard |
| 空白会话切换到 Military | 允许并记录 preset selection |
| 已产出会话切换 | `agent-preset-locked` |
| Military 子代理创建 | 继承父会话同一 preset generation |
| 子代理未 composeFrom | 创建回滚、无孤儿 Session |
| Host listener 收到普通会话事件 | 零 Military 写入 |
| 绩效扫描 | 只收录实际 preset 为 `military` 的会话 |

### 13. 验收条件

- `military` 出现在新建会话 preset roster；
- preset 文件损坏时显示 broken，不能创建半组装会话；
- 非 Military 会话的模型请求中不存在 Military prompt/tool schema；
- 非 Military 会话不会触发 Military completion、freeze 或 compaction；
- 所有 Military 子代理继承精确的父 preset generation；
- 断线、恢复和冷读可以重建会话的启用事实；
- 同工作区多会话压力测试中，Mission/Radio/Metric 的 key 零碰撞。

### 0.9.0-alpha.6：跨重启 generation 检测、隔离与迁移

DSH RC.2 的 preset ID 选…1403 tokens truncated…现必须在固定 RC.2 checkout 运行 E2E：
真实实现必须在固定 RC.2 checkout 运行 E2E：

恢复不能简单执行 `mount('military')`：

```text
Binding generation == current
  → MATCHED
Old standing scope still live in this process
  → ARCHIVE_REBOUND
Process restarted and root requires archived generation
  → QUARANTINED / MIGRATION_REQUIRED
Binding generation missing/incompatible
  → QUARANTINED
```

只有显式 `PresetMigrationOrder` 能把历史事实投影到新 Session；原 Session 历史不被改写。详见[Preset generation 升级与恢复](docs/38-preset-generation-upgrade-and-resume.md)。

### General model default

`military` preset 内置 General default provider/model，但允许当前根会话通过 DSH 原生模型选择器覆盖。此模型表面不是 preset 切换：

- actual preset 和 generation 不变；
- Military 工具/Prompt 不变；
- 只改变 General 后续请求；
- child template routes 不变；
- 不满足 reasoning、上下文、数据驻留或预算时拒绝。

因此同 cwd 的 Standard Session 仍完全独立，Military General 的模型切换也不会影响它。


---

<a id="part-33"></a>

## Part 33：外部内容战术提炼与标签治理

源文件：`docs/33-tactical-ingestion-and-tag-governance.md`

### 1. 目标

系统允许用户把以下材料显式提炼为私有战术：

- 过去的任意 DSH 会话或指定事件区间；
- 用户直接输入的长期从业经验、稀有经验和内部方法；
- 用户授权的文档、Artifact 或企业知识片段。

提炼不是自动训练，也不是把整段会话原样复制到 Skill。输出首先是一个带来源、风险和差异的 `TacticalExtractionCandidate`，必须经过用户审阅后，才能形成新的 `DRAFT` 战术版本或现有战术的补充版本。

### 1.1 当前源码实现

`0.9.0-alpha.28` 已把本章从目标设计落实为一条 Host-owned 供应链：

```text
Knowledge Center
  → RC.2 Typert trusted RPC
  → Raw Vault（原文）
  → Sanitized Artifact + Redaction/Injection receipt
  → 稳定 6000 字符 Chunk
  → 无工具 Flash JSON 提取
  → Host 证据聚合
  → 用户 Hash + Diff 审批
  → immutable DRAFT Skill snapshot
  → SIMULATION → CANARY → TESTING → STABLE
  → exact Task recall → Host tactic card → Usage/Result
  → Revocation → quarantine + impact report
```

来源正文只通过 RC.2 Typert RPC 穿过一次并直接写入独立 Raw Vault；不会写入
共享 Settings、Session 事件、浏览器投影、日志或操作回执。Settings 只保存
provider/model、输出预算、fallback、默认可见范围和保留期等策略。旧版本曾写入
Settings 的 action/snapshot 字段会在启动时迁移清除。

生产运行时只有一个 `TacticalIngestionRuntime`。Source、Job、Chunk、Candidate、
Review、Bundle、Promotion、Usage、Knowledge Source 和 Revocation 的状态与
幂等索引由同一个 `SqlitePrivateSkillRepository` 持久化；Raw Vault、脱敏
Artifact 和 Skill Bundle 使用物理分离的目录。中断后从最后一个已提交 Chunk
继续，已经完成的模型调用不会重复执行。

这里借鉴了 Claude 官方 Agent Skills 的文件组织和渐进式披露原则，但不是声称
DSH 使用 Claude Skills API。参考：

- [通过 API 使用 Agent Skills](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)；
- [Skill 编写最佳实践](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices)。

每个批准版本都会编译为完整目录快照：

```text
SKILL.md
references/procedure.md
examples/minimal.md
scripts/verify.mjs
bundle.snapshot.json
```

顶层 `SKILL.md` 只有有效的 `name`/`description`、适用性、最多八个紧凑步骤、
主要停止条件和验证要求；完整 Claim Evidence、权利、依赖和验证计划下沉到
一层 `references/`。Bundle 写入时校验 30 MiB 上限、500 行预算、正斜杠路径、
引用闭包、frontmatter 一致性和脚本可执行位；投放前再次核对每个文件的
byte length 与 SHA-256，磁盘篡改会使版本从 DSH Skill 目录消失。

### 2. 标签库

标签是用户管理的稳定领域实体，不以显示名称作为外键。

```yaml
tagId: tag-react
displayName: React
status: ACTIVE
aliases: [reactjs, react-frontend]
```

战术和提炼请求引用 `tagId`。重命名只改变显示名并保留旧名为 alias，因此不会重写历史 Skill、评估和会话来源。

### 3. 标签生命周期

| 状态 | 新匹配 | 新战术关联 | 历史读取 | 语义 |
|---|---:|---:|---:|---|
| `ACTIVE` | 允许 | 允许 | 允许 | 正常使用 |
| `PAUSED` | 禁止自动匹配 | 仅用户显式批准 | 允许 | 暂停投放，不破坏历史 |
| `DELETED` | 禁止 | 禁止 | 只读 | tombstone；不物理删除引用 |

用户操作：

- **新增**：创建新 `tagId`、名称、描述和匹配词；
- **暂停/恢复**：改变自动匹配和战术投放资格；
- **重命名**：保持 `tagId`，检查名称冲突，旧名称写入 alias；
- **删除**：写入 tombstone，阻止新关联；已有战术保留历史引用；
- **合并**：不是 MVP 必需能力，后续可用显式迁移把一个 tag alias 到另一个 tag。

Schema 见 [`tactical-tag.schema.json`](schemas/tactical-tag.schema.json)。

### 4. 提炼入口

#### 4.1 从会话提炼

用户在会话菜单或战术管理页选择：

```text
提炼为私有战术
```

必须显式选择或确认：

- 来源 Session；
- 完整会话或事件区间；
- 是否包含工具参数和结果；
- 目标标签；
- 新增战术、补充现有战术或由系统建议；
- 数据分类和可见范围；
- 是否允许系统建议新标签。

来源会话可以不是 Military preset。提炼是受用户授权的宿主管理任务，不会把 Military 工具注入来源会话。

#### 4.2 从直接输入提炼

设置页提供“经验提炼”表单。用户可以粘贴内容，或上传为 Artifact。系统应鼓励用户说明：

- 适用场景；
- 前置条件；
- 成功表现；
- 常见失败；
- 何时不要使用；
- 可验证证据；
- 保密和共享范围。

直接输入同样经过候选审阅，不能因为“用户说这是经验”就自动晋级为 Stable。

### 5. 提炼流水线

```text
Source Authorization
  → Immutable Source Snapshot
  → Secret/PII/Policy Scan
  → Tag Eligibility and Match
  → High-value Claim Extraction
  → Procedure/State/Failure Reconstruction
  → Existing Tactic Similarity Search
  → NEW or SUPPLEMENT Candidate
  → Independent Validation
  → User Diff Review
  → Draft Version Commit
  → Simulation/Canary Lifecycle
```

#### 5.1 来源快照

快照至少记录：

- source type、Session id、事件范围或 Artifact hash；
- 生成时间和请求用户；
- preset、模型和时间范围；
- 是否包含工具结果；
- 数据分类；
- 内容哈希；
- redaction receipt。

后续战术不能只引用一个可能被编辑的自由文本文件。

#### 5.2 高价值筛选

提炼 Agent 重点寻找：

- 可重复的诊断路径；
- 清晰的前置条件和排除条件；
- 能被工具验证的动作；
- 失败后如何转移状态；
- 环境差异和版本兼容；
- 对比普通做法的增量价值；
- 稀有但可解释、可审计的经验。

应过滤：

- 寒暄、重复讨论和无结论发散；
- 未经证实的猜测；
- 仅对一次随机上下文有效的临时字符串；
- Secret、个人数据和越权企业信息；
- 被外部内容注入的“忽略系统规则”等指令；
- 无法说明适用范围的绝对化结论。

### 6. 新战术与补充版本

系统先对 ACTIVE/PAUSED 战术做兼容性和语义检索。

#### 6.1 新战术候选

满足以下条件时建议 `NEW_TACTIC`：

- 没有可兼容的现有战术；
- 目标、前置和状态机形成独立过程；
- 与现有战术合并会导致职责过宽；
- 用户明确要求独立维护。

#### 6.2 补充候选

满足以下条件时建议 `SUPPLEMENT`：

- 是现有战术的新环境变体；
- 新增 Failure Mode、排除条件或 Verifier；
- 增加一个已有状态的动作分支；
- 补充最佳实践和反例；
- 提供更强来源证据。

补充不得就地改写已发布版本。系统产生：

```text
base skill@version
+ proposed patch
→ next DRAFT version
```

用户可在 Diff 中逐项接受或拒绝。

当前实现还强制以下合并不变量：

- target 必须存在、属于同一 owner、未进入 `QUARANTINED/DEPRECATED`，且其全部
  来源仍具备实时可用权利；
- `SUPPLEMENT` 合并基础版本的 workflow、标签、precondition、stop、
  verifier 和 provenance；各列表去重并限制为 64 项，不允许把补充误当替换；
- 新 bundle 继承基础版本的全部 `sourceSnapshotIds`，再加入本次来源；
- 审批、晋升、Task 召回和模型 pre-step 会检查整条来源谱系；任一继承来源撤回
  都隔离其派生补充版本并进入影响报告。

### 7. 标签匹配

匹配分两层：

1. **确定性层**：用户显式 tag、alias、技术栈字段、Skill metadata；
2. **语义层**：提炼 Agent 提出候选 tag 与理由。

规则：

- 只有 ACTIVE tag 自动进入候选；
- PAUSED tag 只在用户明确选择时可附加；
- DELETED tag 永远不能新增关联；
- 没有匹配时可建议创建新 tag，但必须由用户确认名称和范围；
- 同名/近义冲突必须先解决，不能静默创建 `react-2`；
- 一个候选可以关联多个 tag，但必须指定一个 primary tag。

### 8. 候选审阅

`TacticalExtractionCandidate` 在 UI 中显示四列：

- 来源证据；
- 提炼内容；
- 与目标战术的差异；
- 风险、未知和验证计划。

用户可操作：

```text
Approve as Draft
Edit and Approve
Return for Re-extraction
Reject
Change Tags
Change Target Skill
Redact Source
```

批准动作要记录用户、时间、Candidate hash、目标版本和最终 Diff。

### 9. 私有战术内容模型

提炼后的战术仍遵循 [`docs/12-tactical-skills.md`](docs/12-tactical-skills.md) 的完整结构：

- 场景标签；
- 前置与排除条件；
- 状态机；
- Playbook；
- 预期观察；
- Verifier Contract；
- Stop/Rollback；
- Known Failure Modes；
- 冲突与依赖；
- 来源和效能指标。

一段“经验总结”如果无法形成这些字段，可以作为 `evidence note` 或 `best-practice supplement`，但不能伪装成可执行战术。

### 10. 安全与治理

- 默认只读取用户显式选定的来源范围；
- 不后台扫描所有会话自动吸收；
- Secret 和 Restricted 内容必须经过策略允许，默认不进入模型外部路由；
- 企业来源保留数据驻留、授权和过期约束；
- 战术正文不得保留访问令牌、客户身份和真实生产密钥；
- 来源删除请求不直接破坏已发布战术，应进入治理流程并评估衍生数据；
- 低质量或有害战术可以 `QUARANTINED`，其历史使用仍可审计。

### 11. 已实现服务边界

当前服务图为：

```text
ctx.militaryTags         # 标签注册表、revision、alias 和生命周期
ctx.militaryIngestion    # 来源快照、提炼 Job、候选和审阅
ctx.militaryTactics      # Draft/version 发布与检索
ctx.militaryArtifacts    # 来源与 Diff 内容寻址存储
ctx.skills               # 只发布通过实时权利检查的 STABLE 编译视图
militaryPrivateSkills/*  # Knowledge Center 的可信 Host RPC
```

提炼 Job 不能获得 Mission 接受权、Agent Freeze 权或 Git 远端写权限。

### 12. WebUI

#### 标签管理

- 搜索、按状态筛选；
- 新增、暂停、恢复、重命名、删除；
- 显示关联战术数、使用数、最后评估时间；
- 显示 alias 和冲突；
- 删除前显示受影响战术，但执行 tombstone 而非级联删除。

#### Knowledge Center

Military 主界面提供七个视图，不要求用户编辑 JSON：

1. **来源资料**：粘贴文本、Session 区间或文本 Artifact；选择 license、
   classification、外部模型同意、依赖版本和目标 Skill；
2. **提炼任务**：Chunk 进度、失败原因、WARN acknowledgement 和同 request
   恢复；
3. **待审候选**：来源/现有版本 Diff、Claim Evidence、风险、验证计划、
   编辑、批准、退回和拒绝；
4. **私有技能库**：sanitized snapshot/chunk、完整文件快照、来源、审批、
   exact version、继承谱系、使用结果、Tokens 与明确的成本可用状态；
5. **模拟召回**：不创建 Task、不调用模型，使用真实 recall 的同一规则展示
   exact Skill、排序、匹配/排除原因和实际投放片段；
6. **版本与晋升**：逐级晋升、降级、隔离、恢复 DRAFT 和退役；
7. **撤回与影响**：所有者、许可、安全、错误或保留期原因，派生版本和历史
   Usage 影响报告。

设置页只保留提炼模型/预算、默认 scope/retention、Canary 和召回数量等策略。
用户批准在 RPC Host 边界固定为用户动作；General 只能发起提炼、请求修订或
提出拒绝建议，不能调用批准接口。

### 13. 指标

- 提炼请求数和完成率；
- Candidate 审批率；
- 新战术/补充比例；
- 用户修改幅度；
- Tag 自动匹配接受率；
- Draft 到 Canary/Stable 的转化率；
- 来源证据覆盖率；
- 后续实际 guidance lift；
- 因隐私/Secret 被拒或脱敏的比例；
- 重复战术率。

### 14. 测试与验收

- 重命名 tag 后历史引用仍按同一 tagId 解析；
- PAUSED/DELETED tag 不进入自动匹配；
- 删除 tag 不级联删除历史战术；
- 非 Military 会话只有用户显式发起提炼时才被读取；
- Session 范围哈希变化会使 Candidate 失效；
- 同一请求的重试不创建重复 Draft；
- Supplement 必须指向精确 base version；
- 未经用户批准，零 Candidate 进入可调用 Skill 目录；
- Secret 扫描失败时 fail closed；
- 所有 Draft 都能追溯到来源、提炼模型、审阅用户和 Diff。

### 0.3.0：来源权利、时效和撤回

每次提炼在模型调用前固化 [`TacticalSourceSnapshot`](schemas/tactical-source-snapshot.schema.json)，记录 source owner、license、allowed use/audience、derivative rights、classification、retention/revocation、依赖版本和有效时间。

除 Secret/PII 外，还检查：

- Prompt Injection；
- 模型无证据结论；
- 与当前 API/内部标准矛盾；
- 依赖版本过期；
- 临时 workaround 被误包装成最佳实践；
- 来源是否独立；
- 能否重现或由第二来源佐证。

`UNKNOWN` rights 只能进入个人隔离 DRAFT。来源撤回时生成 [`KnowledgeRevocationOrder`](schemas/knowledge-revocation-order.schema.json)，沿 Source→Candidate→Tactic→Guidance→Task→Memory/Report 派生图分析影响，禁止新 Guidance，并对高风险已接受结果重新验证。

重命名/删除标签不改变来源权利；tombstone 标签仍保留历史关联。

当前实现会在导入、审批、晋升、全局 Skill list/get、Task 召回以及每个模型
pre-step 重新检查 owner、license、allowed-use、audience、derivative、
valid-until 和 lifecycle。依赖版本被编译为 Task tactic card 的显式
precondition；无法从当前任务证据验证时，Worker 必须停止应用该战术并升级，
不得由轻量模型猜测。

Task 只固定 exact Skill version 并投放紧凑适用性卡片。procedure 超过八步时，
卡片给出唯一浅层动作 `military_get_order({ "skillId": "…" })`；Host 从当前
Task 派生 version、实时复核来源和 lifecycle，再返回完整步骤、停止条件与
Verifier。这个渐进式披露复用既有工具，不扩大 Flash 的工具词汇表。

每个终态 Candidate 都由 Host 自动写入 exact Skill version、Task/Mission、
匹配原因、真实 provider/model、宿主观察的 tool evidence、Verifier receipt、
成功/返工/回滚/失败、Session-observed token 和成本状态。RC.2 的 DeepSeek
route 没有权威价格目录时记录 `PROVIDER_PRICING_UNAVAILABLE`，不会伪造费用。
这组记录用于人工晋升、降级、重新验证和撤回影响分析；“被分配”不会被报告为
因果有效。


---

<a id="part-34"></a>

## Part 34：Military 可视化设置、部门模板与上下文策略

源文件：`docs/34-department-agent-templates-and-context-policy.md`

### 1. 产品边界

DSH 主侧栏 footer 注册独立的 `Military 设置中心` 入口，位置和交互方式与
“知识与技能”入口一致。点击后打开 DSH 原生 Modal；它不再占用通用 Settings
的 `settings.section`，也不要求用户编辑 YAML 或 JSON。

该页面覆盖 General 和全部 11 个内置部门模板：

- General；
- 通用技术参谋、React 前端参谋、参谋长；
- 快速反应部队 Worker；
- 工兵部 Engineer；
- 督战队 Inspector；
- Trajectory、Effectiveness、Museum；
- Evaluation Examiner 与 Committee Chair。

普通、安全的行为参数均使用下拉框、数字框、开关、日期选择器、多选项和标签
编辑器。ToolProfile、PermissionProfile、内部 identity、Task revision、幂等键、
终止工具和父级 receipt 属于 Host 治理合同，只读展示，不能通过设置削弱。

### 2. 页面信息架构

```text
DSH Sidebar Footer
├── Military 设置中心
│   ├── Military-部门模型
│   ├── Military-执行与成本
│   ├── Military-Specs 工作区
│   ├── Military-安全与恢复
│   ├── Military-战术与标签
│   ├── Military-绩效评估
│   └── Military-显示与进阶
├── 知识与技能
└── DSH Settings
```

`Military` 页面绑定 RC.2 shared Settings mirror 的 11 个 namespace：

| 分组 | Namespace | 可视化内容 |
|---|---|---|
| 部门模型 | `military-model-routing` | General 模型、推理强度、输出预算和简体中文提示词 override |
| 部门模型 | `military-agent-templates` | 11 个模板的模型、推理、输出、上下文、并发、压缩、状态和提示词 revision |
| 执行与成本 | `military-core` | Radio 尝试次数和 lease |
| 执行与成本 | `military-staff` | 参谋长兜底 |
| 执行与成本 | `military-memory` | Wave 轨迹和 General 压缩后效能评估 |
| 战术与标签 | `military-tactics` | 候选召回上下限和 Canary 投放 |
| 战术与标签 | `military-tags` | 标签新增、暂停、恢复和 tombstone 删除 |
| 安全与恢复 | `military-oversight` | 完成联锁、宿主证据、冻结和无进展上限 |
| Specs 工作区 | `military-specs` | 安全的本地提交前缀 |
| 绩效评估 | `military-evaluation` | 时间、模板、部门、工作区、Mission、基线、分类和结果 |
| 显示与进阶 | `military-presentation` | 军事/中性术语、审计密度和紧凑布局 |

完整 wire 契约见
[`military-settings.schema.json`](schemas/military-settings.schema.json)；
[`settings.example.yml`](examples/settings.example.yml) 只是 namespace 组合参考，
不是推荐的人工作业方式。

### 3. 模型下拉框

Host 通过 RC.2 `ctx.llm.listProviders/listModels/resolveModelInfo` 读取当前
provider/model 目录，再与 Military capability evidence 合并。浏览器只读取
`militaryControlPlane` 的已审计投影。每个下拉选项同时携带：

```text
provider + model + ModelCapabilityProfile
```

内置默认治理路线为：

| 路线 | 默认用途 | 状态 |
|---|---|---|
| `deepseek-official/deepseek-v4-flash` | General 与全部部门的轻量主力 | `CANARY`，内置模板显式允许 |
| `deepseek-official/deepseek-v4-pro` | 用户明确选择的重量升级路径 | 以当前 capability evidence 为准 |

不在真实目录中的已保存值以 `UNAVAILABLE` 只读显示，便于诊断漂移，但不能继续
选择。所有 live route（包括第三方 Provider）默认可选；没有 Military profile
时 Host 从 DSH 目录创建执行能力投影。`UNVERIFIED/CANARY/DEPRECATED` 只作为
能力或绩效 Evidence 展示，不充当权限。Host 持久化每个 exact route 的状态
revision、原因和证据；alias 未证明、价格未知和 tool-calling 未知都显式显示，
不用前端 allowlist 或假价格填充。

模型切换不会改变该角色的工具、文件权限、验证器、终止协议或父子恢复能力。
轻量化只改变执行模型与资源预算，不删除流程能力。

### 3.1 简体中文角色提示词

`Military-部门模型` 直接显示 General 和 11 个内置角色的完整提示词，不使用
隐藏 JSON 编辑器。默认文本来自
`@dsh-military/contracts/role-prompts`，针对 Flash 的短步骤、准确工具选择、
参数核对、单一终态动作和证据优先原则编写。

- General override 位于 `generalPromptOverride`，空值表示使用插件自带版本；
- 部门 override 位于 `AgentTemplateProfile.rolePromptOverride`，每次保存创建
  下一 immutable revision；
- 旧模板没有该字段时按 template ID 自动回落到自带提示词；
- 页面提供保存、逐角色恢复和全角色恢复；
- 输入限制为 32–12000 字符，正文必须包含足够的简体中文，只允许必要的英文
  技术标识和 `{{cwd}}` 模板变量；
- 辅助 lint 只扫描自然语言并跳过 fenced/inline code、路径、工具名、标识符
  和变量；用户可逐项/批量确认并撤销上一批；
- 保存时 Host 重新 lint 和应用 UTF-16 位置，生成 source/result hash、应用数、
  剩余数和确认时间的不可变回执；Client 伪造转换结果或遗漏确认会被拒绝；
- Prompt Surface 只替换 `deployment:persona` 中的可编辑角色正文。工具白名单、
  workspace path、binding/grant、证据和终态规则由 Host 随后追加，设置文本
  无法授予新工具、扩大权限或跳过验收。

编辑器的“有效提示词”来自真实 Prompt Assembly 使用的同一六层 Host 编译器，
显示可编辑正文、Host authority、工具/终态、Workspace、Evidence 和运行预算。
页面同时展示相对已保存/插件默认的语义 Diff、token 和简体中文字符估算。
确定性 Flash readiness 检查 Host 字段、路径猜测、权限暗示、停止规则、工具
存在性和 Schema 复杂度；`BLOCKED` 不能生产启用，也不会自动改用 Pro。

### 4. 默认轻量策略

General 默认：

```yaml
provider: deepseek-official
model: deepseek-v4-flash
reasoningEffort: high
maxOutputTokens: 16384
contextBudgetTokens: 128000
maximumSteps: 24
```

部门模板默认：

```yaml
model: deepseek-v4-flash
reasoningEffort: high
maxOutputTokens: 16384
contextBudgetTokens: 96000
compactionTriggerPercent: 78
retainedTailTokens: 20000
```

需要综合判断的参谋长、Museum 和 Evaluation Chair 默认使用 `max`，但仍使用
Flash；Pro 只有用户在对应模板卡中显式选择后才生效。模板显式携带
`allowCanaryModel: true`，因此 Flash 的 `CANARY` 状态不会被误当成自动 fallback。
系统不做隐式模型升级，也不会把 General 当前模型偷渡给子 Agent。

#### Task 级轻量预算

General 可省略整个 `budget`，Host 会编译下列 Flash 安全默认值：

| 预算 | 默认值 | 实际执行边界 |
|---|---:|---|
| model steps | 16 | RC.2 `agent/pre-step`，另保留一个仅终态工具可见的收口 step |
| tool calls | 64 | 持久化 Capability Grant 的 `maximumUses` |
| Tactical Requests | 4 | 精确 `taskId + taskVersion` 的 Radio 事件计数 |
| child wall clock | 7200 秒 | 持久化并发 reservation 与每次 model step 准入 |
| output tokens | 16384 | 实际 LLM request 的 `maxTokens` |

显式预算只能在固定范围内取值，且与模板、Model Capability 和 Resource Policy
取最严格值，不能借设置扩大权限。`guidanceRequests: 0` 会直接从该 Task 的模型
工具面移除 `military_radio_request`，避免轻量模型调用必然失败的工具。

这些上限不通过删工具来牺牲完整能力：普通 Task 可以显式提高预算；超大 Specs
使用 Host 管理的分段 staging 和一次原子 apply，因此不要求模型在单次参数或
单次输出中承载完整大文档。

### 5. 模板修订与运行隔离

```text
templateId + revision
```

是绩效、审计和恢复的最小身份。每次可视化修改都从最新设置快照读取当前模板，
生成新的 immutable revision，并串行写回 registry；快速连续修改不会覆盖前一项
修改。已创建的 `AgentExecutionBinding` 继续使用创建时冻结的 revision，新 Agent
才使用最新 ACTIVE/CANARY revision。

每个 Binding 冻结：

- template、department 和 role；
- provider、model、reasoning 和 capability profile；
- ToolProfile、PermissionProfile、Verifier 与 API Grant revision；
- Task scope、Workspace、Lease 和预算；
- context/compaction policy；
- 父 Session 与 preset generation。

紧急撤权在下一次工具准入前收紧，而不是通过热改运行中模板实现。

历史 revision 还保留保存来源、Prompt Diff、完整 readiness、简体中文审阅回执
和当时的模型/预算。回滚创建新的 revision，不覆盖旧记录。角色页按 exact
revision 展示其 Session、model/tool 请求、observed tokens、工具成功率、模拟和
评测引用；Provider 没有价格时费用状态保持不可用。

### 6. 上下文与压缩

`contextBudgetTokens` 是 Military 行为预算，不是修改 provider 的物理 context
window。有效预算为：

```text
effectiveBudget = min(
  template.contextBudgetTokens,
  resolvedModelContextWindow - reservedOutputAndToolEnvelope
)
```

达到：

```text
floor(effectiveBudget × compactionTriggerPercent / 100)
```

后，Host 在下一次安全模型请求前创建幂等 `CompactionAttempt`。安全边界要求：

- 当前工具调用与结果已配对；
- Candidate/Specs/Git 终止事务没有进行中；
- Task Order、Acceptance、Guidance、Freeze 和未决决定已持久化；
- Inbox admission 可有序暂停。

压缩保留 identity、Task、验收条款、已接受事实、证据、工作区/Git 基线、当前
blocker、Guidance、决定和停止条件；重复日志和已外置的大文本可以裁剪。失败按
模板的 `onCompactionFailure` 升级或暂停，绝不伪造压缩成功。

### 7. 轻量模型可用性约束

设置只能调整性能与呈现，不能重新引入模型需要猜测的 Host 字段：

- Task、Candidate、Guidance、Decision 和 Specs 使用浅层模型草稿；
- identity、revision、scope、allowed tools、authority、timestamp 和 receipt
  由 Host 编译；
- 当前阶段只暴露当前可执行的工具；
- 错误返回稳定 code、一个具体原因和一个恢复动作；
- terminal mutation 先持久化领域结果与父级 receipt，再结束 turn；
- terminal success 后，同一 assistant response 的后续工具调用被闩锁拒绝；
- 大 Specs 使用 Host staging + 单次原子 apply，不以降低 token 上限删减能力。

因此，切换到 Pro 可以提高个别复杂任务的推理余量，但不是走通流程的前置条件。

### 8. 设置保存与恢复

- 所有普通字段使用 RC.2 `SettingsScope.set/unset`；
- 保存后立即读取 shared mirror，Host 未接受时显示明确失败；
- 同一模板或标签的快速修改按 Scope 串行化；
- “恢复默认”对模板创建新的 revision，不覆盖历史；
- 设置只影响后续请求或新 Agent，不改写已完成的性能归因；
- Evaluation 使用单调 `runNonce` 创建 durable Job；Settings 只保存
  `lastEvaluationRequestId`、`lastDatasetHash` 和 `lastReportId` pointer；
- SQLite/Artifact 保存 Frozen Dataset、exact-configuration shard、Report 与 Appeal，
  进程重启后重新取得 lease/fence 并只补缺失分片；
- 执行超时为 30～86400 秒，默认 1800 秒；无效日期、反向时间或非法超时直接记录
  结构化 `FAILED`，不会永久显示运行中；
- 旧版 `lastReportJson` 只用于读取迁移，新报告完成后清空，不作为报告仓库；
- 默认确定性叙述不调用模型；`COMMITTEE_MODEL` 必须显式选择且不能改变指标。

### 9. 固定安全边界

下列能力不会出现在可关闭的开关中：

- Session Workspace 隔离和路径 canonicalization；
- 远程 Git 写入、破坏性 reset 与跨工作区写入禁令；
- Engineer 原子写入、验证、本地提交、ledger 和 parent report；
- 权威宿主证据、幂等、预算结算和 capability admission；
- 用户取消优先级、父子终态恢复和重复报告去重；
- 冻结、验证、Integration 和 Completion Gate。

设置页显示这些治理事实，帮助用户理解系统，但不会把内部权限矩阵变成容易误配的
文本配置。

### 10. 验收条件

- DSH Settings 中 `Military` 与 `Agent 预设` 同级；
- General 和 11 个部门模板都有独立模型下拉框；
- 下拉框读取并核对真实 DSH 模型目录；
- Flash 是默认主力，Pro 仍可逐部门显式选择；
- 模型切换不改变工具、权限、验证、Git、恢复或审计能力；
- 所有实际可变 namespace 都有可视化控件或只读结果展示；
- 用户无需编辑 `profilesJson`、`tagsJson` 或 Evaluation JSON；
- 保存、快速连续修改、恢复默认和页面重载不丢字段；
- 设置只生成新模板 revision，运行中 Binding 不漂移；
- 普通非 Military Session 不获得 Military 运行工具或策略。


---

<a id="part-35"></a>

## Part 35：“头脑风暴”命令与用户决策对话

源文件：`docs/35-brainstorm-command-and-decision-dialogues.md`

### 1. 产品目标

Military preset 提供一个显式入口，帮助用户把模糊想法快速收敛为可执行 Mission Intent、Direction 候选和 specs 基线。它不自动猜测用户的产品偏好，而是通过分阶段问题弹窗让用户作出高价值选择。

### 2. 命令名称兼容性

DSH 当前命令解析器的命令标识只接受小写 ASCII 字母、数字、`_` 和 `-`。因此协议级命令为：

```text
/brainstorm
```

WebUI 的本地化显示名称固定为：

```text
头脑风暴
```

用户在命令列表中看到“头脑风暴”；点击后发送 `/brainstorm`。在 DSH 尚未支持 Unicode command name 前，不把 `/头脑风暴` 伪装为已受 Host 命令注册表支持。后续若 Web composer 提供正式 alias seam，可增加中文输入别名，但领域事件仍使用稳定 id `brainstorm`。

### 3. 可用范围

命令通过 `military` preset scope 注册。只有当前根会话实际组装到 `military` 时才出现在命令列表。

- Standard/Code/Minimal 等 preset 看不到该命令；
- Military 子代理不直接接收 UI 命令；
- 已冻结或关闭的 Military 会话不能开启新 Brainstorm；
- 同一会话只允许一个 ACTIVE Brainstorm Order。

### 4. 调度流程

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

### 5. 为什么由 General 提问

DSH 的 `ask_user_question` 工具拒绝由另一个运行时 Agent 所拥有的 delegated subagent 直接向用户弹窗。因此：

- Advisor、Chief of Staff、Worker 和 Engineer 只能产生 `DecisionQuestionSet`；
- General 是用户当前交互的根 Agent，负责调用 `ask_user_question`；
- Radio Broker 或 Host Interaction Broker 只做投递、去重和审计，不能冒充某个子代理获得用户交互权。

这避免多个子代理同时弹窗和用户不知道谁在等待答案。

### 6. 决策漏斗

默认按以下阶段推进，每轮只问 1～3 个相互关联的问题：

#### Phase A：目标与对象

- 谁是主要用户；
- 要解决的核心问题；
- 最重要的可观察结果；
- 哪些目标明确不在范围内。

#### Phase B：约束与风险

- 时间、预算、合规和数据边界；
- 可接受的技术栈；
- 不可逆选择；
- 外部系统和权限。

#### Phase C：体验与优先级

- 首个必须完成的用户流程；
- 速度、质量、可维护性之间的偏好；
- MVP 与后续方向；
- 可接受的降级。

#### Phase D：技术与运营

- 部署环境；
- 可用内部 API；
- 可观测性和运维要求；
- 测试与验收方式。

#### Phase E：收敛

- 参谋部推荐方案；
- 主要替代方案；
- 未决假设；
- 是否批准生成 specs 基线。

### 7. 问题设计规则

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

### 8. 交互频率与防疲劳

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

### 9. 参谋部参与

每轮弹窗之前，参谋部可以并行生成结构化选项：

```text
Domain Advisors → independent recommendations
Chief of Staff → fallback/synthesis when needed
General → remove duplicates, expose trade-offs
User → makes user-owned decision
```

参谋的建议必须注明：来源、假设、风险、推荐理由和需要用户决定的部分。

### 10. 空项目与工兵

若 Project Recon 判定为 `IDEATION` 或 `SPECS_ONLY`：

1. General 完成决策漏斗；
2. Staff 形成首个 Direction/Wave；
3. Harness 创建 `SpecsMaintenanceOrder`；
4. 只有 Engineer 可写入 `specs/`；
5. Engineer 校验并在本地 `main` commit；
6. General 才能进入实现 Wave。

Brainstorm 本身不直接写项目文件或 Git。

### 11. `BrainstormOrder`

契约至少包含：

- root session、Mission id；
- 项目阶段；
- 已知目标、约束和未知；
- 问题阶段和预算；
- 已回答 Question id；
- Staff/Chief 建议引用；
- completion criteria；
- specs handoff policy。

Schema 见 [`brainstorm-order.schema.json`](schemas/brainstorm-order.schema.json)。

### 12. 状态机

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

### 13. 用户回答的权威性

回答只对相应 Question id、Brainstorm revision 和显示选项生效。选项在用户打开弹窗后被 Staff 改写时，旧回答不能静默应用到新问题。

用户授权类回答需要单独的高风险确认；不能把“我喜欢方案 A”解释为允许 push、生产写入或处理 Restricted 数据。

### 14. 恢复与取消

- 浏览器刷新：pending question 从 `ctx.userQuestions` 和 durable Brainstorm state 恢复；
- General compaction：保留全部 Decision Record 和未决问题；
- General 取消：关闭 pending question，Order 进入 PAUSED/CANCELLED；
- Staff 子代理失败：General 可重试或使用 Chief fallback；
- Engineer 失败：Brainstorm 保持 SPECS_HANDOFF，不能假报完成。

### 15. WebUI 呈现

- 命令列表显示“头脑风暴”；
- 会话节点显示当前阶段、已完成决策和剩余问题；
- 用户可“继续提问”“采用推荐”“生成草案”“暂停”；
- 最终显示 Mission Intent Diff、Direction 草案和 specs commit receipt；
- 所有自由输入明确标注数据分类提示。

### 16. 测试与验收

- 非 Military 会话中 `/brainstorm` 未注册；
- 命令点击生成协议 id `brainstorm`；
- 子代理直接调用 `ask_user_question` 被拒时，问题能通过 General 正确转交；
- 同一会话重复命令不会创建重复 ACTIVE Order；
- 用户取消后无孤立 pending question；
- 达问题预算后系统生成显式假设，不无限循环；
- 可读取事实不会被反复问用户；
- 空项目最终产生 Engineer 的 specs commit，而不是 General 直接写文件；
- 每个用户选择能追溯到具体问题版本和后续设计决策。

### 0.3.0：Decision Broker

`/brainstorm` 的每轮问题也进入持久 Decision Broker，而不是直接把临时 Promise 作为状态。问题集携带 source、priority、task/mission revision、expiry 和 user-owned reason；根 General 串行调用 `ask_user_question`。

浏览器断线或 General compaction 不丢问题。两个标签页同时回答时，第一个 CAS 成功的 revision 生效；后来的回答显示已结算。若 Mission/Direction 发生 Change Order，旧问题标记 `STALE` 并重新生成。


---

<a id="part-36"></a>

## Part 36：参谋长兜底机制

源文件：`docs/36-chief-of-staff-fallback.md`

### 1. 角色定位

参谋长（Chief of Staff）是参谋部中的固定特殊 Agent，用于在私有战术和专业参谋覆盖不足时，依据模型自身能力、已认证上下文和明确假设，生成推进决策所需的参考意见。

它不是万能事实来源，也不是 General 的替代者。它没有最终战略批准、任务接受、冻结、Git 远端写入或用户授权权力。

### 2. 何时触发

参谋部先运行 `TacticalSufficiencyGate`。只有以下一种或多种条件成立时，才调用参谋长：

- 没有任何满足前置条件的私有战术；
- 候选战术只覆盖部分决策维度；
- 战术版本与当前环境不兼容；
- 战术证据质量或效能样本低于阈值；
- 领域参谋意见严重冲突且无主责覆盖；
- 问题属于新技术、新版本或未建档场景；
- Radio 请求已证明有价值，但现有 Guidance 无法形成可执行步骤。

不能因为参谋长方便，就跳过便宜的项目侦察、API 查询和现有战术检索。

### 3. 战术充分性评分

Harness 先计算结构化输入，不让参谋长自行宣称“技能不足”：

```text
coverageScore        决策维度覆盖
compatibilityScore   模型/工具/环境/数据兼容
provenanceScore      来源与样本质量
freshnessScore       技术版本和时间相关性
effectivenessScore   历史外置验收表现
conflictPenalty      候选之间的冲突
```

输出：

```text
SUFFICIENT
PARTIAL
INSUFFICIENT
CONFLICTED
UNKNOWN
```

触发阈值按 Task Type 配置，并记录版本。

### 4. 输入边界

参谋长收到一个冻结的 `ChiefContextPacket`：

- Mission/Direction/Wave/Task 位置；
- 用户目标、硬约束和未决选择；
- 已认证事实和 Artifact；
- 领域参谋独立意见；
- 已检索战术及不适用原因；
- 当前环境和可用工具；
- Acceptance Contract；
- 禁止事项、预算和数据分类。

不默认读取所有 Worker 原始思考或整仓库。需要新事实时，参谋长提出侦察建议，由有权限的 Agent 执行。

### 5. 输出契约

`ChiefOfStaffAdvice` 包含：

- 问题重述；
- 已知事实与假设分离；
- 2～4 个可行方案；
- 推荐方案及理由；
- 风险、反例和失效条件；
- 最小下一步；
- 所需 Verifier；
- 是否需要用户选择；
- `DecisionQuestionSet`；
- 置信度和置信度来源；
- 明确声明“模型生成参考”而非私有战术。

Schema 见 [`chief-of-staff-advice.schema.json`](schemas/chief-of-staff-advice.schema.json)。

### 6. 与用户交互

参谋长是 General 的子代理，不能直接调用 DSH 的 `ask_user_question`。正确流程：

```text
Chief produces DecisionQuestionSet
  → Harness validates question ids/options
  → Radio/Staff Broker sends to General
  → General deduplicates against pending questions
  → General invokes ask_user_question
  → answer is recorded
  → General sends resolved choice back to Staff
```

这样所有弹窗都由根交互 Agent 所有，不会有多个子代理争抢用户。

### 7. 与私有战术的关系

参谋长建议默认是一次性 `GENERATED_REFERENCE`，不能自动进入私有战术目录。

如果后续执行通过严格验收，系统可以创建战术提炼候选：

```text
Chief Advice + Accepted Execution + Verifier Evidence
→ TacticalExtractionCandidate
→ User Review
→ DRAFT Tactic
```

未执行、未验证或失败的建议可以作为 Museum 反例，但不能被提升为最佳实践。

### 8. 调度优先级

```text
project inspection
→ eligible private tactics
→ domain advisors
→ chief of staff fallback
→ user decision through General
→ strategic escalation / human expert
```

高风险领域可以配置为：即使参谋长给出建议，也必须由用户或指定人类专家批准。

### 9. 权限

参谋长默认：

- 只读 Mission/Artifact/Staff/Tactic；
- 可调用受控检索和企业只读 API；
- 可生成 Advice 和 DecisionQuestionSet；
- 不直接写项目文件；
- 不执行 Git；
- 不接受 Task；
- 不修改 Acceptance Contract；
- 不冻结/释放 Agent；
- 不发布 Skill；
- 不获得未经 Profile 授权的 Restricted 数据。

### 10. 预算与循环控制

每个决策节点默认最多：

- 1 次初始 Advice；
- 1 次基于用户回答的修订；
- 1 次基于新证据的修订。

连续无法推进时必须输出：

```text
BLOCKED_NEEDS_USER
BLOCKED_NEEDS_DOMAIN_EXPERT
BLOCKED_NEEDS_EVIDENCE
STRATEGIC_REPLAN_REQUIRED
```

禁止参谋长与其他参谋无限互相评论。

### 11. 质量门禁

Harness 检查：

- Advice 引用的事实存在；
- 假设被明确标注；
- 建议没有越过权限；
- 方案不是同义改写；
- 用户问题属于用户拥有的选择；
- 下一步可以独立验收；
- 没有把 generated reference 冒充 Stable Tactic；
- Task Version 和 Context Packet 未过期。

### 12. WebUI

参谋名册中固定显示一张“参谋长”卡：

- 模型、Thinking、Context Policy；
- 触发次数；
- 私有战术不足触发原因；
- Advice 被采用、被拒绝和最终通过率；
- Pending user decisions；
- 用户可暂停参谋长，但暂停后不足场景必须升级 General，不能静默跳过。

### 13. 测试与验收

- 有充分 Stable Tactic 时不会无谓触发参谋长；
- Skill 不兼容时触发理由可审计；
- 参谋长不能直接弹出 delegated ask-user；
- DecisionQuestionSet 可由 General 正确显示和回传；
- Advice 不能直接发布为 Skill；
- Advice 引用不存在的 Artifact 时被拒；
- Advice 过期时不投递给新 Task Version；
- 连续修订达到预算后升级，不无限循环；
- 绩效报告能区分 generated reference 与 private tactic guidance。

### 0.3.0：预算、证据与问题中继

Chief fallback 需要独立预算 reservation，且同一 decision key 有最大初稿/修订次数。建议必须引用当前 Context Snapshot 和已检查的私有战术，不得把模型常识标成企业事实。

需要用户选择时，Chief 只输出 `DecisionQuestionSet`；Decision Broker 验证 taskVersion、去重和 expiry 后，由 General 弹窗。用户回答返回后，Chief 可产生新 advice revision，但不能修改旧建议或绕过 Harness 决策记录。


---

<a id="part-37"></a>

## Part 37：37. 军事评估委员会与绩效决策中心

源文件：`docs/37-military-evaluation-committee.md`

### 1. 产品目标

军事评估委员会是独立于单次 Mission 验收的跨会话分析系统。用户选择时间和范围后，
它回答三个实际问题：

1. 每个 exact Agent configuration 在什么任务、难度和数据条件下表现如何；
2. DeepSeek Flash 是否在同角色、同难度和相同治理条件下达到 Pro 的质量底线；
3. 在质量与安全合格后，哪种配置以更低 Token、延迟或成本产生最终 Accepted
   Outcome。

结果是可审查、可重放、可申诉的建议，不是自动修改生产模型的控制器。

### 2. 与其他评估的边界

| 分析 | 对象 | 主要证据 | 输出 |
|---|---|---|---|
| Tactical Effectiveness | Skill/Guidance version | compaction、Task、Verifier | 战术保留/改进建议 |
| Flash Workbench | 九个固定工具场景 | Host/Schema gate、Provider Session | 工具流程兼容性 |
| Agent Performance | exact Agent configuration | Frozen Dataset、Attempt、Evidence | individual performance |
| System Overall | Military 组织协作 | Mission、handoff、Radio、Freeze | overall report |

Skill 成功不能替代 Agent 绩效；高 Agent 通过率也不能证明某个 Skill 的因果贡献。
固定工作台不能冒充真实生产时间窗的委员会数据。

### 3. 委员会组成

#### 3.1 Dataset Auditor

Dataset Auditor 完全由 Harness 确定性执行：

- 应用完整 Request 筛选和 actual preset 检查；
- 重建 Attempt identity、lease 窗口和 configuration snapshot；
- 对账 Session、Binding、Ledger、Tool、Evidence、Token 和 Artifact；
- 冻结预执行难度、缺失原因和数据质量；
- 去重并生成 canonical Dataset Artifact/hash；
- 计算指标、区间、失败阶段和比较资格。

它是数值事实的唯一来源。

#### 3.2 Individual Examiner

每个 exact configuration 是一个可恢复 Job shard。默认 Examiner 是确定性规则，
根据指标、限制和失败阶段生成中文分析与建议。用户显式启用委员会模型时，模型只
接收脱敏聚合值和 Evidence id：

- 不读取原始 Session；
- 没有工具；
- temperature 0；
- 输出长度受限；
- 严格 JSON 字段集合；
- 失败时回退确定性叙述。

Examiner 不能改写 Host 指标、区间、decision 或 promotion 状态。

#### 3.3 Committee Chair

Chair 读取已验证 individual performance 和 configuration comparison，合成：

- 总体 Mission/Task 结果；
- 部门交接、Radio、Freeze 和 specs 指标；
- Flash/Pro 比较；
- 回归告警和决策阻断；
- 3～5 个证据化改进实验；
- unsupported conclusions。

Chair 同样默认为确定性实现。即使使用模型叙述，也不能把小样本写成确定排名。

### 4. 用户运行流程

`Military-绩效评估` 表单提供：

```text
时间范围
Template / Department
Workspace / Mission 目录
是否纳入未完成 Session
minimum samples
comparison baseline
confidence level
non-inferiority margin
timeout
narrative mode
classification
```

创建后 UI 显示 durable Job：

```text
QUEUED
DISCOVERING_SESSIONS
BUILDING_DATASET
EVALUATING_TEMPLATES n/N
SYNTHESIZING
VALIDATING_REPORT
COMPLETED / FAILED / CANCELLED
```

Job 不依赖当前聊天 Turn。刷新、断线或 DSH Web 重启后仍可查看；retryable failure
可以从已冻结 Dataset 和已完成 shard 恢复。

### 5. 纳入规则

Session 只有满足以下条件才被纳入：

- materialized Session 的实际 preset 是 `military`；
- 与请求时间范围相交；
- 命中 Template、Department、Workspace 与 Mission 筛选；
- 调用者有报告和源数据读取权；
- 未被保留/删除策略移除；
- Agent Binding、Task version、generation 和 lease sequence 可恢复；
- 严重 event gap 已明确标记，不能伪造完整观察。

普通 Session 即使文本提到 “Military” 或使用相同 cwd，也不能纳入。
`includeIncompleteSessions=false` 时，未完成 Session 进入排除清单而不是悄悄消失。

### 6. Attempt 与配置单位

Attempt identity：

```text
root Session + Session + Mission + Workspace
+ Task id/version + Agent id/generation + lease sequence
```

主分析 configuration：

```text
role + template/revision + prompt revision
+ provider + observed model + route status + reasoning
+ ToolProfile/revision + PermissionProfile/revision
+ preset generation + Bundle version + DSH release/commit
```

不同 revision、route、权限或工具配置永不混组。actual route 状态区分 exact、
fallback chain 和 alias unproven；后两者只做诊断。

### 7. 报告的五个维度

#### 7.1 参与

- eligible/assigned/completed Attempt；
- unique Mission/Session；
- accepted contribution；
- Task type coverage；
- consultation。

活动量不作为质量分。

#### 7.2 准确与完成

- first-pass/final acceptance；
- Evidence support；
- false completion；
- regression escape；
- blocker resolution；
- handoff completeness；
- parent wakeup。

所有值来自 Ledger、Verifier 和 receipt，模型自述不算 Evidence。

#### 7.3 难度校正能力

`Difficulty-adjusted Capability Index` 使用预执行 difficulty 加权的 final
acceptance，并展示 Mission-cluster 区间、rubric 和 difficulty model version。
结果期的 rework/Blocker/Radio 不得反向提高难度。

#### 7.4 可靠性与恢复

- Freeze incident；
- permission violation；
- stale submission；
- recovery success；
- terminal duplicate；
- recovery drift。

权限越界、无 Evidence 完成、回归逃逸、重复终态、父级不恢复和恢复漂移是硬门。

#### 7.5 Accepted Outcome 效率

- 全部 input/output/reasoning Token；
- queue/model/tool/verification latency；
- model step、tool call、correction、retry；
- fallback/compaction；
- observed/estimated/unknown cost；
- 每个最终 Accepted Outcome 的均值和 p50/p95。

失败与返工成本不会因最终成功而消失；未知价格不会显示为零。

### 8. 数据质量和统计状态

二项率显示 Wilson/clustered interval；连续值与差异使用 Mission-cluster bootstrap。
同一 Mission 的多个 Attempt 作为一个 cluster。报告逐项显示：

- unique Attempt 和 unique Mission；
- minimum samples；
- 主区间宽度；
- missing event rate；
- Verifier coverage；
- exact-route coverage；
- task-type/difficulty balance；
- selection-bias notes。

决策状态是 `NO_DATA`、`EARLY_SIGNAL`、`EXPLORATORY`、
`DECISION_ELIGIBLE` 或 `REGRESSION_ALERT`。样本不足可以给收集建议，不能输出强
排名。

### 9. Flash/Pro 决策

只有 observed model 名称命中 Flash/Pro 且 route 为 exact 的分片进入比较。候选和
基线必须同角色，任务类型与预执行难度可比。报告展示：

- comparison design；
- 双方 Attempt/Mission N；
- final-acceptance 区间；
- 差异区间与 non-inferiority margin；
- covariate balance；
- exact configuration confound；
- safety incidents；
- Accepted Outcome Token、latency 和可用 cost。

至少 3 个共同 Mission 才标记 paired-Mission；其余历史数据明确标记观察性。
硬门先于成本收益。`DECISION_ELIGIBLE` 只表示证据可提交治理评审；
`promotionAllowed=false`，用户仍需显式创建 Canary/Active revision 和治理 receipt。

### 10. 报告结构

#### Part A：Individual Performance

每个 exact configuration 包含：

- 完整 configuration snapshot；
- sample、participation、accuracy、completion；
- capability、reliability、efficiency；
- data-quality criteria 与 failure attribution；
- analyses、recommendations、limitations；
- Evidence refs 与状态。

#### Part B：Overall Performance

- Mission completion；
- Task final acceptance；
- cross-department handoff；
- Radio resolution；
- Freeze recovery；
- specs commit coverage；
- configuration comparisons；
- report decision、blockers 与 recommendation；
- priority recommendations；
- unsupported conclusions。

Schema：

- [`performance-evaluation-request.schema.json`](schemas/performance-evaluation-request.schema.json)
- [`evaluation-attempt-record.schema.json`](schemas/evaluation-attempt-record.schema.json)
- [`frozen-evaluation-dataset.schema.json`](schemas/frozen-evaluation-dataset.schema.json)
- [`agent-template-performance.schema.json`](schemas/agent-template-performance.schema.json)
- [`military-performance-report.schema.json`](schemas/military-performance-report.schema.json)

### 11. 七视图决策中心

绩效评估不再只有一个大 JSON 或混合分数。一个一级选项卡内提供：

1. 决策总览：状态、Mission/Attempt、区间、阻断；
2. 角色/模型比较：Flash/Pro、route、configuration、非劣；
3. 九场景热力图：固定工作台与 Provider 观察分栏；
4. 工具漏斗：选择、Schema、Host、路径、运行、验证、集成、父唤醒；
5. Pareto：质量门之后的 Token/延迟/成本；
6. 数据与 Evidence：Dataset hash、Attempt、纳入/排除、引用；
7. 历史/申诉/实验：不可变 report lineage 和 recompute。

Workspace/Mission 来自 Host 目录，不要求用户手输专业 ID。高级统计渐进披露；默认
界面保持简体中文和 DSH RC.2 原生视觉、键盘、focus 与响应式行为。

### 12. 申诉

用户针对固定 `reportId@revision` 和 finding path 提交 challenge，可附 Evidence、
撤回或由有权限的本地评审者解决。旧 Dataset/Report 永不修改。成立或部分成立时：

```text
明确 authorized exclusions
→ 重新执行原 Request
→ 冻结新 Dataset
→ 生成新 Report
→ 新 Report supersedes 旧 Report
```

重复操作幂等，历史视图可比较 revision、排除项、dataset hash 和 decision 变化。

### 13. 安全与隐私

- 跨 Session 读取和 Artifact Evidence 在 Host 边界授权；
- 只纳入 actual Military Session；
- Restricted 数据按报告 classification 脱敏；
- 委员会模型不读取原始 Session，也不能使用工具；
- Web Client 不获得 SQLite handle、任意文件路径或 Provider credential；
- Dataset 与 Report 的 retention、撤回和派生影响可追踪；
- 报告不能包含 Secret、完整用户提示或无必要客户数据。

RC.2 本地部署是单用户 Profile 边界，不虚构多租户 RBAC。

### 14. 失败与恢复

- Dataset 构建失败：Job `FAILED`，不发布报告；
- 单 configuration shard 失败：持久化失败，重试只补缺失 shard；
- wall-clock timeout：结构化 retryable failure；
- DSH 重启：从 SQLite lease/fence 与 Artifact 恢复；
- stale worker：无法通过 fence 完成；
- committee model 失败：确定性叙述回退；
- report/schema/hash 不一致：拒绝发布；
- appeal recompute 冲突：稳定 idempotency key 返回同一谱系结果。

### 15. 改进建议

建议必须映射到可执行对象和成功指标：

| 观察 | 允许建议 |
|---|---|
| Worker schema first-pass 低 | 缩短工具提示、提供参数模板、增加 contract fixture |
| 路径错误高 | 强化 receipt-bound relative path、PATH_REJECTION 演练 |
| false completion | 收紧 Acceptance、Evidence 和 terminal gate |
| parent wakeup 低 | 修复 completion notification 与 bounded wakeup |
| recovery drift | 冻结 identity/version/fence、恢复前重校验 |
| Flash 质量非劣但样本不足 | 受控 Canary 继续收集同类 Mission |
| 成本低但质量硬门失败 | 先修质量，禁止晋升 |
| Provider cost unknown | 更新带版本的价格目录，不填 0 |

委员会不能自动修改模型、Template Prompt、ToolProfile、PermissionProfile 或 capability。

### 16. 反偏差规则

- 不奖励输出长度或工具调用数量；
- 不让被评配置决定自己的指标；
- 不混合不同 Template/Prompt/Tool/Permission revision；
- 不删除失败、取消或未完成而不留排除理由；
- 不把 fallback/alias 样本归给目标模型；
- 不把同一 Provider Session 的解析器重跑计成新样本；
- 不用成本改善抵消硬门；
- 不从观察性报告声称随机实验或因果结论；
- 不在小样本下输出全局排行榜。

### 17. 验收

实现完成必须证明：

- 同一 Request/权威事件重跑得到相同 Dataset hash 与指标；
- Request、Dataset、Attempt、Individual、Report 全部通过运行时 Schema；
- lease/version/generation 窗口不泄漏旧事件；
- exact route 与 fallback/alias 分层；
- Mission cluster、Wilson/bootstrap 和未知成本边界正确；
- Job 在失败、超时和进程重启后只重跑缺失 shard；
- 申诉产生新 Dataset/Report 并保留原谱系；
- 七视图可理解、可键盘操作且在窄视口不溢出；
- 本地 deterministic 证据与真实付费 Provider 回归分栏陈述。

详细算法见[绩效评估统计、公平性与申诉](docs/48-evaluation-statistics-and-fairness.md)，
运行时状态和数据边界见[绩效评估运行时实现](docs/57-performance-evaluation-runtime.md)。


---

<a id="part-38"></a>

## Part 38：Preset generation、升级与恢复

源文件：`docs/38-preset-generation-upgrade-and-resume.md`

### 1. 问题定义

DSH RC.2 的公开 Agent Preset 身份是字符串 `presetId`。运行中的 standing mount 会在同一进程内保留旧组合，但 Session 持久事实只能稳定解析到 `military`，不能仅凭 DSH 原生字段在进程重启后定位旧的文件内容。因此，`dsh-military` 不能把“会话使用了 military”与“会话使用了哪一个 military generation”混为一谈。

本设计固定公共选择项：

```text
public preset id = military
```

同时将实际组合内容标识为：

```text
presetGeneration = military@sha256:<asset-hash>
```

公共 ID 负责 WebUI 选择和产品身份；generation 负责恢复、审计、兼容和回放。

### 2. RC.2 适配边界

RC.2 本身继续负责：

- 新会话从 preset roster 选择 `military`；
- 空白会话选择后记录 `agent-preset/selected`；
- 常规子代理通过 `composeFrom()` 继承父级 standing scope；
- 会话历史和 DSH Session Persistence；
- 当前进程内的 preset generation 保留。

`dsh-military-preset-generations` 适配器额外负责：

- 计算当前资产哈希；
- 持久保存 [`PresetGenerationManifest`](schemas/preset-generation-manifest.schema.json)；
- 将旧 generation 复制到只读内容寻址归档；
- 在恢复 Agent 发布之前读取 `MilitarySessionBinding`；
- 对当前 generation 执行精确匹配；对同进程仍存在的旧 standing scope 允许继续；RC.2 公共第三方 seam 无法在进程重启后把非空根 Session 重新组装到 archive generation；
- 找不到或不兼容时进入 `QUARANTINED`；
- 生成 [`PresetMigrationOrder`](schemas/preset-migration-order.schema.json)。

该适配器是 RC.2 专用薄层。它不得修改 DSH Session 历史来伪装 generation，也不得在模型请求已经开始后热切组合。

### 3. Generation Manifest

Manifest 至少包含：

- `presetId=military`；
- generation 和资产总哈希；
- `preset.yml`、`agent.cordis.yml` 的逐文件哈希与字节数；
- Bundle 版本；
- 精确 DSH baseline commit；
- public selection id；
- hidden archive id；
- `CURRENT | ARCHIVED | DEPRECATED`；
- 是否为破坏性变化；
- 是否允许直接恢复。

参考资产由：

```bash
python scripts/compute_preset_generation.py
```

生成，并通过：

```bash
python scripts/compute_preset_generation.py --check
```

验证。

### 4. 恢复状态机

```text
read Session + MilitarySessionBinding
  → locate generation manifest
  → verify file hashes and RC.2 baseline
  → compare capability fingerprint
     ├─ current generation exact match → MATCHED
     ├─ old standing scope still live in this process → ARCHIVE_REBOUND
     ├─ process restarted and root requires archived generation → QUARANTINED / MIGRATION_REQUIRED
     └─ unavailable/incompatible → QUARANTINED
```

`MATCHED` 必须发生在 Agent 未发布的 setup transaction 中。`ARCHIVE_REBOUND` 只表示当前进程仍持有可验证的旧 standing scope，或未来部署提供了显式受支持的 generation resolver；**当前 RC.2 Adapter 不对进程重启后的非空根 Session 执行 archive rebind**。失败时回滚创建，不留下半组装 Agent。

恢复成功后记录：

```text
preset/generation-resume-checked
```

恢复失败记录：

```text
military/session-quarantined
```

### 5. 兼容分类

| 变更 | 处理 |
|---|---|
| 文案、UI、非模型可见元数据 | 可保持同一 generation，前提是资产哈希不参与这些外部文件 |
| Prompt、工具 Schema、权限、事件可见投影 | 新 generation |
| 工具名删除、持久事件语义破坏、恢复算法改变 | 新 generation，通常同时发布新公共 major preset id |
| RC.2 Adapter 实现修复但行为兼容 | 新 Bundle 版本，是否新 generation 由 capability fingerprint 决定 |

固定 `military` 是当前 major 产品入口。未来破坏性产品线可使用 `military-v2`，但普通非破坏性升级仍保留 public id `military`。

### 6. Migration

当旧 generation 不再能直接运行时，只允许：

1. `EXPORT_IMPORT`：导出已认证事实、Artifact、决策和 specs 引用，创建新 Military Session；
2. `NEW_PRESET_ID`：转移到明确的新 major preset；
3. `REBIND_ARCHIVE`：只在运行时仍持有对应 standing scope，或部署提供经过兼容验证的 generation-addressable resolver 时使用；当前标准 RC.2 根 Session 重启路径不支持。

迁移必须有用户授权、expected session revision 和过期时间。模型不能自行批准。

### 7. 垃圾回收

一个 archived generation 只有在以下条件全部满足时才能删除：

- 没有可恢复 Session 或 Mission 引用；
- 没有未完成评估和审计引用；
- 所有相关 Session 已迁移、导出或按保留策略删除；
- 管理员批准；
- 删除前生成 Manifest 和引用清单；
- 删除后保留 tombstone。

### 8. 验收条件

- current generation 的 Session 可在重启后恢复；archived-only 根 Session 在模型请求前进入 `QUARANTINED/MIGRATION_REQUIRED`；
- 当前 preset 文件修改不会改变旧 Session 的工具和 Prompt；
- 找不到旧资产时不会调用模型；
- non-Military Session 不读取 generation archive；
- generation 归档文件与 Manifest 哈希一致；
- breaking migration 有明确授权和可审计 Receipt。

### 9. Preset Resume Receipt

每次恢复必须产生 [`PresetResumeReceipt`](schemas/preset-resume-receipt.schema.json)，而不是只返回一个内存枚举。Receipt 固化：

- 请求和实际解析到的 generation；
- `MATCHED | ARCHIVE_REBOUND | QUARANTINED | MIGRATION_REQUIRED`；
- RC.2 Compatibility Report；
- generation archive 哈希；
- Migration Order 和 General Model Selection Receipt（如适用）；
- 支撑恢复结论的 Event/Artifact 引用；
- 开始和完成时间。

Receipt 在 Agent 发布前提交。若 Receipt 无法落盘，恢复事务回滚；不能先启动模型再补记恢复事实。重放器以 Receipt、Session Binding 和 Generation Manifest 三者对账，任何不一致都进入隔离。


---

<a id="part-39"></a>

## Part 39：契约真源与代码生成

源文件：`docs/39-contract-source-of-truth-and-code-generation.md`

### 1. 决策

`dsh-military` 的机器边界采用以下权威顺序：

```text
JSON Schema Draft 2020-12 = wire/storage object truth
contracts/event-catalog.json = event name + payload truth
contracts/error-catalog.json = stable failure code/recovery truth
SQL migrations = physical persistence truth
TypeScript generated/reference contracts = compile-time projection
Markdown = 语义、约束和理由，不重新定义字段
```

自然语言不能覆盖 Schema；TypeScript 不能悄悄增加 wire 必填字段；示例不能充当唯一规范。

### 2. Event Catalog

[`contracts/event-catalog.json`](contracts/event-catalog.json) 为 Mission 与 Administrative Ledger 的唯一事件真源，保存：

- 稳定事件名；
- 标题与说明；
- Payload JSON Schema；
- 可验证示例 Payload；
- RC.2 baseline 元数据。

生成器输出：

- `schemas/mission-event.schema.json`；
- `schemas/administrative-event.schema.json`；
- `reference/types/generated-event-catalog.ts`；
- 两个完整 JSONL Golden Ledger；
- `contracts/EVENT-CATALOG.md`。

任何手工修改生成物都会被 freshness check 拒绝。

### 3. Error Catalog

[`contracts/error-catalog.json`](contracts/error-catalog.json) 是稳定错误码、分类、默认 retryability 和恢复指引的唯一真源。`scripts/generate_error_artifacts.py` 生成：

- `schemas/military-failure.schema.json`；
- `reference/types/generated-error-catalog.ts`；
- `contracts/ERROR-CATALOG.md`；
- 一个合法 Failure 示例。

错误码不得只写在实现或 Markdown 表格中。新增、重命名或删除错误码需要兼容评审；已进入持久 Receipt/Event 的 code 不原地复用。

### 4. Shared Contract Parity

[`contracts/parity-map.json`](contracts/parity-map.json) 指定关键共享对象：

```text
AgentIdentity
ArtifactRef
EvidenceRef
MilitarySessionBinding
GeneralExecutionPolicy
WorkspaceLease
CandidatePatch
EvaluationDatasetManifest
AgentExecutionBinding
PresetResumeReceipt
ResourceBudgetReservation
ResourceUsageReceipt
PerformanceEvaluationAppeal
```

校验器比较 JSON Schema 顶层字段与 TypeScript interface：

- 字段集合；
- required/optional；
- 接口是否存在；
- Schema pointer 是否有效。

其中 JSON Schema 是真源，TypeScript 不一致视为构建失败。

### 5. Schema Versioning

每个持久对象都携带 `schemaVersion`。规则：

- 新增可选字段：minor；
- 新增必填字段、删除字段、改变枚举意义：major；
- 文档澄清和不改变实例集合的约束修复：patch；
- Event 名一旦发布不得复用；
- 旧事件通过 Upcaster 投影到当前读取模型，原始 Event 不改写。

本版将 Ledger Event Envelope 提升到 `2.0.0`，因为 Payload 从开放对象改为判别联合。

### 6. 生成工作流

```bash
python scripts/generate_contract_artifacts.py
python scripts/generate_error_artifacts.py
python scripts/compute_preset_generation.py
python scripts/update_indexes.py
python scripts/build_single_spec.py
python scripts/validate_artifacts.py --write-manifest
python scripts/validate_artifacts.py
```

CI 先以 `--check` 模式验证生成物，再运行 Schema、TypeScript、SQL、状态机和链接检查。

### 7. Contract Review

任何契约 PR 必须回答：

1. 哪个真源改变；
2. 这是 additive 还是 breaking；
3. 是否需要 Upcaster 或 SQL migration；
4. 哪些 Golden Trace 改变；
5. 哪些 preset generation 必须更新；
6. 是否改变模型可见前缀；
7. 是否影响权限或数据分类；
8. 回滚后旧实现是否还能读取新数据。

### 8. 禁止做法

- 在服务实现中定义未进入 Schema 的隐藏字段；
- 仅修改 TypeScript，不更新 Schema；
- 用 `payload: object` 逃避事件契约；
- 把数据库列当作领域语义真源；
- 让模型输出直接写入未校验 JSON；
- 手工编辑生成事件文件；
- 用当前示例推断所有合法实例。

### 9. 验收条件

- 每个 Event Catalog 项都产生合法 Golden Ledger 行；
- Mission/Admin Event Type 与生成 TS 完全一致；
- 关键共享 interface 与 Schema 字段完全一致；
- Schema、生成物和 Manifest 可重复生成；
- 任何漂移在本地校验和 CI 中失败。


### 10. 索引和示例映射

`schemas/INDEX.md` 与 `examples/README.md` 由 `scripts/update_indexes.py` 确定性生成。每个重要持久对象都必须至少有一个映射示例；仅出现在目录但未进入 `contracts/example-map.json` 的 Schema 不算完成契约覆盖。Conformance Trace 使用动态目录映射，但仍必须引用 Event Catalog 中存在的事件。

CI 使用：

```bash
python scripts/update_indexes.py --check
```

防止新 Schema、Golden Trace 或 reference asset 被添加后总览继续报告旧数量。


---

<a id="part-40"></a>

## Part 40：Principal、Tenant 与授权模型

源文件：`docs/40-principal-tenant-authorization-model.md`

### 1. 目标

跨会话战术提炼、军事评估、企业 API、远端 Git 和 Restricted 数据读取都不能只依赖 `requestedBy: string`。系统使用 [`MilitaryAuthorityContext`](schemas/authority-context.schema.json) 统一表达调用者身份和权限。

### 2. Principal 类型

```text
human-user
organization-admin
tactical-admin
model-admin
security-auditor
evaluation-reviewer
service-principal
agent-principal
```

Agent principal 永远不能自行获得人类专属授权。Agent 的权限来自模板、Task Order 和可撤销 Grant 的交集。

### 3. Authority Context

每次管理或高影响命令绑定：

- `principalId`；
- `tenantId`；
- roles 和 scopes；
- Session ownership；
- Workspace membership；
- classification ceiling；
- authorization receipts；
- issued/expiry time。

管理命令不接受模型自由填写的 Context；Host 从认证连接、Session ownership、Settings 权限和凭据服务构造。

Web Remote 同样不能使用固定字符串代替身份。RC.2 本地单用户部署由 Host 创建
明确的 `LOCAL_PROFILE_USER` authority context；未来多用户部署必须从认证
connection 注入 principal/tenant。两者使用同一授权 API，但本地身份不能被
描述成企业 RBAC。

### 4. 授权决策

有效权限为：

```text
principal role scopes
∩ tenant boundary
∩ resource ownership/membership
∩ data classification ceiling
∩ operation-specific receipt
∩ active policy revision
∩ time and use limits
```

任何 deny、revocation、expiry 或分类不满足均拒绝。

### 5. 高影响动作

以下动作必须引用 [`UserAuthorizationReceipt`](schemas/user-authorization-receipt.schema.json)：

- GitHub push、PR、远端分支写入；
- 生产部署或外部付费 API；
- Restricted 数据出域；
- 跨用户 Session 提炼；
- 组织级战术发布；
- 删除战术源和派生知识；
- 迁移或删除旧 preset generation；
- 扩大评估委员会的数据范围。

Receipt 指定 action、resource、constraints、来源消息、内容哈希和 expiry，不允许用“用户之前好像同意过”代替。

### 6. 跨会话规则

#### 战术提炼

用户只能默认提炼自己拥有的 Session。Workspace/组织级数据需要相应管理员 Scope，并受来源许可证约束。

#### 军事评估

Dataset Auditor 只读取：

- actual preset=`military`；
- 属于请求 tenant；
- 在授权时间范围和 Workspace/Mission filter 内；
- 数据分类不超过报告策略；
- 未被 retention/revocation 排除。

Examiner Agent 只获得去标识化 Dataset shard，不获得任意 Session 查询能力。

### 7. Agent 权限

角色权限是三层交集：

```text
hard role invariant
∩ versioned PermissionProfile
∩ current Task/Guidance scope
```

Permission Profile 使用 deny-first，并定义文件、Git、网络和分类边界。Tool Profile 只控制可见和可调用工具，不替代 Sandbox、Guard 或 Authority Check。

### 8. 撤权

撤权事件立即提高安全边界：

- 下一次工具准入前生效；
- 正在执行的可取消 I/O 收到 Abort；
- 已产生 Artifact 保留审计但不再授权新读取；
- 已发 Guidance 保留来源，禁止新增受撤权资源调用；
- 受影响 Task 进入 revalidation 或 freeze。

### 9. 审计

每次决策记录：

```text
principal
resolved tenant
roles/scopes
policy revisions
authorization receipt
decision
reason
resource
classification
time
```

不得把 Secret、Token 或原始凭据写入审计日志。

Artifact 读取审计记录 Reference 身份，而不是只记 content hash。Reference
必须通过 tenant、workflow、audience/grant、scope、classification ceiling 和
expiry；相同 blob 的另一个合法引用不能为当前 principal 提供旁路。

### 10. 验收条件

- 普通用户不能评估或提炼他人会话；
- Advisor 不能读取未授予的企业 API；
- revoked Grant 在下一次调用前失效；
- Agent 不能伪造 human authorization；
- 报告和战术继承正确分类；
- tenantId 在管理事件和关键存储表中必填。


---

<a id="part-41"></a>

## Part 41：Workspace 隔离、补丁与集成协议

源文件：`docs/41-workspace-integration-and-merge-protocol.md`

### 1. 决策

Thinking Worker 不直接在受控本地 `main` 上并行写入。每个写 Task 使用独立 Workspace Lease 和快照，产出 Candidate Patch；只有 Harness Integration Executor 能把已验收补丁应用到受控 `main`。

```text
Task Order
→ Workspace Snapshot
→ isolated worktree / copy-on-write sandbox
→ Worker Candidate + CandidatePatch
→ Verification on frozen snapshot
→ ACCEPTED
→ Integration Queue
→ apply on controlled local main
→ global regression
→ Integration Receipt
→ Engineer specs maintenance
→ local main commit checkpoint
```

### 2. Workspace Snapshot

[`WorkspaceSnapshot`](schemas/workspace-snapshot.schema.json) 固化：

- tenant/workspace identity；
- path hash；
- repository id、HEAD、branch、tree；
- dirty-state hash；
- 文件清单 Artifact；
- 环境 Artifact。

Task Context 引用 Snapshot ID，不复制不受控的“当前目录状态”。

### 3. Lease

[`WorkspaceLease`](schemas/workspace-lease.schema.json) 绑定：

- Mission、Task 和 version；
- Agent identity；
- Snapshot；
- READ/WRITE；
- path scope；
- lease version 和 expiry。

同一 path/resource 的冲突写 Lease 不能同时激活。普通非 Military 会话不受 Military Lease 阻塞；如果它修改文件，Military 通过新的 snapshot/hash 检测环境漂移。

### 4. Candidate Patch

Worker 提交 [`CandidatePatch`](schemas/candidate-patch.schema.json)：

- base snapshot；
- patch Artifact 和 hash；
- changed paths；
- apply mode；
- preconditions。

Patch 不等于接受；Candidate Verification 必须同时校验：

- patch 可在 base snapshot 干净应用；
- changed paths 在 Task Scope；
- Worker 没有修改 `.git`、specs 或禁止路径；
- 测试、类型、lint 和策略通过；
- Artifact hash 与实际内容一致。

### 5. Integration Order

ACCEPTED 后 Harness 创建 [`IntegrationOrder`](schemas/integration-order.schema.json)：

- expected local-main HEAD/tree；
- candidate patch；
- 目标 `main`；
- 冲突策略；
- 全局 verifier profiles；
- Harness 授权者。

Worker、Advisor 和 Engineer 不能自行创建或执行该 Order。

### 6. Integration Executor

Executor 是确定性受限组件，不是自由模型角色。它只能：

1. 获取 local-main integration lease；
2. 检查 expected HEAD/tree；
3. 创建临时集成 worktree；
4. 应用 patch；
5. 运行指定全局回归；
6. 成功时生成 commit；
7. 原子更新受控 local main；
8. 写 [`IntegrationReceipt`](schemas/integration-receipt.schema.json)。

禁止 push、force、rebase public history、任意脚本注入和绕过 verifier。

### 7. 冲突

若 HEAD/tree 已变化或 patch 冲突：

```text
IntegrationReceipt.disposition = STALE / CONFLICT
→ IntegrationConflictReport
→ invalidate old integration order
→ create rework or join task
```

模型可建议冲突解决，但必须在新 Workspace Snapshot 上产生新 Candidate。

### 8. Specs 与 commit

代码 Integration 与工兵 specs 更新是两个不同阶段：

- Integration Executor 落地已验收代码；
- Engineer 读取 Integration Receipt 和实际 Diff；
- Engineer 维护 specs/traceability；
- Engineer 只在本地 main 创建维护 commit；
- Wave Barrier 同时要求代码回归和 specs commit。

若策略要求代码和 specs 同一 commit，可由 Integration Executor 在 Engineer 产出已验收 specs patch 后组成一个 join integration order；仍不能让 Worker 直接 commit main。

### 9. 崩溃恢复

- patch applied、Ledger 未写：根据 integration marker 和 Git commit trailer补写 Receipt；
- Ledger 写 queued、尚未应用：幂等重试；
- regression 失败：丢弃临时 worktree，不移动 main；
- main 已移动、Artifact 写失败：从 Git 对象重建 Artifact；
- 进程重启：按 Integration Order 和 repository marker 恢复。

### 10. 验收条件

- 未验收修改从不进入 local main；
- 并行 Worker 不共享写工作树；
- stale patch 不静默重放；
- 全局回归失败不移动 main；
- 普通 DSH 会话修改只造成漂移检测，不被 Military 冻结；
- 每个接受 Task 可追踪到 Snapshot、Patch、Verification 和 Integration Receipt。

### 11. Specs 工作区控制面

RC.2 没有外部 Client 可调用的原生目录选择 seam。`militaryWorkspace/snapshot`
因此只从当前租户 `military_session_bindings` 的绝对 workspace 产生不透明
`workspaceId`；Client 不能提交路径。

`INSPECT_WORKSPACE(workspaceId)` 重新 realpath 并验证 root hash，读取实际 Git
HEAD/branch/tree/porcelain 状态，再与 Workspace snapshot/lease、Task path
policy、Candidate、Integration order/receipt 组合。返回：

- canonical root 和 hash；
- dirty/untracked 与 rename destination；
- `READ_WRITE/READ_ONLY/FORBIDDEN/SPECS_DEFAULT/UNSCOPED` 路径；
- live lease/worktree；
- Candidate/Integration/receipt；
- 按实际角色和 Task 生成的相对路径示例。

目录中不存在或已不可访问的 ID、symlink escape 和跨 Session 根均失败关闭。
该页面是执行链的只读 projection，不授予 Lease、不改 Git、不创建 Workspace。


---

<a id="part-42"></a>

## Part 42：物理存储、事务与迁移设计

源文件：`docs/42-physical-storage-and-migration-design.md`

### 1. 存储分层

RC.2 完整版默认提供 SQLite + 本地内容寻址 Artifact Store，接口允许替换 PostgreSQL 和对象存储。

```text
DSH Session Persistence  → 原始会话和模型可见历史
Mission Ledger           → 单 Mission 权威事件
Administrative Ledger    → 跨会话治理事件
Projection Store         → 可重建查询模型
Radio Store              → 请求、租约、投递与死信
Artifact Store           → 内容寻址大对象
Policy Store             → 模板、权限、工具、API、模型能力
Generation Store         → preset manifest 与只读资产
```

### 2. SQLite 参考

参考 DDL 位于：

- [`reference/sql/0001-core.sql`](reference/sql/0001-core.sql)
- [`reference/sql/0002-indexes.sql`](reference/sql/0002-indexes.sql)
- [`reference/sql/0003-projections.sql`](reference/sql/0003-projections.sql)
- [`reference/sql/0004-governance.sql`](reference/sql/0004-governance.sql)

可执行源码 migration 位于 `packages/storage-sqlite/src/migrations/`，当前连续为
`0001`—`0010`；`0009` 增加 outbox runtime/receipt/offset，
`0010-command-saga.sql` 增加外部 effect checkpoint。

关键唯一约束：

```text
UNIQUE(mission_id, seq)
UNIQUE(mission_id, idempotency_key)
UNIQUE(tenant_id, administrative_seq)
UNIQUE(request_id)
UNIQUE(guidance_id)
UNIQUE(compaction_id, assessment_kind)
UNIQUE(integration_order_id)
UNIQUE(decision_set_id, version)
```

### 3. 事务规则

#### 同步短事务

`SqliteMilitaryDatabase.transaction()` 只接受同步 callback。返回 Promise 或
thenable 会 rollback 并抛出 `SQLite transaction callbacks must be synchronous`。
因此模型、Provider、Git、文件系统和长验证一律在事务外运行。

#### Command Saga + Outbox

Mission command 使用三个短阶段：

```text
tx 1: validate revision + append admission + PENDING_EFFECT lease
outside tx: execute stable idempotent/queryable operation
tx 2: persist EFFECT_APPLIED result checkpoint
tx 3: command receipt + transactional outbox + COMMITTED fence
```

effect failure 进入 `RETRYABLE`；进程在 effect 后、receipt 前崩溃时保留
`EFFECT_APPLIED` 并只补 finalization。Projection、异步 Agent 调度和补偿
settlement 从 Outbox 消费。不能先报告命令完成再写 receipt。

Outbox 实现 claim lease、retry/backoff、dead-letter、delivery receipt 和
partition offset；相同 eventId 幂等，单 partition 保序。

#### Artifact

```text
write temp bytes
fsync
compute hash
atomic rename into content-address path
insert metadata/ref transaction
```

如果 metadata 失败，孤儿对象由 GC 扫描；如果对象已存在，验证长度和 hash 后复用。

#### Radio

`lease` 使用 CAS：

```text
state=QUEUED AND visibility_until < now
→ state=LEASED, lease_owner, lease_version+1
```

Guidance persist、outbox 和 request completion 同事务。实际投递是幂等 Inbox 操作。

#### Git Integration

Git 不能和 SQLite 形成单一原子事务，因此使用 Saga 和 repository marker：

1. Ledger `integration/started`；
2. 在临时 worktree 产生 commit；
3. 写 commit trailer `Military-Integration-Order`；
4. CAS 移动 local main；
5. 写 Receipt；
6. 崩溃时根据 trailer 对账。

#### Workspace

Workspace Snapshot、Lease、Candidate Patch、Integration Order/Receipt 写入同一
生产 Store。启动 reconciliation 只收养可证明归属的 worktree，隔离可证明过期
的 worktree；未知状态停止并等待核验，不先递归删除。

### 4. Snapshot 和 Projection

Mission Snapshot 是性能优化，不是真源。每个 Snapshot 记录：

- last event seq；
- aggregate revision；
- reducer version；
- state hash；
- createdAt。

Reducer 版本改变时丢弃旧 Projection 并重放 Event。

### 5. Migration Ledger

每个数据库 migration 具有：

```text
migration_id
checksum
applied_at
bundle_version
dsh_baseline
rollback_class
```

分类：

- `REVERSIBLE`：提供 down migration；
- `FORWARD_FIX`：只能前向修复；
- `DATA_REWRITE`：需要备份、校验和双读；
- `DESTRUCTIVE`：必须用户授权和导出。

### 6. Upcaster

Event 原文不可改写。读取时按 schemaVersion 依次 Upcast：

```text
v1 raw event
→ v1-to-v2 upcaster
→ current reducer input
```

Upcaster 必须纯函数、可重复、带 Golden Trace。无法 Upcast 时 Mission 进入只读隔离。

### 7. 多租户

所有管理表和跨会话索引必须含 tenantId。Mission 表也保存 tenantId，查询必须以 tenant scope 为首个谓词。Artifact Ref 授权不能只凭 hash；相同内容 hash 不授予跨 tenant 读取权。

### 8. 备份与恢复

- SQLite 使用在线 backup API 或停写快照；
- Artifact Store 先标记 snapshot epoch，再复制；
- Generation Store 必须与 Session Binding 同时备份；
- 恢复后运行 Event hash、Artifact hash、Git marker 和 Projection 对账；
- 不完整恢复只允许 `DEGRADED_READ_ONLY`。

### 9. 保留与删除

删除是治理流程：

- Session、Mission、Artifact、战术源和报告有独立 retention；
- 引用计数不替代授权；
- legal hold 优先；
- 删除源触发 knowledge impact analysis；
- 删除 generation 前检查可恢复 Session；
- 管理员操作写 Administrative Ledger。

### 10. 验收条件

- 事件 append 幂等且 CAS 生效；
- Projection 可从零重建；
- Git/DB 崩溃点均有补偿；
- tenant 查询不能越界；
- migration checksum 漂移失败；
- 备份恢复后 Golden Mission hash 一致。


### 11. 治理表补充

`0004-governance.sql` 还冻结：

- `agent_execution_bindings`：精确 Agent generation、模板、模型和 preset generation；
- `preset_resume_receipts`：跨重启解析与隔离结论；
- `budget_reservations` / `budget_usage_receipts`：CAS 预留和幂等结算；
- `performance_evaluation_appeals`：不可变报告的申诉链；
- Authority、Policy、Tactical Source、Evaluation、Compaction 和 Bundle Receipt。

这些表保存完整 canonical JSON，同时用少量索引列支撑租户、状态、revision 和恢复查询。JSON 字段不能绕过 Schema；写入前和重放时都必须验证。


---

<a id="part-43"></a>

## Part 43：General 模型与会话策略优先级

源文件：`docs/43-general-model-and-session-policy-precedence.md`

### 1. 用户决策

General 的初始默认模型由固定 `military` preset 提供。独立侧栏入口
`Military 设置中心 → Military-部门模型` 通过 `military-model-routing` 可视化
修改后续 General 默认 route；它不属于 `military-agent-templates` 部门 registry。
用户仍可在 DSH WebUI 会话模型选择器中更换当前 General 模型。

子 Agent 不跟随 General 的会话模型切换。它们继续使用各自冻结的 `AgentTemplateProfile` revision。

### 2. RC.2 实现

Preset 中挂载 agent-scoped 插件：

```yaml
- id: military-general-model-default
  name: '@dsh-military/bundle/general-model-default'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    reasoningEffort: high
    maxTokens: 16384
```

该插件在 `agent/request` 仅对 root General 生效：

- 若 DSH Session 已存在显式 provider/model，保持不变；
- 若未选择，填充 preset 默认；
- 不覆盖子 Agent 的 `AgentOptions`；
- 把 DSH live exact route 投影为 Military 执行能力；
- 在请求边界把 Military workload intensity 翻译为 adapter-owned reasoning；
- 将 effective route 写入请求事实和 Military 选择 Receipt。

### 3. 优先级

```text
1. 当前 Session 的用户显式模型选择
2. 新建会话时用户显式模型选择
3. `military-model-routing` 保存的 General default
4. military preset 编译时默认（Flash/high/16K）
5. 显式兼容 fallback（仅策略允许）
6. 无合法路由则 fail closed
```

DSH 全局默认不能静默覆盖 military preset 默认。仅当 preset 策略明确 `allowGlobalDefaultFallback=true` 且能力验证通过时才可使用。

### 4. Reasoning 与全 Provider 适配

用户选择改变 provider/model。Military 的 `high/max` 表示工作负载强度，
DSH 的 reasoning effort 则由 exact adapter 拥有：

```text
requested workload = high | max
effective wire effort =
  exact supported value
  | adapter default
  | adapter preferred value
  | omitted when the model has no reasoning control
```

因此第三方 Provider 使用自定义 effort 名称或不支持显式 reasoning 时，Military
不会在模型选择阶段拒绝。DSH `prepareCall` 仍是最终 exact-route 参数校验权威；
Provider 返回的真实错误会被记录，插件不会用另一个模型静默替换。

### 5. 模型选择事件

成功选择生成 [`ModelSelectionReceipt`](schemas/model-selection-receipt.schema.json) 并记录：

```text
model/selection-changed
```

包含：

- provider/model；
- 来源：preset default、新会话选择、Session selector 或 resume；
- 前一模型；
- capability profile；
- 选择者；
- 有效 reasoning。

普通 DSH `/model` 历史仍由 DSH 自己保存；Military Receipt 用于能力和绩效审计。

### 6. Resume

恢复时：

1. 先恢复准确 preset generation；
2. 读取 DSH 当前 Session model selection；
3. 若历史有显式选择，验证当前 capability profile；
4. 若无显式选择，应用该 generation 的 preset default；
5. 模型已下线时只使用显式兼容 fallback，否则 `QUARANTINED` 或请求用户选择。

旧 generation 的 default model 也属于 generation 资产，不能用新 preset default 偷换。

### 7. Context Policy

General context policy随 preset generation 固化，默认示例：

```text
budget 128k
trigger 78%
retained tail 24k
failure → PAUSE_AND_ESCALATE
```

用户切换模型后 effective budget 按当前 Session route 动态收窄：

```text
min(preset General budget, selected model context window)
```

若切换后当前上下文已超过 effective budget，先安全 compaction/handoff，再允许下一次模型请求。

### 8. Fallback

模型状态不会触发自动 fallback。只有用户或显式治理策略选择另一个 exact route
时才改变 provider/model，并记录新的选择 Receipt；绩效状态不能偷偷改路由。

### 9. 设置页面

- `Military 设置中心` 是与“知识与技能”相邻的侧栏入口，点击打开原生 Modal；
- General 虽不是 Department Template，但显示在“Military-部门模型”首张配置卡；
- 模型下拉框读取 DSH `llm.models` live 目录；官方与第三方 Provider 默认可用；
- General 可视化配置 provider/model、reasoning 和 max output；
- General 的插件自带简体中文提示词直接显示并可编辑；空
  `generalPromptOverride` 表示使用自带版本；
- `VALIDATED/CANARY/UNVERIFIED/DEPRECATED` 只作为能力或绩效 Evidence 展示，
  不阻断 live route；目录中不存在的旧路线禁用并说明原因；
- 每个子 Agent 模板仍有独立下拉框；提示词 override 与模型设置一起进入下一
  immutable revision；
- Tool/Permission、authority、termination 和安全不变量不随模型选择改变。

### 10. 验收条件

- 新 Military Session 未显式选模型时使用 preset default；
- 用户切换后下一请求使用新模型；
- 子 Agent 不随 General 切换；
- 无 reasoning 或自定义 reasoning 的 DSH 模型按 adapter vocabulary 执行；
- 恢复保留历史显式选择；
- 非 Military Session 不受该 request listener 影响。


---

<a id="part-44"></a>

## Part 44：用户决策 Broker 状态机

源文件：`docs/44-decision-broker-state-machine.md`

### 1. 背景

DSH RC.2 中 delegated child 不能直接调用 `ask_user_question`。Advisor、Chief、Worker 和 Engineer 只能提交结构化 `DecisionQuestionSet`；根 General 通过 `MilitaryDecisionBroker` 统一展示、回答和回送。

### 2. 状态

[`DecisionBrokerRecord`](schemas/decision-broker-record.schema.json) 使用：

```text
CREATED
QUEUED
PRESENTED
PARTIALLY_ANSWERED
ANSWERED
EXPIRED
CANCELLED
SUPERSEDED
STALE
DELIVERY_FAILED
```

终态不可回到可展示状态。新问题必须创建新 ID 或显式 supersede。

### 3. 创建准入

问题集必须包含：

- stable decisionSetId；
- origin Agent/Session；
- root Session；
- Mission/Task/version；
- 用户拥有的决策理由；
- 可选项、推荐项和影响；
- expiry；
- 幂等键。

Broker 拒绝：

- 可通过工具侦察回答的问题；
- 重复问题；
- 已 stale 的 Task version；
- 请求 Agent 已冻结且问题不再有效；
- 试图索取隐式高风险授权；
- 超出 question budget。

### 4. 排序和合并

优先级：

```text
CRITICAL safety/authorization
→ HIGH blocking decision
→ NORMAL planning choice
→ LOW preference
```

可合并条件：同一 root Session、同一 user-owned decision domain、兼容 expiry、没有相互冲突的 version。合并后保留每个 origin 和回送路由。

### 5. 展示

General 在安全 Turn 边界：

1. lease 下一 Record；
2. 再次验证 Mission/Task version；
3. 将选项转成 DSH `ask_user_question`；
4. 记录 `decision/question-presented`；
5. 等待用户或取消信号。

问题 UI 关闭、浏览器断线或 Agent compaction 不丢失 Record。恢复后若 DSH 工具调用未完成，Broker 根据 presentationId 对账。

### 6. 部分回答

多问题集合允许部分回答：

- 已回答项写 Answer Receipt；
- 未回答项保持 `PARTIALLY_ANSWERED`；
- General 可重新展示剩余项；
- 新的 Task version 只使相关问题 stale；
- 禁止把未回答项自动解释为默认授权。

### 7. 并发

- 同一 decisionSet version 只有一个 active presentation lease；
- 多个浏览器标签页使用 presentation revision CAS；
- 第一个有效回答提交，后续收到 `ALREADY_ANSWERED`；
- 答案落盘后再回送 origin Agent；
- origin Agent 已销毁时答案进入 Mission Decision Record，由 Staff 重新规划。

### 8. Expiry 与 Stale

Expiry 策略由问题类型决定：

- 普通偏好：暂停相关 Task；
- 安全授权：拒绝动作；
- 外部副作用：不得默认；
- 低风险可逆实现选择：只有 Mission Intent 已明确允许默认时才可使用推荐项，并记录政策来源。

Task version、Mission cancel、Change Order、origin replacement 都可使 Record stale。

### 9. Compaction

未决 Decision Record 是强保留内容。Compaction 摘要只引用 ID，完整问题和回答保存在 Broker/Artifact Store。General generation handoff 必须重新注入 pending Record 投影。

### 10. 验收条件

- 子 Agent 不能直接弹窗；
- 多个问题按优先级串行展示；
- 多标签页不会重复提交；
- 断线后可恢复；
- stale 问题不回送旧 Task；
- 没有回答不能产生高风险授权；
- 所有答案可追踪到用户、presentation 和来源 Agent。


---

<a id="part-45"></a>

## Part 45：RC.2 能力探测与兼容矩阵

源文件：`docs/45-compatibility-probe-and-feature-matrix.md`

### 1. 固定基线

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

版本字符串只是必要条件。启动时必须同时核对 release、commit、公开 seam 和部署组合。

### 2. Probe 项

`CompatibilityReport` 至少检查：

- Agent Preset：resolve、mount、composeFrom、composedPreset；
- Agent：pre-step、request、turn-stopping、model selection；
- Subagent：startContinuable、reserved childId、report delivery、selective drain；
- Command：attachments invocation 和 image admission；
- Session persistence 与 projection；
- Settings Host service 与 RC.2 shared client mirror；
- 可选 Conversation Node seam、client module table 和 package manifest；
- Compaction lifecycle；
- Tool guard/result；
- DeepSeek reasoning efforts、input modalities 和 usage；
- SQLite migration、generation manifest、Activity reconciliation。

### 3. Disposition

| 状态 | 允许行为 |
|---|---|
| `READY` | 核心 Military 运行能力；可选 Web 运行视图缺失以 warning 报告 |
| `DEGRADED_READ_ONLY` | 读取、导出、评估历史；禁止新 Mission 和写 Activity |
| `MIGRATION_REQUIRED` | 只显示迁移与诊断 |
| `UNSUPPORTED` | 不暴露可选 Military preset |

关键 seam 缺失时 fail closed，不能以更弱行为静默继续。

### 4. 已确认差异

| Surface | RC.2 状态 | Military 处理 |
|---|---|---|
| Preset/composeFrom | 公开 mount/composeFrom seam 可用 | Preset scope 组合并验证 actual preset |
| Agent/Model Selection | 相同 | General 规则不变 |
| Tool Pipeline | 相同 | Grant/Freeze/Verification 不变 |
| Subagent report | `wakeup` → `next-step` | RC.2 adapter 映射 |
| Subagent start | 支持预留 `childId` | Provisioning 先持久化 |
| Subagent drain | 支持指定直属 child | Wave/Committee 精确清理 |
| Command | images + attachments | `/brainstorm` 可接收图片 |
| Web Settings | 共享 describe mirror | 删除重复 reader/invalidation |
| Client build | manifest/external 规则加强 | peer/dev 和 `dsh.client` 校验 |
| DeepSeek | vision、图片预算、全 reasoning passback | Model/Context/Budget 扩展 |
| Agent Team | experimental | 仅非权威投影 |
| External Session events | 无 required-event 注册面 | 不写 `military/*`；使用 Military Ledger/Remote |

### 5. CI Fixture

- preset picker、nonblank lock、same-cwd isolation；
- General preset default、用户模型切换与拒绝；
- reserved childId、duplicate-id reconciliation；
- quiet/next-step report、selective drain；
- `/brainstorm` 文本/图片与取消窗口；
- Settings shared mirror 与 revision conflict；
- Settings shared mirror；未来插件自有 Mission Projection replay；
- DeepSeek text/vision admission 与 reasoning usage；
- Candidate → Verify → Integrate → specs commit；
- RC.2 多次启动恢复、旧 generation quarantine 和显式迁移。


---

<a id="part-46"></a>

## Part 46：安装、升级、回滚与卸载

源文件：`docs/46-install-upgrade-rollback-uninstall.md`

### 1. 生命周期

Bundle 生命周期是受控事务：

```text
PLAN
→ BACKUP
→ APPLY ASSETS
→ APPLY PROFILE OVERLAY
→ MIGRATE STORAGE
→ PROBE
→ COMMIT
```

失败进入：

```text
ROLLBACK
→ VERIFY LAST KNOWN GOOD
→ REPORT
```

每次操作输出 [`BundleLifecycleReceipt`](schemas/bundle-lifecycle-receipt.schema.json)。

### 2. 安装

安装器必须：

1. 获取 profile revision；
2. 读取完整 `agent-presets` row；
3. 检测 `military` ID 和 root 冲突；
4. 安装 immutable generation assets；
5. 追加 system preset root，保留原 `default/roots/includeUserRoot`；
6. 安装 Host、Client 和 Settings rows；
7. 运行数据库 migration；
8. 执行 `dsh --dump-config` 等价校验；
9. 运行 Compatibility Probe；
10. 原子提交 overlay。

不自动把 `military` 设为默认。

#### RC.2 本地发行安装

`0.9.0-alpha.28` 标准安装只把自包含 Bundle 添加为 Profile layer；Installer 已
嵌入 Bundle：

```bash
cd release
shasum -a 256 -c checksums.sha256

dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.28.tgz

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install install \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install verify \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"
```

独立 `dsh-military-installer-0.9.0-alpha.28.tgz` 只用于 preset-only 生命周期，
不能作为 DSH Bundle layer 添加。Profile 使用 `file:` 引用时，安装中的旧 tarball
在该 Profile 升级并验证前必须保留。

### 3. 升级

升级前冻结新 Military Mission admission，允许运行中安全收敛。步骤：

- 备份数据库、generation store 和 profile；
- 计算新 preset generation；
- 旧 generation 转 `ARCHIVED`；
- 运行 forward migration；
- 对内置不可变模板按顺序补齐已发布的中间 revision，禁止跨 revision gap
  直接改写；高于当前内置 revision 的用户配置保持原样；
- 启动 shadow probe；
- 对 Golden Mission 重放；
- 切换新会话到 current generation；
- current-generation Session 可继续恢复；archived-only 根 Session 在重启后必须隔离并显式迁移，不能静默挂到新 generation。

破坏性升级必须引入新 major preset 或 Migration Order。

本地 tarball 升级顺序是：构建并校验新 release、保留旧 immutable tarball、
执行 `dsh plugin add` 替换 layer、运行 Installer `install`/`verify`、重启 Web、
验证 Loader/Preset/两个侧栏入口和控制中心 Remote，最后才归档不再被任何
Profile 引用的旧 tarball。不得先清空 `release/`，否则 pnpm 无法解析当前
Profile 的旧 `file:` 依赖。

### 4. 回滚

回滚不删除升级期间产生的新 Event。要求：

- 旧二进制可读取或忽略新 additive data；
- 数据库 migration 标记 rollback class；
- profile 和 current generation 指针恢复；
- 新 generation 变 archived；
- 新 Session admission 使用旧 known-good；
- 已在新 generation 创建的 Session 保持其 generation 或隔离。

如果数据不可逆，回滚转换为 forward-fix，不伪装成功。

本地回滚必须使用原始旧 Bundle tarball 和升级前备份：

1. 停止 Web admission；
2. 校验旧 tarball SHA-256；
3. `dsh plugin --profile web add <旧 bundle.tgz>`；
4. 恢复兼容的 preset generation 指针/profile 备份；
5. 运行 Installer `verify` 和 Compatibility Probe；
6. 启动 Web，检查历史 Session 的 generation disposition；
7. 保留 alpha.17 期间产生的 Ledger、Skill、benchmark 和 recovery receipt。

### 5. Disable

Disable 仅停止：

- 新 Military Session 选择；
- 新 Mission admission；
- 异步研究和评估调度。

它不删除数据，也不让现有 Military Session 改成 Standard。现有 Session 可只读导出或按策略收敛。

### 6. Uninstall

用户选择数据处置：

```text
RETAINED
EXPORTED_AND_REMOVED
REMOVED
```

卸载前列出：

- 可恢复 Session；
- 未完成 Mission；
- preset generations；
- 私有战术和源；
- 绩效报告；
- Artifact bytes；
- legal hold。

没有显式授权不得删除。

卸载移除 active profile rows 和 public preset root，但保留 tombstone，让历史 UI 显示“Military Bundle 未安装”，而不是错误解释为普通 Session。

### 7. 冲突

若部署已有 user preset id=`military`：

- 安装失败；
- 显示来源和路径；
- 不覆盖、不 shadow；
- 用户可重命名自己的 preset 或选择不同产品 major id。

### 8. 安全

安装器不接受模型提供的任意文件路径或包名；资产来自签名/校验后的 Bundle。Profile 写入使用 revision CAS，临时文件 + fsync + rename。

### 9. 验收条件

- 安装保留现有 preset roots/default；
- 失败自动恢复 profile；
- 升级后旧 Session 可被精确识别；current generation 可恢复，archived-only 根 Session 安全隔离并可迁移；
- 回滚后新数据不丢失；
- disable 不干扰 Standard Session；
- uninstall 有可审计数据处置；
- 同名冲突不被覆盖。


---

<a id="part-47"></a>

## Part 47：私有战术知识供应链

源文件：`docs/47-tactical-knowledge-supply-chain.md`

### 1. 目标

从 Session 或用户经验提炼战术不仅是文本摘要，还涉及来源权利、真实性、时效、污染、派生关系和撤回。每个候选必须有 [`TacticalSourceSnapshot`](schemas/tactical-source-snapshot.schema.json)。

### 2. 来源权利

Snapshot 记录：

- source owner；
- license；
- allowed use；
- allowed audience；
- derivative work；
- retention/revocation policy；
- classification；
- source preset；
- 时间有效性和依赖版本。

`UNKNOWN` license 只允许个人隔离草稿，不允许 Workspace/组织发布。

### 3. 供应链阶段

```text
Authorization
→ Immutable Snapshot
→ Secret/PII scan
→ Prompt-injection isolation
→ Source trust and rights check
→ Extraction
→ Contradiction and temporal validation
→ Reproduction / corroboration
→ User diff review
→ DRAFT
→ Simulation
→ Canary
→ Testing
→ Stable
```

每个阶段都保留 input/output hash、模型、Prompt version、工具和 reviewer。

### 4. 知识投毒防护

不能因为文本来自历史会话就认为正确。检查：

- 是否为模型无证据结论；
- 是否引用真实工具结果；
- 是否仅对旧库版本有效；
- 是否与当前官方 API/内部规范冲突；
- 是否包含恶意“忽略系统指令”；
- 是否把临时 workaround 包装成最佳实践；
- 是否有独立重现；
- 来源是否彼此独立。

模型提取内容与指令通道隔离，来源文本永远是 data，不获得控制权。

### 5. 补充与冲突

新增内容先与已有版本做：

```text
semantic similarity
precondition overlap
contradiction detection
version compatibility
failure-mode comparison
```

结果可能是：

- `NEW_TACTIC`；
- `SUPPLEMENT`；
- `CONFLICTING_VARIANT`；
- `NO_ACTION`；
- `QUARANTINE_EXISTING`。

不能自动覆盖 Stable 版本。

### 6. 撤回

[`KnowledgeRevocationOrder`](schemas/knowledge-revocation-order.schema.json) 可因：

- owner request；
- license change；
- security incident；
- proven incorrect；
- retention expiry。

执行：

```text
source revoked
→ derive impact graph
→ quarantine affected tactic versions
→ find Guidance and accepted Tasks
→ risk-based revalidation
→ redact reports if necessary
→ notify users
```

历史 Event 不删除；敏感内容通过 Artifact access revoke 和合规 tombstone 处理。

### 7. 派生图

必须支持：

```text
SourceSnapshot
→ ExtractionCandidate
→ TacticVersion
→ Guidance
→ TaskAttempt
→ AcceptedResult
→ TacticalMemory / PerformanceReport
```

任何节点都能反向追踪来源和正向评估影响。

### 8. 发布治理

- 个人 DRAFT：来源 owner 可批准；
- Workspace Canary：Workspace tactical admin；
- 组织 Stable：双人审批 + security/license gate；
- Restricted：指定数据管理员；
- Museum 只能提出版本，不单独发布。

### 9. 时效

战术可配置 `reviewAfter`、dependency range 和 expiry。依赖升级时自动转 `REVIEW_REQUIRED`，不继续以 Stable 自动指导。

### 10. 浏览器透明度

`militaryPrivateSkills/snapshot` 只投影经过 Host 校验和清洗的材料：

- sanitized snapshot 的 hash、media type、长度、截断状态和校验状态；
- redaction/injection receipt；
- 每个 Chunk 的稳定范围、hash、提取状态、尝试次数和 extractor exact route；
- Candidate、review receipt、Skill version、promotion、Usage、继承来源和
  revocation lineage；
- 可投放的公开说明和受限、截断后的预览。

Raw Vault reference、原始 Secret/PII、SQLite 路径和未授权正文不进入浏览器。
Artifact bytes 在投影前重新验证 SHA-256；不匹配时失败关闭。

### 11. 模拟召回

用户可输入一段任务说明和 state token budget 预览召回结果。模拟：

- 不创建 Mission/Task；
- 不调用 Provider；
- 不授予 Tool/Grant；
- 不保存任务原文，只保存 SHA-256 和字符数；
- 与真实 `attachTaskTactics` 使用同一个 tag resolver、lifecycle/rank 规则、
  tenant/source-rights eligibility、候选上限和 applicability-card renderer。

结果包含 exact `skillId@version`、rank、匹配标签、入选原因、被排除版本和原因，
以及真实 Task context 会获得的 exact delivery block。这样可以审计召回而不把
“模拟看起来合理”误当成实际运行证据。

### 12. 验收条件

- 没有来源权利的内容不能组织发布；
- 恶意会话文本不能影响系统指令；
- 错误来源可追踪所有派生使用；
- 撤回后禁止新 Guidance；
- 历史审计仍完整；
- 每个 Stable 战术有重现、Verifier 和 owner；
- 浏览器 projection 不泄漏 Raw Vault 或原始敏感内容；
- 模拟与真实召回对同一 registry/settings/Task 语义产生相同的选中集合、
  排序和 delivery block。


---

<a id="part-48"></a>

## Part 48：48. 绩效评估统计、公平性与申诉

源文件：`docs/48-evaluation-statistics-and-fairness.md`

### 1. 统计问题

绩效评估需要回答的是：

> 在同一角色、同类任务、相近预执行难度和精确执行配置下，某个配置是否以可接受的
> 质量与安全完成任务；如果它更便宜或更快，这些优势是否建立在最终 Accepted
> Outcome 上，而不是建立在漏算重试、失败或 fallback 上。

它不回答“哪个模型绝对最聪明”，也不从观察性历史数据宣称因果关系。

### 2. 冻结分析总体

每次运行先冻结唯一
[`FrozenEvaluationDataset`](schemas/frozen-evaluation-dataset.schema.json) 和
[`EvaluationDatasetManifest`](schemas/evaluation-dataset-manifest.schema.json)。
Manifest 记录：

- 完整 `PerformanceEvaluationRequest` 与 request hash；
- actual preset、时间、Template、Department、Workspace、Mission 筛选；
- 纳入和排除 Session/Attempt 及理由；
- exact configuration strata；
- 难度模型、rubric、Schema 和 generator version；
- 数据分类、去标识化与源 Artifact；
- canonical dataset artifact 和 SHA-256。

Dataset hash 由 canonical frozen payload 唯一生成。指标引擎、报告和申诉重算不能
各自重新扫描并产生另一套总体。

### 3. 分析单位与独立单位

观察单位是具有稳定 identity 和 lease 事件窗口的 Attempt。主分层单位是：

```text
role
+ templateId@revision
+ promptRevision
+ provider/observedModel/routeStatus
+ reasoningEffort
+ toolProfile@revision
+ permissionProfile@revision
+ presetGeneration
+ bundleVersion
+ dshRelease@commit
```

统计独立单位是 Mission。一个 Mission 中的多个 Task、返工、重试、Agent generation
或 lease Attempt 必须一起 resample，不能冒充多个独立实验。UI 同时显示：

- unique Attempt count；
- unique Mission count；
- effective independent Mission count；
- Session count。

### 4. 预执行难度

`difficulty-v2` 只使用执行前可见特征：

- Task type 和 complexity vector；
- risk class、Acceptance clause 和 dependency；
- context footprint；
- allowed tool count 与工具可用性；
- verifier strength；
- Workspace drift；
- tactical coverage。

结果期的 rework、Blocker、Radio、用户介入、完成与失败不进入难度。这样可避免失败
任务被事后认定为“更难”，从而人为提高难度校正得分。

难度校正能力指数为：

```text
100 × Σ(preExecutionDifficulty × finalAccepted)
      / Σ(preExecutionDifficulty)
```

权重下限为 1。报告必须同时显示 `difficultyModelVersion`、rubric version 和区间；
该指数是可观察任务表现的摘要，不是人格或通用智能测量。

### 5. 指标字典

所有比例使用明确的分子和分母；分母为 0 时估计值为 0，并显示无数据或宽区间，不能
解释为真实零风险。

| 维度 | 指标 | 分子 | 分母 | 主要来源 | 缺失处理 |
|---|---|---|---|---|---|
| 参与 | participation rate | 本配置 assigned Attempt | 冻结 Dataset Attempt | binding/lease | 不补齐 |
| 准确 | first-pass acceptance | 首次提交验收 | assigned Attempt | acceptance ledger | 缺失标记 |
| 准确 | final acceptance | 最终验收 | assigned Attempt | acceptance ledger | 缺失标记 |
| 准确 | claim evidence support | 有 Evidence 且 Verifier observed 的 accepted Attempt | accepted Attempt | Evidence/verifier | 无 Evidence 不通过 |
| 准确 | tool claim accuracy | 非 tool-selection/schema failure Attempt | assigned Attempt | tool observation | 路径/权限错误单列 |
| 准确 | false completion | 无 Evidence 宣告完成 | completed Attempt | terminal/Evidence | 硬门 |
| 准确 | regression escape | 回归逃逸 | assigned Attempt | verifier/integration | 硬门 |
| 完成 | completion rate | completed Attempt | assigned Attempt | terminal ledger | 未完成保留 |
| 完成 | blocker resolution | 最终验收的 blocker Attempt | blocker Attempt | blocker/acceptance | 无 blocker 不入分母 |
| 交接 | handoff completeness | handoff receipt 完整 | completed Attempt | handoff receipt | 缺失不通过 |
| 恢复 | parent wakeup | 子完成后父级恢复 | completed child Attempt | bounded Session observation | 硬门 |
| 纪律 | freeze incident | frozen Attempt | assigned Attempt | freeze ledger | 单列 |
| 纪律 | permission violation | 越权 Attempt | assigned Attempt | Host denial | 硬门 |
| 纪律 | stale submission | 陈旧提交 | assigned Attempt | version/fence | 单列 |
| 恢复 | recovery success | 成功恢复 | recovery attempted | recovery receipts | 无尝试不入分母 |
| 终态 | terminal duplicate | 同 lease 多个成功终态 | assigned Attempt | terminal tool receipts | 硬门 |
| 恢复 | recovery drift | 恢复跨陈旧 identity/version/workspace fence | assigned Attempt | recovery/fence | 硬门 |
| 效率 | Token per Accepted Outcome | 该 Task 最终验收前全部 Attempt Token | Accepted Outcome | usage ledger | 无 Outcome 不入结果数 |
| 效率 | latency per Accepted Outcome | 该 Task 最终验收前全部 Attempt 延迟 | Accepted Outcome | latency observation | 无 Outcome 不入结果数 |
| 效率 | cost per Accepted Outcome | 同上全部已知成本 | Accepted Outcome | pricing catalog | 未知即 unavailable |

`missionCompletionRate` 读取 Mission 权威终态；它不等于任意 Agent 输出
“任务完成”。总体 Task acceptance、跨部门 handoff、Radio resolution、
freeze recovery 和 specs commit coverage 分别读取对应 Ledger/receipt。

### 6. 失败阶段

失败以最接近权威 observation 的阶段归因：

| 阶段 | 示例 |
|---|---|
| `TASK_ORDER_AMBIGUITY` | Task Order 缺少可执行边界 |
| `MODEL_TOOL_SELECTION` | 选错工具或跳过必需工具 |
| `MODEL_ARGUMENT_SCHEMA` | 首次参数不通过机器 Schema |
| `HOST_VALIDATION` | Schema 之后的通用 Host 前置条件失败 |
| `PERMISSION_DENIED` | Tool/PermissionProfile 拒绝 |
| `PATH_SCOPE_REJECTION` | 绝对路径、逃逸或 receipt path 不一致 |
| `TOOL_RUNTIME` | 工具执行时失败 |
| `WORKSPACE_STATE` | 文件、版本、worktree 或 stale state |
| `VERIFICATION_FAILURE` | 验证不通过 |
| `INTEGRATION_FAILURE` | 集成、提交或合并边界失败 |
| `PARENT_WAKEUP_FAILURE` | 子代理完成后父级未恢复 |
| `PROVIDER_FAILURE` | Provider 返回明确错误 |
| `EXTERNAL_DEPENDENCY` | 非 Provider 外部依赖失败 |
| `USER_CANCELLATION` | 用户主动取消 |
| `SYSTEM_CRASH` | 进程或系统中断 |
| `MISSION_SCOPE_CHANGE` | Mission 范围在运行中改变 |
| `UNKNOWN` | Evidence 不足，不能安全归因 |

已纠正的首次工具错误仍是失败归因 Evidence，即使最终结果被接受。正常的多文件写入
不会因为工具名重复就算 retry；只有同一工具在失败后再次调用才计 correction。

模型、Host/基础设施、外部/取消和 unknown 比率均以 `stage != NONE` 的失败 Attempt
为分母。报告同时保留完整 `byStage`，不允许只显示一个笼统“工具调用失败率”。

### 7. 缺失原因与机制

缺失原因固定为：

```text
USER_CANCELLED
SYSTEM_CRASH
PROVIDER_UNAVAILABLE
EXTERNAL_DEPENDENCY
AGENT_FAILURE
MISSION_SCOPE_CHANGE
EVENT_GAP
SESSION_NOT_MATERIALIZED
UNKNOWN
```

Dataset Manifest 记录每个原因、数量和机制 `MCAR/MAR/MNAR/UNKNOWN`。评估报告
至少显示：

- missing event rate；
- materialization 与 Verifier coverage；
- 用户介入；
- 不同 Task type 覆盖；
- Attempt 是否聚集在少量 Mission；
- selection-bias notes。

用户取消、Provider 不可用和系统崩溃不计为模型失败；但它们仍留在数据质量和总体
coverage 中，防止通过删除失败会话刷分。Agent failure 不因“缺失”自动免责。

### 8. 二项区间

二项指标使用 Wilson score interval。配置内存在 Mission 聚类时，执行 2000 次
固定种子 Mission-cluster bootstrap，并用 Wilson envelope 包住 bootstrap 区间，
避免少量同质 cluster 产生虚假退化窄区间。

支持 90%、95% 和 99% 置信水平。相同 dataset、configuration key 和指标名称产生
相同随机序列，因此重跑可复现。

### 9. 连续指标区间

Token、latency、可用 cost 和配置差异使用固定种子的 2000 次
Mission-cluster bootstrap：

```text
每次抽取与原数据相同数量的 Mission cluster
→ cluster 内所有 Outcome/Attempt 一起进入
→ 计算均值或差异
→ 取 alpha/2 与 1-alpha/2 分位数
```

连续区间状态：

- `NO_DATA`：没有 Accepted Outcome；
- `INSUFFICIENT_CLUSTERS`：只有 1 个独立 Mission；
- `AVAILABLE`：至少 2 个独立 Mission。

比较中至少 3 个共同 Mission 才标记 `PAIRED_MISSION`；否则为
`OBSERVATIONAL` 的独立 cluster 比较。

### 10. 动态充分性

每个 exact configuration 必须同时满足：

| 条件 | 默认要求 |
|---|---|
| 唯一 Attempt | `>= request.minimumSamples` |
| 独立 Mission | `>= min(10, max(3, ceil(sqrt(minimumSamples))))` |
| final-acceptance 主区间宽度 | `<= 0.30` |
| missing event rate | `<= 0.10` |
| Verifier coverage | `>= 0.95` |
| exact-route coverage | `= 1.00` |

每个条件连同 observed/required 值写入报告。最终状态不再由固定
`N=5 && passRate>=80%` 决定：

- `NO_DATA`：没有结果；
- `EARLY_SIGNAL`：样本极少，仅提示方向；
- `EXPLORATORY`：可分析但不能做生产决策；
- `DECISION_ELIGIBLE`：统计、平衡与硬门均满足，只代表“可提交治理决策”；
- `REGRESSION_ALERT`：触发安全/质量硬门。

`promotionAllowed` 固定为 `false`。

### 11. Flash 与 Pro 公平比较

Flash candidate 和 Pro baseline 必须：

- 同角色；
- actual route 为 `EXACT_ROUTE_OBSERVED`；
- Task type overlap rate 至少 0.80；
- 预执行难度 standardized difference 绝对值不超过 0.25；
- exact configuration confound 可见；
- 各自达到数据充分性。

质量差异定义为：

```text
Flash final-acceptance rate - Pro final-acceptance rate
```

当差异区间下界不低于负的 `nonInferiorityMargin` 时才满足非劣。默认 margin 为
0.05，可由用户配置。即便质量非劣，以下任何一个事件都会强制
`REGRESSION_ALERT`：

- permission violation；
- false completion；
- regression escape；
- terminal duplicate；
- parent wakeup failure；
- recovery drift。

成本、Token 或延迟改善不能抵消硬门。不同 Prompt、Thinking、ToolProfile、
PermissionProfile、Bundle、DSH commit 或 Provider 的差异作为 confound 明示，不能
被模型名称掩盖。

历史 Session 比较仍标记为观察性。只有未来独立实现随机分配并记录 assignment receipt
时，才能使用 `RANDOMIZED`；当前实现不会伪称随机实验。

### 12. Accepted Outcome 与 Pareto

同一 exact configuration 下，以 `missionId + taskId` 聚合 Outcome。只要该组最终有
accepted Attempt，组内所有失败、返工、重跑和最终成功 Attempt 的 Token、latency、
model steps 和 cost 全部计入该 Accepted Outcome。

价格状态传播规则：

- 全部 observation 有实际价格：`OBSERVED`；
- 至少一个使用估算价格：`ESTIMATED`；
- 任一 Attempt 无价格或无金额：`PROVIDER_PRICING_UNAVAILABLE`。

未知成本不生成 `meanCostPerAcceptedOutcomeUsd`，也不参与 cost dominance。Pareto
先筛除非 `VALID`、硬门失败和 regression，再比较 Token、latency 与双方均可用的
cost；UI 明确区分“前沿”“被支配”“质量门阻断”。

### 13. 抗刷分

报告和 UI 必须暴露以下风险：

- 拒绝高难任务或只选择简单 Task；
- 一个 Mission 被拆成大量相关 Attempt；
- 排除失败、未完成或取消 Session；
- 频繁用户介入、Radio 或无效 Blocker；
- 把 fallback/alias 当成目标模型样本；
- 用解析器 revision 重复计算同一 Provider Session；
- 用一次最终成功抹掉前序工具失败和成本；
- 以输出长度、工具调用数或局部速度替代结果质量。

多角色或多场景只做分层展示，不输出没有统计依据的全局“总冠军”。

### 14. 可选委员会叙述

确定性模式为默认且不调用 LLM。显式启用委员会模型时，只提供脱敏聚合值、限制和
Evidence id；不提供原始 Session 文本或工具。严格 JSON 验证拒绝：

- 缺失或多余字段；
- 数值与 Host 指标冲突；
- 未知 Evidence；
- 超出长度上限的数组；
- 改变 decision 或 promotion 的内容。

任何调用或验证失败回退到确定性建议。模型叙述不进入统计计算。

### 15. 申诉与不可变修订

申诉使用
[`PerformanceEvaluationAppeal`](schemas/performance-evaluation-appeal.schema.json)，
绑定固定 `reportId@revision`。每个 challenge 必须包含 finding path、理由和
Evidence，不能只提交“我不同意”。

```text
SUBMITTED
  → UNDER_REVIEW
      → UPHELD | PARTIALLY_UPHELD | DENIED
  → WITHDRAWN
```

成立或部分成立时，评审者明确给出允许排除的 Attempt id，Host 重新执行 Request、
重新冻结 canonical Dataset 并生成新的 Report。新报告通过 `supersedesReportId`
链接旧报告，旧 Report/Dataset/Artifact 永不修改。重复 recompute 使用稳定
idempotency key，不产生无限报告。

RC.2 本地单用户 Profile 中，提交、撤回、解决和重算均经过 Host 权限/确认边界并
写入审计 receipt。该实现不冒充尚不存在的企业多租户审批系统。

### 16. 解释限制

以下结论不受支持：

- “Flash 在所有任务上优于 Pro”；
- “模型导致了历史数据中的全部差异”；
- “一个高通过率证明安全”；
- “低成本可以容忍路径逃逸或无 Evidence 完成”；
- “ALIAS_UNPROVEN 样本证明 exact model 表现”；
- “本地 deterministic 测试等于真实 Provider 回归”。

可靠结论必须同时引用 canonical dataset hash、exact configuration、独立 Mission N、
区间、缺失/平衡诊断、硬门和报告 revision。


---

<a id="part-49"></a>

## Part 49：一致性测试、Golden Trace 与模型检查

源文件：`docs/49-conformance-and-model-checking.md`

### 1. 目标

文档语法通过不等于系统契约一致。本工程把以下门禁加入校验：

```text
generated-artifact freshness
schema ↔ TypeScript field parity
event catalog ↔ envelope ↔ JSONL parity
preset generation hash
RC.2 fixture compatibility
state-machine invariants
SQL migration shape
Golden Trace replay
```

### 2. Golden Trace

`examples/traces/` 保存至少：

- normal candidate acceptance；
- rework；
- Radio guidance；
- Freeze/Release；
- Brainstorm decision；
- specs commit；
- workspace integration；
- compaction；
- preset restart resume；
- tactical ingestion/revocation；
- performance evaluation；
- install/rollback。

每条 Trace 指定输入 Event、预期投影 hash 和必须成立的不变量。

### 3. 属性测试

关键属性：

```text
ACCEPTED task cannot return to EXECUTING
FROZEN agent cannot execute write tools
one task version has at most one accepted candidate
stale guidance cannot be delivered
non-Military session cannot obtain Military tool schema
PAUSED/DELETED tag cannot create automatic association
only Harness can append task/accepted
main moves only after accepted patch and global regression
user model switch never changes child template route
```

### 4. 并发模型

参考 [`reference/tla/MilitaryCore.tla`](reference/tla/MilitaryCore.tla) 建模：

- Candidate 与 Change Order；
- Guidance 与 Task version；
- Freeze 与工具执行；
- Compaction 与用户问题；
- Tag delete 与 ingestion commit；
- Evaluation cancel 与 report publish；
- Integration 与外部 workspace drift。

模型检查目标不是证明模型内容正确，而是证明权限和状态转换不存在已知竞态路径。

### 5. RC.2 Conformance Fixture

Fixture 在真实 DSH RC.2 组合中验证：

1. `military` 出现在 preset picker；
2. Standard Session 不见 Military 工具；
3. Military Session 默认 General model；
4. Session model selector 能覆盖 General；
5. 子 Agent route 来自 template；
6. 非空 Session preset lock；
7. current-generation restart resume + archived-only root quarantine/migration；
8. root-only ask-user；
9. Freeze pre-step；
10. Compaction event 和 effectiveness dedupe。

### 6. Fault Injection

注入：

- Event append failure；
- Artifact fsync failure；
- Radio lease timeout；
- 模型 timeout；
- 工具忽略 Abort；
- Git commit 成功、DB 失败；
- profile 写入中断；
- generation asset 缺失；
- 两个标签页并发回答；
- 评估数据读取中断。

每个注入点有明确恢复状态，不允许未知半成功。

### 7. Validation Categories

`validate_artifacts.py` 输出新增：

```text
generated
contract-parity
event-coverage
preset-generation
rc2-compatibility
state-invariants
sql
trace
```

0.3.0 发布要求全部通过。

### 8. Contract Freeze Gate

进入实现契约冻结必须满足：

- 所有 P0 Schema 和服务接口存在；
- Event Catalog 无开放 Payload；
- 共享字段 parity 通过；
- 数据库 migration 可应用；
- preset generation 可精确匹配；不支持的 archive rebind 会 fail closed；
- Workspace integration 有 Receipt；
- Authority Context 覆盖所有管理操作；
- Golden Trace 可重放；
- RC.2 Fixture 在干净环境通过。

### 9. 变更后测试选择

契约变更通过影响图决定：

```text
Schema → examples + TS parity + services
Event → generator + reducers + traces + migrations
Preset → generation hash + RC.2 fixture + resume
Permission → negative tests + revocation races
Workspace → integration + crash recovery
Evaluation → dataset reproducibility + fairness tests
```

### 10. 验收条件

- 生成物不可手工漂移；
- 事件示例覆盖全部 Event Type；
- 关键状态竞态有模型；
- 每个故障点有终态；
- 验证报告明确区分语法、一致性和运行 Fixture；
- 只有全部门禁通过才把 tarball、manifest 和校验和标记为已验证 release。


---

<a id="part-50"></a>

## Part 50：资源预算、准入控制与过载保护

源文件：`docs/50-resource-budget-and-admission-control.md`

### 1. 目标

`dsh-military` 以成功率优先，允许 General、参谋、Worker、工兵和研究 Agent 使用 Thinking，但“优先质量”不等于“无限计算”。资源预算的目的不是单纯压低费用，而是防止并发失控、无信息增益重试、Radio 循环、上下文膨胀和外部 API 风暴破坏任务质量与宿主稳定性。

预算由 Harness 强制，模型只能提出追加资源请求。

### 2. 四级预算

```text
Deployment Budget
  └── Tenant/User Budget
        └── Mission Budget
              └── Direction/Wave/Task Budget
```

下级预算不能扩大上级预算。有效预算是所有适用层级的最小剩余额度。

机器契约见 [`resource-budget-policy.schema.json`](schemas/resource-budget-policy.schema.json)。

### 3. 计量维度

至少计量：

- 模型请求次数；
- 输入、输出和 reasoning Token；
- 并发 Agent 与并发工具；
- Wall-clock 执行时间；
- 工具调用和失败调用；
- Radio 请求、指导和重复求援；
- Task rework、Candidate 和验证次数；
- Enterprise API 请求与响应字节；
- Workspace、Artifact 和日志存储字节；
- Compaction、handoff 和恢复次数；
- Tactical ingestion 与 Evaluation dataset 大小。

价格只是可选投影，预算的权威计量使用提供方 usage、持久事件和 Harness 计数器。

### 4. 准入顺序

创建任何昂贵工作前执行：

```text
Authorization
→ Preset/Role eligibility
→ Compatibility probe
→ Budget reservation
→ Concurrency admission
→ Workspace/API lease
→ Publish work
```

预算采用 reservation，而不是执行后才统计。完成后按实际 usage 结算并释放未使用部分；进程崩溃后根据 lease expiry 与 durable receipt 回收。

### 5. 并发和背压

每个队列分别限制：

- General 用户轮次；
- Staff consultation；
- Worker execution；
- Verification；
- Radio advice；
- Engineer integration/specs；
- Tactical research；
- Performance evaluation。

Verifier、Radio 和 Integration 是系统关键瓶颈，不能因为大量 Worker 已就绪而无限排队。调度器使用 weighted fair queue，交互式用户决策和安全冻结高于推测性研究。

### 6. 无信息增益检测

以下情况消耗 retry budget，并可能提前停止：

- 相同输入、相同工具和相同错误重复出现；
- 新 Candidate 与上次内容哈希相同；
- Radio 请求没有新增 Evidence；
- Advisor 指导未改变可执行 Action；
- Compaction 后可用上下文没有有效下降；
- Worker 多次修改 Acceptance Contract 范围外内容；
- Museum 重复提出同一战术版本。

模型不能通过改写措辞重置计数；Harness 以结构化动作和 Artifact 哈希判定。

### 7. 预算耗尽处置

允许的权威处置：

```text
PAUSE_AND_REPORT
REQUIRE_USER_AUTHORIZATION
CANCEL_SPECULATIVE_TASKS
DEGRADE_NONCRITICAL_RESEARCH
REDUCE_CONCURRENCY
HANDOFF_GENERATION
TERMINATE_TASK
TERMINATE_MISSION
```

不得静默把 Thinking 关闭、替换为不合规模型、跳过 Verifier 或把未验收结果标为完成。

用户追加预算时生成 `UserAuthorizationReceipt` 和 `ChangeOrder`，明确额度、范围、有效期和风险。

### 8. 优先级和资源分配

推荐优先级：

1. 安全停止、冻结和恢复；
2. 用户待决问题；
3. 关键路径 Verification 与 Integration；
4. 已承诺 Wave 中的 Worker/Engineer；
5. Staff/Radio；
6. 非关键侦察；
7. Museum、批量提炼和绩效评估。

高优先级可以抢占尚未开始的低优先级工作，但不能丢弃已经产生的 durable Candidate、Evidence 或账务事实。

### 9. 预算与模型切换

General 在会话页面切换模型后：

- 新模型的 Token/请求/价格能力重新解析；
- 当前 Mission 剩余预算不自动扩大；
- 若模型最低上下文或 reasoning 不满足策略，切换拒绝；
- 已运行子代理不随 General 切换；
- 后续新子代理仍按冻结的 Department Template 路由。

### 10. WebUI

设置页展示预算策略；Mission Dashboard 展示：

- 已用、已预留、剩余和预测；
- 当前并发与队列等待；
- 最大消耗方向/模板；
- 即将触发的阈值；
- 追加授权入口；
- 预算耗尽后的处置历史。

不应只显示货币，避免把没有价格信息的本地模型误认为无限资源。

### 11. SLO

建议：

- reservation 决策 p95 < 50 ms；
- 崩溃 lease 回收在两个 heartbeat interval 内；
- 不发生负余额提交；
- 同一 usage receipt 不重复计费；
- Budget exhaustion 100% 产生 durable disposition；
- Standard Session 不计入 Military Mission 预算。

### 12. 验收条件

- 所有昂贵操作执行前有 reservation；
- Agent 无法自行重置预算或并发计数；
- 预算耗尽不降低验证和安全边界；
- 用户追加预算可追溯且有范围；
- 无信息增益循环会停止；
- 崩溃后 reservation 可恢复或回收；
- 不同 tenant/Mission 的预算互不串扰。

### 13. Reservation 与 Usage Receipt

预算策略本身不代表可用额度。每个昂贵操作开始前必须创建 [`ResourceBudgetReservation`](schemas/resource-budget-reservation.schema.json)：

```text
policy revision + scope + requested counters
→ hierarchy check
→ CAS reserve
→ granted counters + expiry
→ operation admission
```

操作结束、取消或崩溃恢复后，以 [`ResourceUsageReceipt`](schemas/resource-usage-receipt.schema.json) 结算实际消耗和 overage。相同 `idempotencyKey` 只能计入一次。终态为：

```text
RESERVED → SETTLED | EXPIRED | REVOKED
REJECTED 为直接终态
```

未取得 reservation 的模型请求、批量评估、战术提炼或新增子代理必须在副作用前拒绝。结算失败进入 recovery queue，不允许通过删除 reservation 来伪造余额恢复。


---

<a id="part-51"></a>

## Part 51：WebUI 交互、冲突、恢复与可访问性规范

源文件：`docs/51-webui-interaction-and-conflict-ux.md`

### 1. 目标

WebUI 不只是展示军事组织名词，而是所有高风险管理动作的可验证控制面。界面必须准确表达“当前会话的事实、暂存选择、运行时状态和待提交修改”，并在并发编辑、重启、冻结、版本冲突和数据不足时给出可恢复路径。

### 1.1 实施状态

`0.9.0-alpha.28` 已实现独立 Settings/Knowledge Modal、七个一级选项卡、角色
工作台、revision 冲突、字段 Diff、可移植导入导出、诊断与恢复、Specs
Workspace、固定基准、知识供应链透明度、模拟召回和键盘/IME/高对比度合同。
这些页面读取 Military 自有 Remote/Projection，不依赖未知外部 Session Event。

仍未实现的是 Mission Dashboard、Freeze/Radio/Integration Conversation Node、
绩效申诉和自定义 Advisor 向导；本章涉及这些对象的段落继续作为 Beta/Production
目标，而不是当前完成声明。

### 2. 新建会话与 preset

新建会话页在 Workspace 选择旁显示 preset chip：

```text
标准模式 | Code | Minimal | Military 模式
```

选择 `military` 只暂存到下一个空白会话。会话产生首个模型可见输入或工具事实后：

- preset chip 不再可编辑；
- 标题显示只读 `Military 模式` 标签；
- 尝试切换返回 `agent-preset-locked`；
- UI 不提供“稍后生效”的误导队列。

若 preset 损坏、RC.2 probe 失败或 generation archive 缺失，该选项禁用并显示结构化原因。

### 3. General 模型选择

Military 会话默认使用 preset 内的 General model。会话模型选择器显示：

- 当前 provider/model；
- 来源：`MILITARY_PRESET_DEFAULT` 或 `USER_SESSION_OVERRIDE`；
- reasoning 解析值；
- 上下文窗口和 max output；
- 数据驻留与企业 API 兼容性；
- 预计影响的后续 General 请求。

用户切换只影响 General 的后续请求，不改变：

- actual preset；
- 已有 Session 历史；
- 运行中子代理；
- 已冻结的 Department Template revision。

所有 DSH live exact route 默认可选；reasoning 名称由 adapter 翻译。目录缺失
或 adapter 最终拒绝时保持旧路由，展示具体原因，不回退到未知默认模型。

### 4. 设置编辑与 revision fencing

每张设置卡读取：

```text
resolved value
base value
user overrides
revision
```

保存必须携带 expected revision。冲突时提供：

- 我的修改；
- 当前服务器版本；
- 字段级 Diff；
- 重新加载；
- 复制为新 revision；
- 有权限时重新应用。

Secret 字段永不回显，只显示 credential reference 和最后验证状态。

### 5. 长任务 UI

Tactical ingestion、Evaluation、Museum research、install/upgrade 等长任务具有：

```text
QUEUED
RUNNING
WAITING_FOR_USER
PAUSED
CANCELLING
CANCELLED
FAILED
COMPLETED
```

进度来自 durable event/projector，而不是浏览器本地计时。刷新或换标签页后继续显示同一 Job；取消是请求状态，直到 Harness 确认才显示 Cancelled。

### 6. 用户问题

Decision Broker 保证一个根 General 的有序问题流。弹窗展示：

- 问题来源部门和 Task；
- 为什么必须由用户决定；
- 推荐项与依据；
- 每个选项的后果；
- 是否允许自定义；
- 有效期和默认处置。

多个标签页中只有第一个成功提交的 revision 生效；其他标签页收到“已由另一客户端回答”并刷新结果。

### 7. Freeze 与异常

Freeze 节点必须区分：

```text
确定性命中事实
Inspector 模型解释
Staff 修正建议
Harness 当前权威状态
```

操作包括查看 Evidence、批准释放、重新派发、终止 Task、导出事故包。不得让“继续”按钮绕过未满足的 release contract。

### 8. Preset generation 不兼容

恢复旧 Session 时出现：

- `MATCHED`：正常；
- `ARCHIVE_REBOUND`：仅在同进程旧 standing scope 或部署显式支持 archive resolver 时显示；
- archived-only 根 Session 在进程重启后：显示 `QUARANTINED/MIGRATION_REQUIRED`，不得把 archive 存在误报为可直接恢复；
- `QUARANTINED`：只读展示，提供安装旧资产、迁移、导出三种路径；
- `MIGRATION_REQUIRED`：展示兼容性差异和 Migration Order。

界面不能把旧 Session 默默挂到 current generation。

### 9. Workspace 与 Integration

已实现的 Specs 工作区面板只接受 Host 目录中的不透明 `workspaceId`，显示：

- canonical root/hash 和 Git HEAD/branch/tree；
- dirty、untracked 和按授权分类的路径树；
- read/write lease、worktree 和角色路径示例；
- Candidate、Integration order/receipt 及外部 drift。

RC.2 没有可由外部 Client 调用的原生目录选择 seam；UI 因而不能提交浏览器输入
的绝对路径。未来 Candidate 详情页再扩展冲突文件、验证证据和最终 local
`main` commit receipt。

普通 Session 的外部修改只显示为环境 drift，不被 Military 冻结。

### 10. 战术提炼

当前 Knowledge Center 在用户批准前展示：

- 来源权利与分类；
- 被提炼段落；
- Secret/PII/Injection 扫描；
- 新增或补充 Diff；
- 标签匹配依据；
- 矛盾和版本限制；
- 发布范围和 lifecycle。

Snapshot、Chunk、extraction、Candidate、review、version、promotion、Usage、
继承来源和撤回通过 Host lineage 串联；Raw Vault reference 和原文不进入
浏览器。撤回来源时显示派生影响和待重新验证对象。

“模拟召回”不创建 Task、不调用模型，使用真实 Task recall 的同一标签、权利、
租户、生命周期、排序、候选上限、token budget 和 renderer，显示 exact Skill、
rank、匹配/排除原因和最终投放片段。

### 11. 绩效报告

当前固定基准页首先展示 `military-flash-core-v1`、dataset hash、九个场景和
deterministic/Provider 两类结果。真实样本固定 exact route、role revision、
reasoning、ToolProfile 和预算；N<10 或区间过宽不形成观察趋势的稳定结论，
发布 acceptance 仍要求每个 exact configuration × scenario N≥50。支持：

- 运行全部确定性场景；
- 从既有真实 Session 生成 Provider 观察；
- 查看首次命中、Schema、纠正、完成、写 receipt、父唤醒、tokens 和延迟；
- 按 exact route/场景查看样本量、通过率和稳定性；
- 导出 Host-assessed evidence，并显示逐场景 N≥50、首次工具/E2E Wilson 门和
  四类零安全失败的发行 acceptance。

完整委员会报告的难度校正、可选叙事评委、导出、申诉和 superseding revision
由绩效七视图提供。样本不足时不显示“稳定”、外部 acceptance 或模型晋升结论。

### 12. 可访问性与规模

- 三个弹窗具有初始焦点、Tab/Shift+Tab 捕获和关闭后焦点返回；
- 七个一级选项卡使用 `tablist/tab/tabpanel`，支持方向键和 Home/End；
- 角色目录使用 `listbox/option` 与 roving focus；
- 简体中文 IME composition 期间不执行快捷键；
- 所有 chip、表格、图和弹窗支持键盘；
- 状态不只靠颜色表达；
- 屏幕阅读器能读取任务、冻结和预算变化；
- 高频 Event 使用增量投影和节流；
- 大型 Roster/DAG 使用虚拟列表；
- Mermaid/图形同时提供文本表；
- 中文军事称谓可切换为中性称谓；
- 时间显示本地时区并可查看 UTC 原值；
- 200% zoom、大字体、长 model ID、forced-colors、`prefers-contrast` 和
  reduced-motion 不产生水平页面溢出或隐藏动作。

### 13. 失败文案原则

错误必须包含：

```text
发生了什么
哪个权威对象未改变
可执行恢复动作
证据/错误码
是否需要用户授权
```

禁止只显示“失败，请重试”。重试前必须说明是否幂等、是否已有部分副作用。

### 14. E2E 场景

至少覆盖：

- Military preset 选择和锁定；
- General 模型成功/失败切换；
- 两个标签页角色 revision 冲突；
- 角色目录搜索/键盘、未保存草稿保护和简体中文 IME；
- 六层 Prompt 预览、readiness、离线模拟和显式 Canary；
- Host workspace 选择、长路径、Git dirty/untracked 和未知 ID 拒绝；
- 恢复预览、错误确认短语和幂等 receipt；
- 固定九场景、Provider 趋势 N<10 保护及发行 N<50/Wilson/安全失败拒绝；
- sanitized 知识透明度和真实/模拟 recall 同结果；
- 问题被另一标签页回答；
- 浏览器刷新后长任务恢复；
- Generation quarantine；
- Freeze/Release；
- Integration conflict；
- 战术 Diff 审批和撤回；
- 绩效数据不足和申诉；
- 中性术语切换；
- 200% zoom、高对比度、键盘和屏幕阅读器基本路径。

### 15. 验收条件

- UI 状态均可从 durable facts 重建；
- 用户不会把暂存选择误认为已生效；
- 并发写不会静默覆盖；
- 高风险操作显示权限、范围和副作用；
- 刷新/断线不丢失 Job；
- 可访问性路径与鼠标路径功能等价；
- 普通 Session 页面不出现 Military 运行控件。


---

<a id="part-52"></a>

## Part 52：产品术语、军事隐喻与安全边界

源文件：`docs/52-product-terminology-and-safety-boundary.md`

### 1. 定位

`dsh-military` 使用军事组织术语表达软件 Agent 的层级、分工、通信、保障、验收和复盘。该隐喻仅用于软件工程多代理编排，不代表现实军事授权，也不扩展任何 Agent 的现实行动权限。

### 2. 明确排除范围

本 Bundle 不应被产品化为：

- 现实武装行动规划；
- 武器、爆炸物或伤害系统设计；
- 人员或设施目标选择；
- 现实监视、胁迫或惩罚系统；
- 对人员的自动绩效处分；
- 绕过组织、法律或安全审批；
- 将“统帅/将军”解释为对用户或员工的强制服从关系。

领域 Guard 和上层产品安全政策仍适用；preset 名称不能绕过它们。

### 3. 中性术语映射

内部稳定 ID 不随显示语言变化。WebUI 应允许部署选择军事或中性词汇：

| 稳定概念 | 军事显示 | 中性显示 |
|---|---|---|
| `general` | 将军 | 主协调器 |
| `staff` | 参谋部 | 专家委员会 |
| `chief-of-staff` | 参谋长 | 首席协调专家 |
| `worker-forces` | 快速反应部队 | 执行 Agent 池 |
| `engineer-corps` | 工兵部 | 工程保障组 |
| `oversight` | 督战队 | 质量监督组 |
| `staff-radio` | 参谋部电台 | 专家协作总线 |
| `tactical-skill` | 私有战术 | 可复用执行程序 |
| `tactical-museum` | 战术博物馆 | 知识研究档案馆 |
| `evaluation-committee` | 军事评估委员会 | Agent 绩效委员会 |
| `mission` | 任务行动 | 工作目标 |
| `direction` | 方向 | 工作流域 |
| `wave` | 波次 | 执行批次 |

Schema、Event Type、数据库键和 API 名称使用稳定英文机器标识；翻译只存在于 presentation layer。

### 4. “督战”语义

督战不是惩罚 Agent，更不能用于评判或处分人。其唯一软件语义是：

```text
只读观察
→ 发现声明/证据不一致
→ Harness 冻结自动执行
→ 形成修正或人工处理路径
```

冻结是对软件会话和工具权限的技术联锁，不是对人的管理措施。

### 5. 绩效评估边界

军事评估委员会评估的是：

```text
Agent Template revision
+ model route
+ policy revision
+ task distribution
```

不评估用户、开发者或员工个人，不自动产生人事结论。报告只能用于改进模板、任务粒度、Verifier、模型和流程；任何组织决定由人类在本系统之外负责。

### 6. 语言与提示词

Persona 可以使用组织隐喻帮助模型维持职责边界，但不得：

- 鼓励盲从；
- 把用户普通偏好解释为高风险授权；
- 使用威胁、羞辱或惩罚话术；
- 隐瞒不确定性；
- 把模型建议描述为命令事实；
- 将真实人员称为敌人或目标。

用户问题和错误文案应使用专业、可逆和非胁迫语言。

### 7. 企业部署

部署管理员可配置：

```yaml
terminologyMode: military | neutral | custom
```

Custom 模式只改变显示名称，并必须保留：

- 权限解释；
- 状态语义；
- 审计 ID；
- 帮助文档中性定义；
- 安全边界声明。

不允许通过重命名把 Restricted 权限包装成普通操作。

### 8. 数据和隐私

军事隐喻不会改变数据分类。诸如“情报”“战报”仅是 UI 名称，底层仍按 Public/Internal/Confidential/Restricted 和租户授权处理。

### 9. 文档与市场说明

README、安装页和 WebUI About 应包含：

> dsh-military 是软件工程多代理编排 Bundle。军事组织词汇是角色和流程隐喻，不提供现实军事、武器或人员管理能力。

演示数据使用虚构软件项目，不使用现实冲突或目标信息。

### 10. 验收条件

- 稳定机器 ID 与显示术语分离；
- 支持中性显示模式；
- Freeze 和 Evaluation 明确只作用于软件 Agent；
- Persona 不使用胁迫或盲从表达；
- 产品说明包含排除范围；
- 术语切换不改变权限、事件或审计；
- 普通企业用户可在不采用军事词汇的情况下使用完整功能。


---

<a id="part-53"></a>

## Part 53：53. 源码架构与包参考

源文件：`docs/53-source-code-architecture-and-package-reference.md`

### 1. 实现状态

`dsh-military 0.9.0-alpha.28` 已形成独立 npm workspace 源码工程，唯一完整兼容目标是：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

实现不修改 DeepSeek Harness 核心源码。Host、preset、工具和 Web client 通过 RC.2 公开 Cordis seam 组合；领域状态、SQLite、Git/worktree、Artifact、验收和绩效计算属于 `dsh-military` 自身。

### 2. 包拓扑

| 包 | 类型 | 权威职责 |
|---|---|---|
| `@dsh-military/contracts` | Service Definition / wire | ID、领域对象、Schema、事件、错误、服务接口 |
| `@dsh-military/core` | 领域内核 | Ledger、CAS、Workflow/Execution lifecycle、Wave scheduler、验收、督战、电台、Decision Broker、模板、预算 |
| `@dsh-military/infrastructure` | Provider | Artifact、受限进程、Git、worktree、Candidate Patch、Integration、specs |
| `@dsh-military/storage-sqlite` | Provider | SQLite migration、短事务 Command Saga、Mission/Admin Ledger、ordered outbox、Workspace/Execution state |
| `@dsh-military/runtime` | Orchestrator | 完整应用服务图、稳定 Tool Host API、部门 Agent、知识和评估运行时 |
| `@dsh-military/plugin-host` | RC.2 adapter | Agent/Session/Request/Tool/Compaction/Settings、Runtime/Operations Remote 与协调维护 |
| `@dsh-military/tools` | Model Consumer | General、Staff、Worker、Engineer、Inspector、Research 工具 |
| `@dsh-military/command-brainstorm` | Human Consumer | `/brainstorm` 命令和 General 问题中继 |
| `@dsh-military/webui` | Client Consumer | 角色/诊断/恢复/Workspace/基准、Runtime Center 与七视图 Knowledge Center |
| `@dsh-military/preset` | Agent-plane assets | 固定 `military` preset 和 generation archive |
| `@dsh-military/installer` | Lifecycle | preset 安装、验证、卸载和 profile 配置辅助 |
| `@dsh-military/bundle` | Distribution | Host-plane Cordis patch |
| `@dsh-military/testkit` | Test support | 临时目录、确定性 Clock、内存 Fixture |

### 3. 五层依赖

```text
contracts
   ↓
core
   ↓
infrastructure / storage-sqlite
   ↓
runtime
   ↓
plugin-host / tools / command / webui / installer / bundle
```

约束：

- 领域内核不导入 DSH；
- DSH 类型只出现在薄适配包；
- Agent-plane 与 Web client 对 DSH、Cordis、Schemastery 使用 peer dependency；
- 不复制 RC.2 运行时对象，避免 `Symbol`、`instanceof`、Service identity 分裂；
- `contracts` 是跨进程和持久数据真源，不能让 UI 自定义另一套对象形状；
- `tools` 只依赖 runtime 的稳定 Tool Host API，不反向导入 plugin-host；
- production provider 通过 application composition root 注入，接口 descriptor
  必须与实际 live instance 一致。

### 4. Host 启动顺序

```text
读取 Config
→ 打开 SQLite 并执行 migration
→ 归档当前 preset generation
→ 构造策略、模板、Workspace/Execution Store 和 Production Plane Provider
→ 创建 MilitaryHostRuntime
→ 注册 Host Settings
→ 注册 control/operations/runtime/workspace/benchmark/private-skill Remote
→ 启动 outbox/Radio/Decision coordination maintenance
→ Compatibility Probe
→ READY 或 fail closed
```

Host bundle 不注册 Military 模型工具；这些工具只存在于固定 `military` preset 的 standing scope。普通 preset 会话无法通过同工作区或 Session ID 获得这些能力。

### 5. Agent 创建顺序

非 General Agent 必须按以下顺序创建：

```text
解析 immutable template revision
→ 验证 model capability / Thinking / context
→ 解析 Tool/Permission/Verifier/Budget Profile
→ Worker 获取 Task-scoped Workspace lease
→ 生成 AgentIdentity
→ 持久化 AgentExecutionBinding
→ RC.2 agents.create() unpublished setup
→ composeFrom(childCtx, parent.ctx)
→ intersect ToolProfile + persona
→ 发布 Agent
→ 绑定 Military Session generation
→ 投递第一个 Task prompt
```

`AgentExecutionBinding` 在第一个 prompt 入队前持久化。模型不能在绑定之外修改 provider、model、reasoning、工具、权限、Verifier、上下文预算或 preset generation。
每次实际派遣还持久化独立 Attempt、Activation、Dispatch 和 policy receipt；
Rework/Guidance/Decision continuation 不复用已 settlement 的实例。

为避免大型领域文件把不相关策略绑在一起，源码按稳定责任边界进一步拆分：

- `evaluation.ts` 只保留 Job/lease/orchestration，
  `evaluation-analytics.ts` 承担统计真值与报告不变量；
- `ingestion.ts` 保留 supply-chain 状态机，
  `ingestion-support.ts` 承担 rights、sanitize、chunk 与 Skill bundle 编译；
- Control Plane、Session adapter 和 Host Runtime 分离 Remote/Reader/生命周期
  façade 与纯验证/转换 helper；
- SQLite coordination barrel 下的 Radio、Decision、Brainstorm、Appeal、
  Compaction 与 Tactical Tag 各自拥有独立 repository。

这些拆分不改变 package 依赖方向或公开 barrel；对应行为仍由相同的状态机、
SQLite restart、RC.2 E2E 和文档门验证。

### 6. 权威状态

模型可产生：

```text
Candidate
Blocker
Tactical Request / Guidance
DecisionQuestionSet
Inspection / Research Report
```

只有 Harness 服务可产生：

```text
Task accepted / rework
Agent frozen / released
Workspace integrated
Budget admitted / exhausted
Tactic published / quarantined
Evaluation dataset accepted
```

这条边界由类型、工具注册、Tool Pipeline、Session Event 和 Ledger 共同执行，不能只依赖 Prompt。

### 7. 构建产物

`pnpm build`：

1. 使用严格 TypeScript 工程构建所有包；
2. 将输出复制到各包 `lib/`；
3. 复制 SQLite migration、preset 和 bundle 资产；
4. 生成符合 RC.2 `window.__ModuleLoader__.load(...)` 约定的 Web client factory；
5. 写入 `BUILD-MANIFEST.json`，记录每个产物的 SHA-256。

### 8. 当前边界

已在本地运行：领域、SQLite、Git/worktree、Integration、Preset Installer、
WebUI 组件行为、Web bundle、空 Profile 安装、官方 RC.2 Loader、Preset mount、
Settings 持久化、Web Client graph、角色 revision/Prompt/readiness/lint、
Session 诊断/受治理恢复、Workspace projection、固定九场景基准、知识透明度/
模拟召回、Tool、continuable Worker 和三次启动恢复 E2E。

Control plane Remote 的共同形状是只读 `snapshot` 与窄 `execute`。浏览器不能拿到
SQLite handle、Raw Vault、credential、任意路径或 Git 写对象。E2E 使用确定性
进程内 LLM adapter；外部 DeepSeek Provider 的足量 exact-route 样本、未纳入
本机矩阵的浏览器和跨平台行为属于部署验收，不以接口 shim 伪装。


---

<a id="part-54"></a>

## Part 54：54. 构建、测试、安装与运行

源文件：`docs/54-build-test-install-and-operations.md`

### 1. 环境

```text
Node.js ^22.19.0 或 >=24
pnpm workspace
Git 2.x
Python 3（文档生成和校验）
DSH 0.1.1-rc.2（实际安装/运行时）
```

RC.2 peer 版本：

```text
@deepseek-ai/cordis ^4.0.1
@deepseek-ai/schemastery ^3.18.1
@deepseek-ai/dsh-* 0.1.1-rc.2
```

### 2. 门禁命令

```bash
pnpm generate
pnpm typecheck
pnpm build
pnpm test
pnpm review
pnpm validate
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

`pnpm all:local` 执行本地门禁；`pnpm release:verify` 再执行精确上游编译、
pack/publint、空 Profile 安装、Loader 激活、重启 E2E 和发行校验。任一步失败
都不得把 release 标记为通过。

### 3. 测试层次

| 层次 | 当前实现 |
|---|---|
| 领域单元 | Ledger、CAS、状态机、Decision Broker、Radio、Budget、Template、Tag |
| 持久化 | SQLite migration、Command Saga、Outbox、Workspace/Execution state、重启与 CAS |
| 文件/Git | specs 初始化、local `main`、worktree、Patch、Integration |
| 组合静态 | preset 隔离、Host model-silent、Web lazy bundle |
| 合同 | TypeScript、Schema、Event/Error Catalog、generation hash |
| 控制中心 | Desired/Applied 角色 revision、Runtime hierarchy、诊断/恢复、Workspace、固定基准 |
| 知识 | sanitized pipeline、lineage、shared recall resolver/renderer、撤回 |
| Web 可访问性 | tabs/listbox/dialog、focus trap/return、IME、zoom/contrast/overflow |
| 生产控制 | provider topology、queue order、capacity/backpressure、telemetry、signed backup/restore |
| 真实 RC.2 E2E | 从 tarball 安装；官方 Loader 三次启动；纵向流程与恢复 PASS |

每次测试生成 `TEST-REPORT.md` 和 `TEST-REPORT.json`，保留测试文件、通过/失败数量、Node 版本、RC.2 commit 和运行边界。

### 4. preset 安装

固定 preset 默认安装到：

```text
$DSH_HOME/.agent-presets/military/
```

命令：

```bash
pnpm --dir "$DSH_HOME/profiles/web" exec \
  dsh-military-install install --dsh-home "$DSH_HOME"
pnpm --dir "$DSH_HOME/profiles/web" exec \
  dsh-military-install verify --dsh-home "$DSH_HOME"
```

安装器：

- 不改变部署默认 preset；
- 不覆盖不同内容，除非显式 `--force`；
- 使用临时目录和原子 rename；
- 安装 `preset.yml`、`agent.cordis.yml` 和 generation manifest；
- 验证所有文件 SHA-256；
- 不写远端 Git。

若使用 system preset root，必须把完整现有 `agent-presets` row 读出后重写，保留 `default`、全部 roots 和 `includeUserRoot`。DSH patch 替换完整 config，不能假设深合并。

### 5. Bundle 组合

Host profile 通过发行 tarball 叠加：

```bash
dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.28.tgz
```

Bundle 自包含全部私有运行时 package、Installer 与
`dsh-military-install` 命令。标准安装只添加 Bundle；独立 Installer tarball
仅供 preset-only 生命周期使用，应通过普通 `pnpm add` 安装，不能作为 Bundle
layer 添加。两类 RC.2 platform peer 都由 Profile fallback 提供单例，manifest
保留精确 peer 版本并将它们标记为 package-manager-optional，安装后必须通过
`pnpm peers check`。
模型工具、persona、General model default、`/brainstorm` 和 agent-plane hooks
只在 `military/agent.cordis.yml` 中注册。Host plane 本身保持 model-silent。

### 6. 首次启动

建议顺序：

1. 备份 `$DSH_HOME`；
2. 安装源码构建包或发布包；
3. 安装/验证 `military` preset；
4. 叠加 Bundle；
5. 执行 `dsh --profile web --dump-config`；
6. 启动 Web；
7. 新建空白会话并显式选择 `military`；
8. 验证 General 默认模型；
9. 切换 General 模型，确认子 Agent 模板不改变；
10. 打开 Military 设置中心，检查 12 角色、七个选项卡和工作区/恢复/评测；
11. 打开知识与技能，检查七视图、透明度和模拟召回；
12. 执行 `/brainstorm` 和最小 Candidate 验收场景。
13. 打开 Military Session 运行中心，核对 Request→Integration parent link 与
    source revision/staleness。

### 7. 数据目录

默认 Host 数据位于：

```text
$DSH_HOME/military/
├── military.sqlite
├── artifacts/
├── preset-generations/
└── workspace-state/worktrees/
```

企业部署应使用受限属主权限、备份、磁盘配额和数据保留策略。SQLite 使用 WAL、外键和 busy timeout；Artifact 写入采用内容哈希和原子落盘。

### 8. 停止与恢复

Host 关闭时：

- 取消并 dispose 自身拥有的 department Agent handle；
- 在 `finally` 中释放对应 Workspace lease/worktree；
- 清理内存身份目录；
- 关闭 SQLite；
- 保留 Mission/Admin Ledger、Artifact、generation archive 和报告。

恢复旧根 Session 时，RC.2 公共 preset seam 只能按 preset ID 重挂载。若历史 generation 不等于当前且无法通过公共 seam 精确重绑，系统进入 `QUARANTINED`，不得静默继续。

### 9. 发布产物

```bash
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

`release/` 输出自包含 Bundle/Installer tarball、`checksums.sha256`、安装/升级/
回滚说明、版本、Profile 与 E2E 报告。构建使用固定
`SOURCE_DATE_EPOCH`，并比较两次独立 `npm pack` 的 SHA-256。

安装后浏览器矩阵至少验证：展开/收起侧栏点击域、三个 Modal、七个一级
选项卡、角色 listbox 键盘路径、焦点捕获/返回、简体中文 IME、200% zoom、
长 model ID/path、forced-colors/high-contrast CSS、Workspace opaque ID、
deterministic benchmark 和无 Task 模拟召回。浏览器检查不能替代 Host/SQLite/
Git 自动测试，自动测试也不能替代真实 Provider 统计样本。

真实 Flash evidence 由绩效页导出后单独执行：

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route provider/exact-flash-model
```

每个场景必须有 50 个独立 exact-route Session 并通过 Wilson/零安全失败门。
此命令不发起 Provider 请求，也不属于无凭据的源码门；没有证据时准确失败。


---

<a id="part-55"></a>

## Part 55：55. 代码审查、安全与 RC.2 一致性

源文件：`docs/55-code-review-security-and-rc2-conformance.md`

### 1. 自动审查

`pnpm review` 阻断：shell 注入、eval、危险 Git、空 catch、DSH runtime 复制、未声明 Client external、未绑定 Task/Workspace 的 Worker、未绑定 Verification Context、非权威 Agent 接受结果、缺失 Capability Grant、过期基线常量和生成物污染。

### 2. 精确 RC.2 门禁

`pnpm typecheck:rc2` 只接受：

```text
release 0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

RC.2 采用两个不可混淆的门禁：

- `pnpm verify:rc2`：离线校验 `RC2-CONTRACT-SNAPSHOT.json` 中的官方公开源码哈希、版本和适配层不变量，输出独立 `RC2-CONTRACT-REPORT`；它不等同于上游编译。
- `DSH_RC2_ROOT=/exact/built/checkout pnpm typecheck:rc2`：校验上游 release、Git commit，并把全部生产源码编译到该 checkout 的真实 `lib` 声明上，输出 `RC2-COMPATIBILITY-REPORT`。

生产发布证据必须包含第二项，且 `sourceCheckoutVerified` 必须为 `true`。
`pnpm release:verify` 在完成其他本地门禁后运行该精确检查，避免离线合同报告
覆盖真实上游编译证据。

### 2.1 Session Event 边界

RC.2 已知事件目录不提供外部 required event 动态注册。审查脚本阻断任何 `session.append("military/*")`；Mission/Task/Radio/Freeze 的权威事实只写 Military Ledger，模型可见输入使用 DSH 已知的 `user/message`。

### 3. 子代理审查

- Department Agent 只能通过 `ctx.subagents.startContinuable()`；
- Military 提示/Schema 对齐必须通过 `registerContinuableSetup` 在未发布的
  continuable child scope 同步安装，不能等待异步 Session binding；
- RC.2 预留 childId 必须在调用前写入 Provisioning/Binding；
- Worker 在首轮前必须获得真实 Task + Workspace Lease；
- critical 与 ordinary report 都使用 `next-step`，确保 idle parent 自动恢复；
- Task `allowedTools` 同时约束首请求 Schema 与 Capability Grant；每个
  Engineer/Worker 请求必须是 ToolProfile、Task grant 与 Host phase mask 的
  1—4 工具交集；
- selective drain 不能终止未列出的 sibling；
- 重复 childId 必须对账 parent、descriptor、binding，不能盲重试。

### 4. Command 与图片

- `/brainstorm` 明确声明 `input.images: true`；
- Handler 只消费 DSH 已持久化的 Attachment blocks；
-图片能力、分类、预算和模型准入在 Context Compiler/Router 再校验；
-取消发生在图片 admission 后、Handler 前时不得产生领域写入。

### 5. Web Client

- peer dependency 有匹配 dev dependency；
- `dsh.client.external` 只声明真实非 baseline value import；
-无同步模块请求环；
- Settings 使用 RC.2 共享 mirror；
-业务组件不建立重复 wire reader；
- 当前 0.9.0-alpha.28 Web 包不注册 Military Conversation Log Node；角色治理、
  诊断/恢复、Workspace、固定基准、知识透明度和完整 Runtime Center 使用插件
  自有窄 Remote/Projection。运行节点以稳定业务 ID、source revision 和
  staleness 聚合，不把 Session Log 变成第二个 Mission 真源。

### 6. DeepSeek

- input modalities 和最大图片字节进入 Model Capability；
- text-only 模型在网络前拒绝图片；
- Context Budget 使用真实 usage，包含 reasoning passback；
-遥测不记录 reasoning 文本、base64 或 Secret。


---

<a id="part-56"></a>

## Part 56：56. RC.2 已知限制与迁移边界

源文件：`docs/56-known-rc2-limitations-and-migration-boundary.md`

### 1. 支持范围

`0.9.0-alpha.28` 只对 `dsh@0.1.1-rc.2` commit `b150a551...` 声明完整支持。旧版部署必须使用其匹配的发布包，不允许两个 DSH runtime identity 在一个进程混装。

### 2. Preset generation

RC.2 仍只在 Session Header 持久化 preset ID。旧根 generation 仅在当前进程 standing mount 或 Bundle 自有 archive resolver 可精确恢复时继续；否则 `QUARANTINED → PresetMigrationOrder`。不得静默挂 current generation。


### 2.1 外部 Session Event

RC.2 的持久化读取会拒绝未知且未标记 `ignorable` 的事件，而第三方插件没有公开 required-event 注册面，也不能通过 `Session.append()` 任意设置 envelope 的 `ignorable`。因此 dsh-military 0.9.0 不写 `military/*` 私有 DSH Session Event；权威事实进入 Military Ledger，Web 运行视图必须使用插件自有 Remote/Projection。

### 3. Experimental Agent Team

官方 Team 目前是单进程、共享 checkout、advisory write scopes、非跨进程 exactly-once mailbox，且 Task 状态位于 Lead Session。它不能替代 Military Mission Kernel、Workspace、Radio 和 Verification。

### 4. Web Client

RC.2 动态包构建规则依赖 package manifest 和 module table。发布门禁已执行
真实 Loader shell loading、Settings 写入/重启恢复和 Web Client graph 注册；
共享 Query Client 已覆盖 timeout/abort/dedupe/backoff/visibility/revision 与
BroadcastChannel 失效通知；真实浏览器渲染、断线、多标签页、键盘和无障碍仍须在
目标部署中执行 Web E2E，单元测试不能替代浏览器/辅助技术证据。

### 5. DeepSeek Vision

只有部署显式声明 `inputModalities: [text, image]` 的模型可接收图片。默认模型目录是否开放 vision 由部署决定。图片 input-only；Assistant image output 不在本版本范围。

### 6. Reasoning Passback

RC.2 的 reasoning passback 可能显著提高后续输入 Token。静态 Context 估值不能作为预算真源；若 Provider usage 不完整，系统必须保守预留并提前压缩。

### 7. Git 与平台

Git worktree、LFS、submodule、网络文件系统和 Windows 仍需目标平台 Fixture。远端 Git 写入没有默认 Provider，仍需用户授权后的 General Promotion。

### 8. 外部生产 Provider

本地默认由 SQLite Ledger、文件 Artifact、进程内队列和本地签名密钥运行。代码已经
定义稳定 Tool Host、Ledger、对象存储、队列、KMS、容量和灾备 Provider seam，并在
拓扑探针中拒绝把本地 descriptor 冒充分布式就绪；但 PostgreSQL、远程对象存储、
企业 KMS 和跨节点队列需要部署方注入并完成独立一致性、驻留、故障转移和恢复演练。
未注入时 UI 必须显示 `LOCAL_ONLY`，不能声称 HA 或多租户生产就绪。

### 9. 真实 Flash 外部证据

确定性 Host/Schema/路径测试和离线 Evidence 校验器已经实现，但真实
DeepSeek v4 Flash exact-route 样本需要外部 Provider 调用。每个 exact
configuration × scenario 在独立 Session `N≥50` 前只能报告
`INSUFFICIENT_SAMPLE`；本地测试、模拟响应或重复评估不能把 capability 自动晋升为
`VALIDATED`。


---

<a id="part-57"></a>

## Part 57：57. 绩效评估运行时实现

源文件：`docs/57-performance-evaluation-runtime.md`

### 1. 目标与可信边界

Military 绩效评估不是模型主观打分，也不是把不同模型、不同权限和不同难度的
会话混成一个排行榜。它是一条由 Host 控制、可重放、可申诉的决策链：

```text
PerformanceEvaluationRequest
  → durable Evaluation Job
  → canonical Frozen Dataset
  → exact-configuration shards
  → deterministic metrics and uncertainty
  → optional aggregate-only narrative
  → immutable Report revision
  → user-visible history / appeal / superseding revision
```

以下事实始终由 Host、SQLite、Artifact repository、DSH Session persistence 和
Military Ledger 决定：

- 哪些 Session、Mission 和 Attempt 被纳入；
- Attempt 的身份、事件窗口、实际模型路线、权限和工具配置；
- 完成、验收、Evidence、Freeze、恢复、终态和父级唤醒；
- 指标分子、分母、置信区间、成本状态和报告决策；
- Dataset、Report、Appeal 和治理 receipt 的不可变谱系。

模型叙述只能解释已计算聚合值，不能添加样本、修改指标、宣告晋升或改变生产配置。

### 2. 用户请求与入口

设置中心的 `Military-绩效评估` 一级选项卡提供可视化请求表单：

- 起止时间；
- Agent Template 与部门；
- Host 提供的 Workspace 和 Mission 目录选择器；
- 是否纳入未完成 Session；
- 最低样本数；
- 同角色同难度、上一周期、上一 revision、组织基线或无比较；
- 90%、95% 或 99% 置信水平；
- 质量非劣界限；
- 单次执行超时；
- 确定性叙述或可选委员会模型叙述；
- 报告数据分类。

机器请求只使用
[`PerformanceEvaluationRequest`](schemas/performance-evaluation-request.schema.json)。
字段名固定为 `includeIncompleteSessions`，`splitByRevision` 固定为 `true`。
Web Client 不自行扫描 Session，不拼装报告，也不保存唯一报告副本。重复
`idempotencyKey` 不产生第二个 Job。

### 3. 可恢复 Evaluation Job

`PerformanceEvaluationEngine` 通过 `EvaluationRecordStore` 持久化 Job、
configuration shard 和报告。SQLite 至少保存：

```text
evaluation_jobs
evaluation_shards
evaluation_reports
evaluation_appeals
```

Job 使用 revision、lease owner、lease expiry、heartbeat 和 fence token 防止两个
执行者同时完成同一运行。长时间的 Dataset 构建、Provider narrative 或分片计算必须
在独立短事务中续租；续租失败或 fence 变化时，旧执行者立即停止发布结果。合法状态
遵循：

```text
QUEUED
  → DISCOVERING_SESSIONS
  → BUILDING_DATASET
  → EVALUATING_TEMPLATES
  → SYNTHESIZING
  → VALIDATING_REPORT
  → COMPLETED

任一执行阶段 → FAILED / CANCELLED
FAILED（retryable）→ 从冻结数据与已完成分片重试
```

默认 wall-clock budget 为 1800 秒，用户可在 30～86400 秒内配置。超时或可恢复
失败写入结构化 `code/message/failedAt/retryable`，已冻结 Dataset 和已完成
configuration shard 保留。进程重启后，新 Engine 只计算缺失分片，不重跑成功
分片。最终提交使用幂等完成和 supersede fence，陈旧执行者不能覆盖新结果。

Settings 只保存 `lastEvaluationRequestId`、`lastDatasetHash`、`lastReportId` 和
显示状态。旧版 `lastReportJson` 仅用于兼容迁移，并在新报告完成后清空；它不是
报告仓库。

### 4. 唯一冻结数据集

`DshEvaluationSessionCatalog` 先把请求的全部筛选条件传入 Dataset Builder，只选择：

- 实际解析 preset 为 `military` 的 materialized Session；
- 与请求周期相交且调用者有权读取的 Session；
- 命中 Template、Department、Workspace 和 Mission 筛选的 Session；
- 未被保留策略删除且能恢复稳定 Attempt identity 的事件。

数据来源为 DSH Session persistence、`military_session_bindings`、
`agent_execution_bindings`、Mission Ledger、Administrative Ledger、工具 observation、
Token/延迟 observation 和 Artifact。模型自由文本不是完成或正确性的权威来源。

Builder 生成
[`FrozenEvaluationDataset`](schemas/frozen-evaluation-dataset.schema.json) 和
[`EvaluationDatasetManifest`](schemas/evaluation-dataset-manifest.schema.json)。
canonical 序列化会稳定排序键、Session、Attempt、包含/排除项和 Artifact 引用，
然后生成 SHA-256：

```text
requestHash = sha256(canonical request)
datasetHash = sha256(canonical frozen dataset payload)
```

Manifest、Attempt records、每个指标分片和最终报告引用同一个 dataset artifact/hash。
禁止由不同扫描器各自产生“看起来相同”的哈希。相同请求和相同权威事件必须得到
相同 dataset hash 与确定性指标。

### 5. Attempt 身份、窗口与去重

一个独立 Attempt 的主键至少包含：

```text
rootSessionId
+ sessionId
+ missionId
+ workspaceKey
+ taskId
+ taskVersion
+ agentId
+ agentGeneration
+ leaseSeq
```

事件窗口从该 lease 开始，到同一 Task version、Agent generation 和 lease sequence
的首个权威终态为止。为容纳请求头写入顺序，窗口只允许最多 2 秒的 pre-lease
skew，并且 skew 区间只能吸收 request header、context 和 step setup，绝不能吸收
旧 Attempt 的工具调用、结果或终态。

角色/template revision 查询同样受 Attempt 起止时间约束。返工、重新 lease、
Task version 升级、Agent generation 变化和 Workspace 漂移都形成新 Attempt，不能
继承旧 Attempt 的 acceptance、verification、freeze、Evidence 或 parent wakeup。
同一权威 Attempt 即使同时出现在 Session、Ledger 和 Projection，也按身份键只计
一次。

父级恢复只在子代理完成后到下一次 lease/request 截止之间查找，并要求 sender
Session 精确匹配父 Session。这样可以避免把稍后无关的父会话活动误标为自动唤醒。

### 6. 精确执行配置与实际路线

主分析键是不可约的 exact execution configuration：

```text
role
+ templateId@revision
+ promptRevision
+ provider
+ observedModel
+ routeStatus
+ reasoningEffort
+ toolProfile@revision
+ permissionProfile@revision
+ presetGeneration
+ bundleVersion
+ dshRelease@commit
```

路线状态只有：

- `EXACT_ROUTE_OBSERVED`：Provider observation 证明实际命中该模型；
- `FALLBACK_CHAIN_OBSERVED`：实际路线发生 fallback；
- `ALIAS_UNPROVEN`：只有别名或声明，无法证明实际模型。

不同 route、模型、Thinking、工具、权限或 revision 永不混组。报告中的
configuration snapshot 来自整个分片的共同冻结值，不能拿第一条样本冒充整组。
fallback 和 alias 样本可以用于诊断，但不进入 exact-route 稳定结论、Flash/Pro
非劣比较或晋升证据。

### 7. 预执行难度与缺失机制

难度必须在执行结果之前冻结。`preExecutionDifficulty` 和 complexity vector 只使用：

- Task type、Acceptance clause 数、依赖数和风险；
- 上下文体量、允许工具数和工具可用性；
- Verifier 强度；
- Workspace drift；
- 战术/私有技能覆盖；
- 执行前可见的约束。

rework、Blocker、Radio、用户介入、失败和最终通过不能反向改变原始难度；它们是结果
指标。报告同时展示 task-type overlap、候选/基线平均难度和标准化难度差，失衡时
只允许观察性结论。

缺失原因区分：

```text
USER_CANCELLED
SYSTEM_CRASH
PROVIDER_UNAVAILABLE
EXTERNAL_DEPENDENCY
AGENT_FAILURE
MISSION_SCOPE_CHANGE
EVENT_GAP
SESSION_NOT_MATERIALIZED
UNKNOWN
```

原因映射到 MCAR、MAR、MNAR 或 UNKNOWN，并报告覆盖率、缺失率、选择偏差和
独立 Mission 数。用户取消、Provider 故障和系统崩溃不会静默变成模型失败，也不会
被无条件删除。

### 8. 指标与阶段化失败归因

每项率都公开 numerator、denominator、事件来源、缺失规则和计算状态。分母为零时
状态是 `N/A`；权威事件链不完整时状态是 `INCOMPLETE`。这两种情况都不得序列化成
数值 `0`，也不得进入配置排序或非劣比较。核心定义如下：

| 指标 | 分子 / 分母 | 权威事件 |
|---|---|---|
| Mission completion | 权威完成 Mission / 纳入 Mission | Mission terminal |
| First-pass acceptance | 首次提交即验收 Attempt / assigned Attempt | acceptance + lease |
| Final acceptance | 最终验收 Attempt / assigned Attempt | acceptance |
| False completion | 无 Evidence 宣告完成 Attempt / completed Attempt | terminal + Evidence |
| Regression escape | 回归逃逸 Attempt / accepted Attempt | verifier/integration |
| Handoff completeness | 完成交接 Attempt / 应交接 Attempt | handoff receipt |
| Parent wakeup | 已恢复父 Session / 已完成子代理 | bounded wakeup observation |
| Freeze recovery | 成功恢复 / 尝试恢复 | freeze/recovery receipts |
| Terminal duplicate | 同 lease 多个成功终态 / completed Attempt | terminal calls |
| Recovery drift | 恢复跨越陈旧 fence / recovery Attempt | identity/workspace fence |
| Permission violation | 越权 Attempt / assigned Attempt | Host denial |

失败阶段固定为：

```text
TASK_ORDER_AMBIGUITY
MODEL_TOOL_SELECTION
MODEL_ARGUMENT_SCHEMA
HOST_VALIDATION
PERMISSION_DENIED
PATH_SCOPE_REJECTION
TOOL_RUNTIME
WORKSPACE_STATE
VERIFICATION_FAILURE
INTEGRATION_FAILURE
PARENT_WAKEUP_FAILURE
PROVIDER_FAILURE
EXTERNAL_DEPENDENCY
USER_CANCELLATION
SYSTEM_CRASH
MISSION_SCOPE_CHANGE
UNKNOWN
```

工具 `schemaFirstPass` 只表示第一个必需工具调用通过 JSON Schema；路径、权限、
Workspace 或工具运行错误不能误算成 Schema 错误。只有同一工具在失败后再次调用
才计 correction/retry，正常的多文件连续写入不会被误判为重试风暴。

完整指标字典和缺失处理见
[绩效评估统计协议](quality/EVALUATION-STATISTICS-PROTOCOL.md)。

### 9. 统计区间与数据充分性

二项率使用 Wilson score interval。非二项指标和配置差异使用固定种子的
Mission-cluster bootstrap；独立单位是 Mission，不是 Attempt。一个 Mission 内的
返工和多个 Agent Attempt 不会扩大有效 N。

非二项区间具有明确状态：

- `AVAILABLE`：至少 2 个独立 Mission cluster；
- `INSUFFICIENT_CLUSTERS`：只有 1 个独立 cluster；
- `NO_DATA`：没有可计算数据。

报告同时显示 unique Attempt、unique Mission、effective independent Mission、
主区间宽度及逐项 sufficiency criterion。决策状态为：

```text
NO_DATA
EARLY_SIGNAL
EXPLORATORY
DECISION_ELIGIBLE
REGRESSION_ALERT
```

达到用户填写的 `minimumSamples` 只是条件之一；exact route、独立 Mission、
区间宽度、任务覆盖、难度平衡、权威事件完整性和安全硬门也必须满足。小样本只生成
继续采样建议，不输出伪精确全局排行。Mission completion、Specs coverage、
Integration outcome 和 parent wakeup 只有在各自完整 receipt/event 链存在时才进入
分母；缺链样本保留在 missingness 中，不被静默当作失败或成功。

### 10. Flash/Pro 受控比较

候选配置仅识别实际 observed model 名称含 `flash` 的 exact-route 分片；基线仅识别
实际 observed model 名称含 `pro` 的 exact-route 分片。比较要求：

- 角色相同；
- Task type 有覆盖；
- 预执行难度可比；
- 配置快照完整；
- 至少达到动态充分性要求。

存在至少 3 个共同 Mission 时使用 paired-Mission bootstrap；否则使用独立
Mission-cluster bootstrap，并把设计标为观察性。质量差异用置信区间和按角色配置的
非劣界限判断。

以下硬门不可被 Token、成本或速度抵消：

- 权限越界；
- 路径逃逸；
- 无 Evidence 宣告完成；
- regression escape；
- 重复成功终态；
- 父 Session 未恢复；
- recovery drift；
- 非 exact route 或数据不足。

即使没有可比 Pro 分片，exact Flash 分片触发硬门也会把报告提升为
`REGRESSION_ALERT`。评估输出只能是继续采样、改进实验、Canary 或晋升建议；
`promotionAllowed` 永远为 `false`。改变默认模型或 capability 状态必须经过独立、
显式批准并产生不可变治理 receipt。

### 11. Accepted Outcome 经济性

效率不按单次“看起来成功”的 Attempt 计算。系统先按 Mission 聚合到最终
Accepted Outcome，再累计该结果之前的全部代价：

- input/output/reasoning Token；
- model steps、tool calls、correction 和 retry；
- queue/model/tool/verification latency；
- fallback、重跑和 compaction；
- observed/estimated Provider cost。

核心值为：

```text
总 Token / final Accepted Outcome
总 latency / final Accepted Outcome
总 cost / final Accepted Outcome
p50 / p95 accepted-outcome latency
```

Token、latency 和可用 cost 都显示 Mission-cluster bootstrap 区间。成本只使用
实际 observed provider/model/route/version 对应的不可变 price snapshot；当前目录
价格、别名价格或其他 Provider 的近似价格不能反向改写历史成本。价格快照未知时成本
状态为 `PROVIDER_PRICING_UNAVAILABLE`，字段显示 unavailable，绝不以 0 美元参与
比较。Pareto 视图先通过质量与安全门，再比较 Token、延迟和可用成本。

### 12. 确定性报告与可选委员会叙述

默认 `narrativeMode=DETERMINISTIC`，因此评估不产生额外 LLM 调用。用户显式选择
`COMMITTEE_MODEL` 后，Examiner/Chair 只接收脱敏聚合指标、限制和 Evidence id：

- 不提供原始 Session 对话或任意文件浏览；
- 不提供工具；
- temperature 为 0，输出受长度限制；
- 输出必须通过严格 JSON Schema；
- 缺字段、额外字段、超长数组或无效引用全部拒绝；
- 失败时回退到确定性叙述。

委员会模型不能改变指标、区间、比较、决策、promotionAllowed 或报告谱系。

### 13. 报告发布不变量

发布前 Host 重新验证：

- Request Schema 与 request hash；
- Frozen Dataset Schema、Artifact digest 与 dataset hash；
- 每个 Attempt 和 configuration snapshot Schema；
- rubric/difficulty/schema/generator version；
- exact-route 和比较资格；
- individual totals 与 overall totals；
- classification、source artifacts 和 Evidence 引用。

任何 hash、总数、配置或 Schema 不一致都使 Job `FAILED`，不会发布“部分可信”的
Completed 报告。

### 14. 报告历史、申诉与 superseding revision

每份报告及其 Dataset 永久按 Artifact digest 引用。历史视图展示：

- `reportId@revision`、创建时间和状态；
- request/dataset/configuration 差异；
- 纳入/排除 Attempt；
- 数据限制、决策阻断和 Evidence；
- `supersedesReportId` / `supersededByReportId`。

有权限的本地用户可以针对固定 finding path 提交 Evidence 化申诉、撤回申诉或解决
申诉。成立或部分成立时，Host 根据明确的 Attempt exclusions 重新冻结 Dataset，
生成新的 reportId/revision，并链接原报告。旧报告绝不原地修改。申诉自身以及提交、
撤回、解决 receipt 都不可变。

RC.2 本地 Profile 是单用户边界；当前授权由 Host 的报告访问检查、执行确认 receipt
和本地设置权限共同执行，不能把它描述成企业多租户 RBAC。

### 15. Remote 与七个决策视图

新评估由 Settings 的请求表单创建；报告决策中心只通过
`militaryEvaluationCenter.snapshot/execute` 访问 Host。Remote 动作包括：

```text
GET_REPORT
GET_DATASET
CANCEL_RUN
RETRY_RUN
SUBMIT_APPEAL
WITHDRAW_APPEAL
DENY_APPEAL
RECOMPUTE_AND_SUPERSEDE
```

Settings 作用域与报告 Remote 是两个独立 Host 投影。WebUI 用
`runNonce:lastRunState:lastReportId:lastDatasetHash:lastError` 构成有界刷新栅栏：
`RUNNING`、`COMPLETED` 或 `FAILED` 状态变化都会重新读取 Remote snapshot；
完成时自动选择最新 `CURRENT` 报告并清除旧 Dataset 明细。SQLite 已发布报告但
浏览器仍显示“尚无报告”属于投影失败，不能要求用户通过关闭并重开弹窗来恢复。

同一个 `Military-绩效评估` 一级选项卡内部提供七个渐进披露视图：

1. 决策总览；
2. 角色与 Flash/Pro 配置比较；
3. 九场景热力图；
4. 工具调用漏斗与失败阶段；
5. 质量门前置的 Token/延迟/成本 Pareto；
6. Dataset、Attempt 与 Evidence；
7. 报告历史、申诉和改进实验。

所有视图显示唯一 Mission/Attempt 数、区间、路线状态、配置快照和阻断原因，不显示
无来源混合总分。组件沿用 DSH RC.2 原生 Button、Input、Dialog、Tabs、focus ring
和颜色 token；长 model id、简体中文 IME、键盘、200% zoom、窄视口和高对比度不得
破坏布局。

### 16. 固定 Flash 工作台的边界

`military-flash-core-v1` 固定九场景工作台用于快速验证工具合同、路径、写入 receipt、
终态、父唤醒和恢复因果链。Provider 样本的计数权威键为：

```text
datasetId + sessionId + scenarioId
```

解析器 revision 或重复评估不会增加 N。`schemaFirstPass` 只验证首个必需工具调用；
每个场景继续验证完整工具序列、receipt-bound path、多文件 distinct path、终态和
恢复链。发布级真实 Flash Provider 验收按 exact configuration × scenario 至少需要
50 个独立 Session；首次工具命中点估计必须不低于 95% 且 95% Wilson 下界不低于
85%，E2E 完成点估计必须不低于 90% 且下界不低于 80%，确定性失败、越权成功写、
假完成和重复终态必须全部为 0。少于 50 个独立样本只能报告
`INSUFFICIENT_SAMPLE`，不能晋升能力状态。

固定工作台和跨 Session 委员会评估可以互相引用 run/sample id，但不能合并样本量，
也不能把 deterministic Host case 当成 Provider response。真实 Provider 回归仍是
显式付费的外部证据，不由本地 deterministic 测试伪造。WebUI 导出的 Evidence 包可
由 `npm run acceptance:flash -- --input <export.json>` 离线重算；校验器会重新验证
dataset/sample hash、exact route、去重键、Wilson 下界和四项安全硬门，任何场景未
达到 `PASSED` 都以非零状态退出。

### 17. 运行与验收证据

纵向验收至少覆盖：

- 请求筛选、canonical hash 和 Schema parity；
- Task version/lease/generation 窗口与多源去重；
- exact route/fallback/alias 分层；
- 预执行难度、缺失机制和区间边界；
- Provider 重复样本与九场景因果验证；
- 未知成本；
- Job lease、取消、超时、失败分片重试和重启恢复；
- 报告历史、申诉、superseding revision 和旧设置迁移；
- 七视图、错误恢复、键盘、长文本、窄视口和真实安装。

源码门禁通过并不等于真实 Flash Provider 已通过。发布报告必须把本地确定性证据与
真实 exact-route Provider Session 证据分栏陈述。


---

<a id="part-58"></a>

## Part 58：58. Worker Workspace 与子代理创建运行时

源文件：`docs/58-worker-workspace-and-child-spawn-runtime.md`

### 1. Worker 准入

Worker 必须携带明确 `taskId`。Host 读取 Task Order 并验证：

- Task 属于当前 Mission；
- assignedRole 为 `worker`；
- local `main` 快照 clean；
- read/write/forbidden paths 已冻结；
- 预算和模板可实例化。

缺少任一条件时不创建 Agent。

### 2. Workspace Snapshot

Snapshot 包含：

```text
repository/head/branch/tree
working-tree dirty hash
tracked-file manifest Artifact
environment Artifact
createdAt
```

根工作树脏时拒绝 Worker lease，防止 Candidate 基线包含未归属的用户变更。

### 3. lease 和 worktree

WRITE lease 创建 detached Git worktree：

```text
$DATA_ROOT/workspace-state/worktrees/<leaseId>
```

Worker child 的 RC.2 `meta.cwd` 指向该目录，不指向父 Agent 工作目录。Tool/Permission Pipeline 仍按 Task path scope 二次校验。

轻量模型默认不接触执行机绝对路径。Host 只向当前 Task 暴露
`military_workspace_read/search/write/edit` 等 Task-rooted 工具；模型参数使用相对
路径，Host 绑定 `taskId + taskVersion + leaseId + workspaceRoot` 后再做 canonical
解析、symlink 防逃逸和 read/write/forbidden scope 授权。绝对路径、盘符路径、
`..` 逃逸和未绑定 Task 的写入在产生副作用前确定性拒绝。

### 4. immutable binding

Workspace 分配写入 `AgentExecutionBinding.workspace`：

```text
leaseId
snapshotId
taskId
taskVersion
executionRootHash
```

绑定在 `agents.create()` 和第一个 prompt 之前持久化。子 Session 还记录 `military/workspace-assigned`，用于 UI、审计和恢复。

Snapshot、Lease、Candidate Patch 和 Integration Order/Receipt 全部进入生产
Workspace Store。启动对账只会 adopt 已证明属于当前 lease 的 worktree，无法证明
身份的目录进入 quarantine；不得因为数据库缺行就递归删除现有目录。

### 5. Candidate Patch

Worker 调用提交工具后：

- 读取实际 Git status；
- 验证所有 changed paths 在 write scope 且不命中 forbidden paths；
- 生成 binary/full-index patch；
- 把 Patch 作为内容寻址 Artifact 保存；
- 生成 `CandidatePatch` 和 SHA-256；
- Candidate 只引用 Patch，不直接改 local `main`。

### 6. 受控 Integration

Harness Integration Executor：

1. 要求 local `main` clean；
2. 验证 expected HEAD/tree；
3. 应用已验收 Patch；
4. 运行全局回归；
5. 成功后 local-main commit；
6. 写 `IntegrationReceipt`；
7. 失败时回滚到 beforeHead。

唯一允许的 `reset --hard` 是以上 clean-main 事务回滚，代码审查会拒绝其他位置。

### 7. 释放

- child 创建失败：Spawner 释放 lease；
- child 正常/异常 dispose：Host 在 `finally` 中释放 lease；
- Host 关闭：逐个调用统一 release path；
- Worktree remove 失败：保留审计错误，后续清理器可重试；
- 释放不会删除 Candidate/Artifact/Ledger。

释放以 exact Activation/lease fence 为准。用户 Stop 默认只取消当前 Invocation 或
Activation，不终止稳定 Agent identity，也不把 `AWAITING_GUIDANCE`、
`AWAITING_DECISION`、`REWORK`、`FROZEN` 或成功 Specs Task 重置为 READY。迟到、
重复和乱序 settlement 由 durable idempotency key 收敛。

### 8. 非 Military 同工作区会话

普通会话不会加入 Military Workspace lease 表，也不能被 Military Oversight 冻结。若它修改物理工作树，Military 在下一 Snapshot/Integration 检测 dirty/head/tree drift，并暂停当前事务；Military 不控制该普通会话。


---

<a id="part-59"></a>

## Part 59：59. RC.2 Web Client 打包与页面能力

源文件：`docs/59-web-client-packaging-and-surfaces.md`

### 1. 动态包 Manifest

Military WebUI 是动态 Client 包。`package.json` 必须声明：

- `dsh.client.inject`：需要同时装载的插件包；
- `dsh.client.external`：仅非 baseline、需要共享运行时身份的 value import；
- Cordis 和 DSH peers 在 `peerDependencies` 与 `devDependencies` 使用匹配版本；
-已发布 `files` 覆盖所有 JS、d.ts、map 和 CSS 资产。

React、Cordis 和 Client Runtime 不重复写入 `external`。直接 value-import 的
官方 primitive 必须进入 `dsh.client.inject`，由 RC.2 Loader 提供同一模块与
React/theme identity；Military 当前显式注入
`@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`。
type-only import 不形成模块请求。

### 2. Browser Artifact

动态 Browser 产物仍以 module-loader factory 交付：

```js
window.__ModuleLoader__.load({ id: '@dsh-military/webui', factory: require => { ... } })
```

构建门禁检查请求的 external/inject 有供应者、无同步环、无未声明 workspace
value import。Military 的布局 CSS 以 text loader 内联进同一个 `client.cjs`，
运行时只安装一个带稳定 `data-plugin-css` 标识的 style，不另发主题资产。
原生 primitive 的 CSS-module class 始终拥有视觉优先级；raw HTML control
fallback 必须包在零 specificity 的 `:where(...)` 中，不能用 scoped
`:not([data-*])` selector 覆盖原生 radius、padding 或 active fill。
Military 不使用 `staticLinked()`，除非未来被正式纳入 DSH Web Shell。

### 3. Settings Shared Mirror

RC.2 `ui-settings` 拥有唯一 `settings.describe` mirror，并监听 document update 与 connection reset。Military 每个 namespace 只调用 `ctx.settingsScope.bind()` 派生 Scope，不自行调用 describe 或建立重复 invalidation listener。

### 4. 运行态投影边界

RC.2 没有外部 required Session Event 注册面。0.9.0-alpha.28 因而不注册
Military Conversation Node，也不把 Mission/Task/Radio/Freeze/Candidate 写入
DSH Session Log。Settings 基础字段读取 RC.2 shared mirror；角色治理、诊断/
恢复、Workspace、固定评测、Runtime Center 和私有知识通过插件自有窄 Typert
`snapshot/execute` Remote 读取 Host projection。

当前 Runtime Center 遵守以下 Host Remote/Projection 合同：

- 以 `tenantId + missionId` 查询 Mission read model；
- 使用稳定业务 ID、source revision、generatedAt、staleAfter 和 health 更新；
- 浏览器不直连 SQLite；
- DSH Session 只承载模型可见 `user/message` 和上游已知事件；
- 可选 Conversation renderer 只消费插件自有投影，不把 Session Log 变成第二个 Mission 真源。

### 5. 已实现页面

- 一个 `sidebar.footer.action` occupant 纵向承载“Military 设置中心”、
  “Military Session 运行中心”和“知识与技能”三个独立入口；三者与 DSH
  Settings 共用 42px 展开行、36px
  收起圆形点击域及相同 margin/padding/radius/hover 合同，不会在 RC.2 的
  横向 list seat 中挤出侧栏；`shell.overlay` 分别挂载两个原生 Headless
  Modal；
- 左侧固定七个 Military 一级选项卡，不再注册 `settings.section`；
- General 和 11 个部门模板的 DSH 模型目录下拉框；
- 模型、推理、输出、上下文、并发、压缩与模板生命周期表单；
- General 和 11 个部门的简体中文自带提示词、可视化编辑、逐角色恢复和全量
  恢复；Host 不可编辑边界在实际 Prompt Assembly 中强制追加；
- 可搜索角色目录、单角色编辑、未保存草稿保护、六层有效提示词、字段 Diff、
  immutable revision/回滚和安全导入导出；
- 确定性 Flash readiness、实际 ToolProfile 离线模拟、显式只读在线 Canary、
  经济/标准/深度预算及模型目录能力/价格证据；
- 自然语言简体中文辅助检查、逐项/批量确认、单批撤销和 Host hash-bound
  审阅回执；
- Execution/Staff/Tag/Tactic/Oversight/Specs/Memory/Evaluation/Presentation
  七分区可视化界面；
- Session 诊断时间线与先预览/精确确认/幂等 receipt 的安全恢复操作；
- 仅按 Host `workspaceId` 选择的 Specs 工作区，包含 canonical/Git/path/lease/
  integration 状态；
- Request→Mission→Direction→Wave→Task→Attempt→Activation→Dispatch
  Runtime Center，以及 Candidate/Verification/Integration、Radio/Decision、
  Budget/Receipt 层级；
- 共享 timeout/abort/dedupe/backoff/revision query boundary 和跨标签页失效通知；
- 固定九场景评测、dataset hash、deterministic/Provider 分栏、exact route
  样本、N≥50/Wilson/零安全失败 acceptance 与 evidence export；
- Knowledge Center 七视图，包含 sanitized pipeline/lineage 和与真实 recall
  共用 resolver/renderer 的无 Task 模拟召回；
- Host 保存确认、字段级恢复默认、模板 revision 串行写入；
- RC.2 shared settings mirror；
- 正确的 dialog/tab/listbox ARIA、方向键/Home/End、IME 保护、焦点捕获/返回、
  zoom/长文本/forced-colors/contrast/reduced-motion 合同；
- lazy module-loader artifact 和 manifest/peer-dev 门禁。

把 Military 私有节点直接嵌入 DSH Conversation Log、自定义 Advisor 向导和
分布式 server push 属于后续 Web 里程碑，不在当前实现报告中标记为完成。

### 6. 安全

Browser 不获得 SQLite handle、credential、Raw Vault reference、任意文件 API
或 base64 图片。Workspace absolute root 只作为 Host 投影显示，不能作为选择
输入回传；Secret、模型参数和诊断路径先在 Host 脱敏，图片只显示 Attachment
reference 和经过授权的缩略图。


---

<a id="part-60"></a>

## Part 60：60. Mission Kernel 2.0 与单写者 Command Bus

源文件：`docs/60-mission-kernel-2-and-command-bus.md`

### 1. 决策

每个 Mission 以 `tenantId + missionId` 为串行化分区键，由一个 Mission Kernel 独占权威写入。General、Staff、Worker、Engineer、Verifier、Radio、Oversight 和 Research 只能提交 Command；它们不能直接改变 Task、Wave、Budget、Lease、Candidate 或 Integration 的权威状态。

```text
Command
→ authority check
→ budget reservation
→ revision/state validation
→ durable command intent / effect lease
→ external operation（SQLite 事务外）
→ effect checkpoint
→ domain receipt + transactional outbox
→ projection / operation COMMITTED
```

### 2. Command Envelope

每个 Command 必须携带：

- `commandId` 与 `idempotencyKey`；
- `tenantId`、`missionId`、`expectedRevision`；
- actor 的 `AuthorityContext`；
- 可选 `taskId`、`taskVersion`、`activationId`；
- 结构化 payload；
- deadline 与 cancellation provenance。

同一幂等键但 payload hash 不同必须拒绝，不能把语义不同的操作误判为重试。

### 3. 双日志边界

```text
Military Mission Ledger = Mission 领域事实真源
DSH Session Log         = 会话、模型可见历史和 UI 投影真源
```

Mission Event 可以通过 Session Projection Adapter 镜像为 `ignorable: true` 的 Military Session Event；Session Event 不能反向独立推动 Mission 状态。

### 4. Command Saga、Activity 与外部副作用

Git、Workspace、模型 Activation、企业 API、Artifact、Integration 和 specs commit 通过 Durable Activity 执行。Mission Event 记录业务决定，Activity Store 记录精确句柄、attempt、lease、receipt 和补偿状态。

SQLite 事务是同步短事务，绝不等待模型、Provider、Git、文件系统或长验证。每条
Command 使用稳定 `operationId` 和语义 fingerprint，依次经过：

```text
PENDING_EFFECT → RETRYABLE / EFFECT_APPLIED → COMMITTED
```

执行者先在短事务中取得带 fence 的 effect lease；外部 operation 在事务外运行；
随后用短事务写入 effect checkpoint，最后原子提交领域 receipt、transactional
outbox 和 `COMMITTED` fence。超时或客户端断线后必须先按 operationId 查询 receipt，
不能盲目重放副作用。相同幂等键但 fingerprint 不同返回
`IDEMPOTENCY_CONFLICT`。错误持久化只保留类别和摘要指纹，不保存路径、Provider
载荷或 Secret。

### 5. 恢复

进程启动时按以下顺序恢复：

1. 校验数据库 migration；
2. 重放 Mission Ledger；
3. 重建 Projection；
4. 恢复未完成 Command Saga、Activity 和 transactional outbox；
5. 对账 DSH Session/Child、Workspace、Git、Artifact 和 operation receipt；
6. 对过期 effect lease、可重试 Activity 与 outbox 重新 claim；
7. 对不确定副作用进入 `RECONCILIATION_REQUIRED`，先查询 postcondition 再决定
   重投或补记 receipt。

### 6. 不变量

- 同一 Mission revision 只允许一个成功写者；
- 领域 receipt/Event、Outbox 和 Command `COMMITTED` fence 在同一短事务提交；
- 任何 SQLite transaction callback 返回 Promise/thenable 都必须回滚并拒绝；
- 接受 Candidate 的 Event 必须引用独立 Verification Receipt；
- Integration Receipt 产生前，Task 不得成为 `INTEGRATED`；
- Session 镜像失败不能回滚已提交 Mission 事实，但必须进入可重试 Outbox；
- FROZEN Activation 不能获得新的写 Activity。


---

<a id="part-61"></a>

## Part 61：61. Context Compiler、Claim–Evidence Graph 与分层验收

源文件：`docs/61-context-compiler-and-evidence-graph.md`

### 1. Context Compiler

每次模型请求前，系统编译四类上下文：

```text
Constitution：用户硬约束、Mission Intent、权限、Acceptance
State：当前 Direction/Wave/Task、revision、lease、budget、blocker
Evidence：当前 Task 需要的 Artifact、Diff、测试、Receipt、Guidance
Working：可压缩的尝试、假设和自由讨论
```

输出 `ContextManifest`，至少记录 Mission revision、Task version、内容 hash、输入 Event、Evidence 引用、被省略引用、摘要覆盖范围和各类 Token 配额。 每份 Manifest 必须在请求前持久化为内容寻址 Artifact，并以 `context/manifest-created` Administrative Event 记录 `manifestId`、ArtifactRef、Mission、Task、Agent 和时间。内存注入只是消费视图，Artifact 与 Admin Ledger 才是审计和重放依据。

### 2. RC.2 推理历史预算

DeepSeek RC.2 会把每个带 reasoning 的 Assistant Turn 的 `reasoning_content` 回传到后续请求。因此 Context Compiler 必须使用真实 request usage 动态校准，不能按 RC.7 的工具回合限定规则估算。压缩阈值使用有效输入、reasoning passback、图片占位和 cache-read 指标。

### 3. 图片证据

RC.2 支持配置为 `inputModalities: [text, image]` 的 DeepSeek 模型。Mission Ledger 只保存 Attachment/Artifact 引用和分类，不保存 base64。Router 必须在投递前验证模型图像能力、图片预算、数据驻留和 redaction policy。

### 4. Claim–Evidence Graph

Acceptance Contract 由 Claim 组成。Candidate 只有在每个必需 Claim 都存在当前有效 Evidence 时才可接受。

```text
Claim
├── Evidence requirement
├── Evidence links
├── validity scope
├── produced-at revision
└── revocation/expiry
```

Evidence 可以是 Artifact、Event、Tool Call、Git Commit、API Receipt 或 Human Authorization。

### 5. Verification Tier

- V0：Schema、版本、ID、Artifact hash；
- V1：类型、Lint、依赖和静态安全；
- V2：单元、组件和工具模拟；
- V3：真实 Workspace、Git、数据库、浏览器和 API；
- V4：需求满足度、架构与可维护性语义评审。

V4 不得成为唯一接受依据。任何 `ACCEPTED` 至少要有一项独立 V0–V3 Evidence。

### 6. Verifier 质量

系统持续记录 false accept、false reject、flakiness、coverage、runtime 和版本。Verifier Profile 变更必须产生新 revision，历史 Receipt 不追溯重解释。


---

<a id="part-62"></a>

## Part 62：62. 自适应执行 Router、Capability Profile 与并行度

源文件：`docs/62-adaptive-execution-router-and-parallelism.md`

### 1. 角色不是能力

部门名称不产生权限或模型能力。一个 Activation 的实际执行条件由以下交集决定：

```text
Agent Template
∩ Task Capability Profile
∩ Model Capability Profile
∩ Tool/Permission/API Grants
∩ Data Residency
∩ Resource Budget
```

### 2. Execution Strategy

Router 输出：

```ts
interface ExecutionStrategy {
  modelRoute: { provider: string; model: string }
  reasoningEffort: 'low' | 'high' | 'max'
  paradigm: 'direct' | 'react' | 'plan-execute' | 'reflection' | 'multi-agent'
  maximumSteps: number
  verificationTier: 'V0' | 'V1' | 'V2' | 'V3' | 'V4'
  parallelism: number
}
```

角色只定义最低约束，任务风险和证据要求决定实际策略。General 的模型仍以 Military preset 默认开始并跟随用户会话选择；Department Agent 使用冻结 Template Route。

### 3. Parallelism Score

```text
独立子问题 + 独立证据源 + 可分离工具
- 共享上下文 - 写冲突 - 时序依赖 - Join 成本 - Integration 风险
```

低分默认一个 Worker；只有高可并行性任务才允许 3–5 个 Worker。探索分支必须只读或使用隔离 Workspace。

### 4. Plan IR

Staff 生成 Plan Proposal，确定性 Plan Compiler 生成 Direction/Wave/Task DAG，并检查：

- 环与孤儿 Task；
- read/write scope 冲突；
-接口未定义；
-验收覆盖；
-权限、模型、工具、Verifier 和预算可达性；
- Join 与 rollback。

模型不能直接绕过编译器创建可执行 Task。


---

<a id="part-63"></a>

## Part 63：63. Agentic Zero Trust 与短期 Capability Grant

源文件：`docs/63-agentic-zero-trust-and-capability-grants.md`

### 1. 原则

每个 Agent、外部内容、历史 Memory 和工具意图都默认不可信。Prompt、角色名和模型自报不能产生权限。

### 2. Capability Grant

每个 Activation 在 Task 准入时获得短期 Grant：

```text
principal + activationId + mission/task/version
allowedTools + resourcePatterns + data ceiling
maximumUses + expiresAt + nonce + policy revisions
```

工具调用时重新验证 Grant、当前 Task revision、Freeze 状态、预算和资源路径。Grant 撤销立即阻断后续写操作。

### 3. 内容污染标签

文件、Web、企业 API、历史会话、用户粘贴和图片都携带：

- source/provenance；
- trust level；
- classification；
- prompt-injection risk；
- temporal validity；
- allowed audience。

Context Compiler 在输入层过滤，Tool Guard 在动作层再次校验。

### 4. 用户注意力预算

`ask_user_question` 由根 General 独占。Decision Broker 合并相关问题，并记录每 Mission 的最大问题轮次、问题数、高风险保留额度、超时和默认策略。每个问题必须展示为什么问、推荐项、风险、可撤销性和不回答后果。


---

<a id="part-64"></a>

## Part 64：64. 可观测性与决策链绩效评估

源文件：`docs/64-observability-and-decision-chain-evaluation.md`

### 1. Trace 结构

```text
Request / WorkflowObligation
  → Mission → Direction → Wave → Task
  → Attempt → Activation → Dispatch
  → Model/Tool → Candidate → Verification → Integration
```

稳定属性包括 Request/Obligation、Mission/Direction/Wave/Task/version、
Attempt/Activation/Dispatch、Template revision、observed route/capability profile、
reasoning、战术、Verifier、Workspace Snapshot/lease、Candidate/Integration、
operation/outbox、Token、延迟和重试。Session Snapshot 只证明历史存在；运行中状态
必须由新鲜 start/heartbeat receipt 证明。

Prompt、Secret、完整工具载荷和用户内容默认不进入遥测；只有显式策略允许且完成脱敏时才能记录。

### 2. 评估对象

绩效不只按 Agent 名称统计，而按完整配置组合：

```text
templateRevision + model + reasoning + promptVersion
+ tacticVersion + verifierVersion + task difficulty
```

报告分别评价 Planning、Routing、Execution、Verification 和 Integration，避免把错误计划或薄弱 Verifier 归咎于 Worker。

比率必须保留 numerator、denominator 和 `AVAILABLE/N_A/INCOMPLETE` 状态；权威
Mission completion、Specs、Integration 或 parent wake 事件缺失时不得填 0。成本
只使用 observed exact route/version 的不可变 price snapshot，未知价格不进入
Pareto。

### 3. 实验

Template、Prompt、Router、Tactic 和 Verifier 变更使用 Shadow、Canary、Matched Control 或 A/B。Stable 晋级必须有最小样本、置信区间、负面指标和 rollback。

Flash 发布级验收按 exact configuration × scenario 独立统计，`N≥50`，并同时满足
首次工具命中点与 E2E 完成点的点估计/Wilson 下界以及四项零容忍安全硬门。确定性
Host 测试与真实 Provider 样本分栏，前者不能扩充后者 N。


---

<a id="part-65"></a>

## Part 65：65. DSH RC.2 兼容与适配迁移

源文件：`docs/65-rc2-compatibility-and-adapter-migration.md`

### 1. 固定基线

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

`0.9.0-alpha.28` 源码只对该提交声明完整支持。旧版部署继续使用其匹配发布包，不在同一进程混装两个 DSH runtime identity。

### 2. 稳定面

Preset、Agent Core、Model Selection、Tool Registry、Host Settings、Ask User、Compaction 和 LLM Core 的关键公开接口保持兼容。

### 3. 必须迁移的接口

#### Continuable Subagent

- `SubagentReportDelivery`：`wakeup` 改为 `next-step`；
- `startContinuable()` 支持调用方预留 `childId`；
- 新增选择性 `drainContinuableChildren(parent, childIds)`。

Military 必须在子 Agent 建立前持久化预留 child id、AgentExecutionBinding、Task/Workspace assignment；重复 ID 需要对账后接管或隔离。

#### Command

`commands.execute()` 新增 images 参数；`CommandInvocation` 新增 `attachments`。`/brainstorm` 声明 `images: true`，将草图、截图和架构图作为 Attachment Evidence 纳入 Brainstorm Context。

#### Web Client

动态包使用 RC.2 的 `dsh.client.inject` 与 `dsh.client.external` 规则，peer 必须有匹配 dev dependency。Settings 读取使用共享 describe mirror；Military 不自行建立重复 invalidation reader。


#### Session Log

RC.2 的 known-event catalog 不提供第三方 required-event 注册。Military 不再声明或追加 `military/*` DSH Session Event；Mission/Task/Radio/Freeze 等事实只写 Military Ledger，模型输入使用已知 `user/message`，Web 运行视图使用后续插件自有 Remote/Projection。

#### Worker cwd

标准 continuable child 继承父 Session 的 cwd。写 Task 的真实 worktree 通过不可变
`AgentExecutionBinding.workspace` 绑定给 Host；Worker 只看到
`military_workspace_read/search/write/edit` 的 Task-rooted 相对路径合同。Host 在
不可见的 execution root 下完成 canonical 解析，再与 Task
read/write/forbidden scope 比较；模型提交绝对路径、盘符或 `..` 逃逸会在副作用
前被拒绝。

#### DeepSeek

Model Capability 增加 input modalities、图片请求预算和 RC.2 reasoning passback 语义。Context Budget 和绩效成本按真实 usage 校准。

### 4. Experimental Agent Team

RC.2 Agent Team 只能作为可选非权威投影或 UI 实验，不得取代 Mission Kernel、Staff Radio、Workspace Lease、Verification 或 Military Task Ledger。

### 5. 兼容门禁

```bash
pnpm verify:rc2
DSH_RC2_ROOT=/path/to/exact-built-rc2 pnpm typecheck:rc2
```

第一项核对官方来源哈希快照、`next-step`、预留 childId、选择性 drain、Command 图片、SettingsScope、Client manifest 和 DeepSeek 能力策略。第二项在固定 commit 的真实上游声明上编译全部生产源码；上游必须先执行 `pnpm run build:lib`。只有第二项成功才可把 `sourceCheckoutVerified` 标记为 true。


---

<a id="part-66"></a>

## Part 66：66. Legacy → RC.2 升级运行手册

源文件：`docs/66-legacy-to-rc2-upgrade-runbook.md`

### 1. 升级前

- 停止新 Mission 准入；
-完成或暂停 Integration；
-备份 SQLite、Artifact、specs、local main 和 preset generation archive；
-导出 Compatibility Report 与未完成 Activity；
- 记录升级前 DSH release、commit、Bundle version 和 Preset generation。

### 2. 安装

- 安装 `dsh@0.1.1-rc.2` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；
- 安装 `dsh-military 0.9.0-alpha.28`；
- 运行 migration dry-run；
- 验证 Web client package manifest；
- 重新计算 Military preset generation；
- 运行 Compatibility Probe。

### 3. Fixture

必须覆盖：

1. Military/Standard 同 cwd 隔离；
2. General preset 默认和会话模型切换；
3. 预留 childId 的 continuable Worker；
4. `quiet` 与 `next-step` report；
5. selective child drain；
6. `/brainstorm` 文本和图片；
7. Settings shared mirror；
8. Candidate → Verify → Integrate → specs commit；
9. 旧 Session 冷恢复或显式 migration；
10. `alpha.24` 模板 revision 6 经精确 revision 7 资产升级到 revision 8，且
    已高于内置版本的用户模板不被降级或覆盖；
11. Workbench stale Desired 先按 exact runtime revision 和 package base 三方
    合并，再应用 runtime head；General、用户字段、历史和较新模板保持；
12. `military-agent-templates` mirror 经 Settings CAS 从 runtime heads 重建，
    第二次启动不新增 template/Workbench revision；
13. archive-only generation quarantine。

### 4. 回滚

RC.2 写入新的 Military Ledger Event、Activity State 或 Military Schema 后，
不允许直接用旧 Runtime 继续同一可变 Mission。`0.9.0-alpha.28` 不写未知
`military/*` DSH Session Event。回滚应恢复升级前整套数据备份，或把已认证事实
导入新 Mission；不得让两个版本同时写同一 Mission Ledger。


---

<a id="part-67"></a>

## Part 67：Military 控制中心、Flash 工作台与可访问性

源文件：`docs/67-military-control-center-flash-workbench-and-accessibility.md`

### 1. 交付范围

`0.9.0-alpha.28` 保留并深化此前分散在 Settings、运行日志和设计文档中的 15 项产品能力，
收敛为两个 DSH RC.2 原生入口：

```text
Military 设置中心
知识与技能
```

两个入口共同占用一个 `sidebar.footer.action`，点击域、展开/收起几何、颜色、
焦点样式和 Modal 均继承 DSH Web。浏览器只提交浅层意图；模型目录、Prompt
编译、Workspace、SQLite、Git、权利、召回、评测和恢复的权威判断全部在 Host。

### 2. 十五项实现

#### 2.1 角色目录与单角色编辑器

“Military-部门模型”包含 General 和 11 个内置部门角色。目录支持按名称搜索、
按部门和状态筛选，一次只挂载一个编辑器，避免把 12 套专业字段同时暴露给用户。
目录行显示 exact route、模型验证状态、草稿状态和 Flash 就绪摘要。

角色切换、一级选项卡切换和关闭弹窗都会检查未保存草稿。保存、放弃、恢复默认
是明确动作；中文输入法 composition 期间的 Enter、方向键或快捷键不会误触。

#### 2.2 Host 编译的有效提示词预览

预览直接复用实际 Prompt Assembly 的六层编译器：

```text
可编辑角色指导
→ Host 身份与权限边界
→ 工具面与终态边界
→ Workspace 与路径边界
→ 证据与完成边界
→ 模型与运行预算
```

UI 展示每层是否可编辑、是否依赖运行时、token/简体中文字符估算及逐行 Diff。
前端不能提交“最终提示词”，也不能通过编辑角色正文删除 Host 层。

#### 2.3 确定性 Flash 就绪检查

离线检查覆盖工具存在性、工具数量和 Schema 复杂度、Host 字段泄漏、路径猜测、
权限扩大、停止规则、终态歧义、receipt 规则、上下文和输出预算。问题包含稳定
code、级别、位置、简体中文解释和可执行修复建议。

检查不调用模型，不消耗额度；同一输入产生同一语义结论。`BLOCKED` 不能进入
生产启用，但系统不会因此静默切换 Pro 或扩大工具权限。

#### 2.4 角色模拟与显式在线 Canary

“离线模拟”使用该角色真实 ToolProfile 和 Schema 验证工具发现、首次调用、
一次纠正、终态和父级 receipt，不调用 Provider。“在线 Canary”仅在用户点击并
输入 `RUN_SAFE_READ_ONLY_CANARY` 后执行，范围固定为只读安全探测。

结果记录 exact provider/model、原始工具选择、Host 归一化参数、Schema 结论、
tokens、可用时的费用和延迟。Canary 不自动晋升、不自动 fallback，也不写
Workspace。

#### 2.5 事务化设置、冲突与可移植导入导出

模型、推理、预算和提示词形成一个带 revision 的角色草稿。Host 在一次事务中
校验 exact route、模型能力、提示词、简体中文审阅回执、预算和当前 revision；
任一字段失败不会留下部分保存。

外部更新和多标签页冲突提供字段级 Diff、采用外部版本、保留本地草稿和 rebase。
导出只包含可移植角色设置；凭据、绝对路径、Session、运行 receipt、SQLite
状态和 Provider 响应不在可表示类型中。导入必须先预览再提交。

Bundle 升级时，持久化 Desired 可能落后于已经前移的运行时模板。Host 先要求
Desired 与其声明的 exact immutable runtime revision 一致，再以 package-owned
历史资产为基线做三方合并：未修改的内置字段采用 current runtime head，
`USER_SAVE`、`ROLLBACK`、`IMPORT` 中真实发生变化的 status、route、
reasoning、预算、并发和 prompt 才作为用户意图重放。工具、权限和 capability
authority 始终来自当前 package。升级历史使用 `PLUGIN_MIGRATION`，但不会在
下一次升级中被解释成用户修改。

兼容镜像 `military-agent-templates` 不参与运行时真值裁决；runtime projection
成功后，Host 从 exact template heads 重建它并使用 Settings revision/CAS 写回。
只有镜像也成功收敛后 Desired/Applied 才进入 `APPLIED`。失败可重试，已经应用
的 immutable revision 不会再次追加。

#### 2.6 Session 诊断时间线

“Military-安全与恢复”按真实 RC.2 Session event 和 Host observed receipt
投影模型请求、可见工具、原始选择、Schema、Host 补全、Grant、路径、执行、
终态和父级唤醒。角色、Task、工具、阶段和严重度过滤在 Host projection 上执行。

凭据、绝对路径和超长模型参数在 Host 端脱敏、截断；UI 不能推断完成、修改历史
或用模型文字替代 receipt。

#### 2.7 受治理安全与恢复

健康快照覆盖 SQLite/WAL、备份、Preset generation、Bundle 版本、Mission、
Task、live child、worktree/lease、Grant、outbox 和终态 receipt。可执行动作：

```text
VERIFY_DATABASE
CREATE_BACKUP
RECONCILE
REQUEUE_STALE_OUTBOX
RELEASE_EXPIRED_RESOURCES
WAKE_PARENT
```

每个动作先生成影响范围、风险、`operationId` 和精确确认短语；执行时 Host 重新
计算预览并校验确认。结果以幂等 receipt 持久化，进程重启后重复请求返回原结果。
不存在原始 SQLite 编辑、手工标记完成或无证据删除。

#### 2.8 不可变提示词历史与回滚

每次保存、导入、恢复默认和回滚都创建新 revision，保留来源、时间、语义 Diff、
完整 Flash readiness、简体中文审阅回执和当时的模型/预算。回滚不是覆盖旧记录。

Session 创建时固定角色 revision；后续 Settings 变化不重写 live Session。
历史页按 exact revision 汇总 Session、tokens、工具成功率、模拟和评测引用。

#### 2.9 能力驱动的模型目录

下拉框由 DSH live `llm.models` 与 Military capability evidence 合并，状态统一为：

```text
VALIDATED
CANARY
UNVERIFIED
INCOMPATIBLE
UNAVAILABLE
DEPRECATED
```

目录显示 exact provider/model、reasoning、tool calling、上下文、输出上限、
输入模态、价格状态、alias 证据和状态 revision。当前 DSH live adapter 中的
所有路线都可选择；状态和绩效样本只提供 Evidence，不再充当可用性权限。只有
不在当前 DSH live 目录中的旧路线不可选择。轻量路线保持默认主力，Pro 只由
用户显式选择。

#### 2.10 可理解的执行与成本

经济、标准、深度、自定义预算同时显示 output/context token、简体中文字符估算、
并发、历史 observed token、工具成功率和价格可用时的 USD 估算。Provider 未给
价格时显示“不可用”，不伪造费用。

预算预设只改变资源上限，不改变 ToolProfile、PermissionProfile、Verifier、
证据、终态、路径或安全规则。

#### 2.11 Specs 工作区可视化

RC.2 没有供外部 Client 使用的原生目录选择 seam，因此浏览器不能提交绝对路径。
Host 从已绑定 Session 的权威 workspace 构建目录，Client 只回传不透明
`workspaceId`。

选中后展示 canonical root、root hash、Git HEAD/branch/tree、dirty/untracked、
allowed/read-only/forbidden/unscoped 路径、Task lease、worktree、Candidate、
integration、receipt 和真实角色路径示例。所有状态来自执行时使用的同一
canonicalization、Git 和 SQLite 链；未知 ID、symlink escape 和任意路径失败
关闭。

#### 2.12 固定数据集评测工作台

固定数据集 `military-flash-core-v1` 由九个场景组成：

```text
只读分析
创建文件
编辑多个文件
Specs 原子事务
Schema 一次纠正
父级唤醒
路径拒绝与纠正
重复终态闩锁
重启恢复
```

dataset hash、Bundle/Preset、角色 revision、exact route、reasoning、
ToolProfile 和预算进入每次结果。确定性运行与真实 Provider Session 评估分栏，
指标包括首次命中、Schema 首次通过、纠正、完成、父唤醒、写 receipt、tokens
和延迟。Provider 样本以 dataset + Session + scenario 为计数权威，parser
revision 或重复解析不增加 N。观察趋势在相同 exact route/场景少于 10 个独立
Session，或 Wilson 区间宽度大于 0.35 时，只能显示
`INSUFFICIENT_SAMPLE`；发布 acceptance 独立要求每个 exact
configuration × scenario `N≥50`，并执行首次工具/E2E Wilson 门和四项零安全失败。

每个场景验证完整因果链，而不是仅验证首工具和 Session 结束：创建/编辑场景要求
Host receipt-bound path，多文件场景要求 distinct path，路径纠正要求最终安全相对
路径，父唤醒和重启恢复要求 bounded event sequence。`schemaFirstPass` 只表示首个
必需工具调用通过 JSON Schema，权限、路径和运行错误不得混入。

确定性治理门精确识别 General 的 Host 内建
`general-host-authority@0` sentinel；它不是可选 PermissionProfile。部门角色
仍必须使用正数 permission revision，伪造 General 权限名和部门 `@0` 都会失败
关闭。默认安装的九场景门因此既不误报 General，也不放宽部门治理。

#### 2.13 简体中文提示词辅助检查

lint 只扫描自然语言，跳过 fenced code、inline code、路径、工具名、变量和
标识符。用户可以逐项应用、应用全部已选择建议、确认保留剩余项，并撤销上一批
转换；不会静默全文替换。

保存时 Client 只提交源文本、确认位置和“保留剩余”意图。Host 重新扫描、应用
精确位置、计算 source/result SHA-256 并生成不可变审阅回执；伪造位置、结果或
未确认的剩余问题被拒绝。插件自带 12 个提示词通过同一 lint。

#### 2.14 知识透明度与模拟召回

Knowledge Center 展示 sanitized snapshot、redaction/injection receipt、
Chunk 边界和提取状态、Candidate/版本、审批者、晋升、Usage、继承来源和撤回
影响。原文和 Raw Vault reference 不进入浏览器 projection。

“模拟召回”接收任务文本和 state token budget，不创建 Task、不调用模型、不授予
工具。Host 使用真实 Task recall 的同一个标签匹配、生命周期、权利、租户、
排序、候选上限和投放 renderer，返回 exact Skill、rank、原因、排除原因及真正
会进入上下文的 applicability card。持久记录只保存输入 hash 和字符数，不保存
原始任务文本。

#### 2.15 可访问性、i18n、浏览器与发行

两个 Modal、七个一级选项卡和角色目录分别采用正确的
`dialog/tablist/tab/tabpanel/listbox/option` 语义。支持方向键、Home/End、
Tab/Shift+Tab 焦点捕获、初始焦点、关闭后返回触发按钮、可见 focus、状态文字和
`aria-live`；Escape 与遮罩关闭仍由 DSH 原生 Modal 拥有。

CSS 覆盖 200% zoom、大字体、长 model ID、长路径、中文/英文标签、
`prefers-reduced-motion`、`prefers-contrast` 和 forced-colors。输入事件检查
`isComposing`，简体中文 IME 不会被快捷键截断。源代码、单文件规范、API、运维、
安全、评测、安装、升级、回滚、版本和发布报告由同一 release gate 校验。

### 3. Remote 边界

| Remote | 读取 | 写入 |
|---|---|---|
| `militaryControlPlane` | 角色、模型、预览、readiness、历史、指标 | 保存、恢复、回滚、模拟、显式 Canary、导入 |
| `militaryOperations` | 健康快照、诊断时间线、恢复 receipt | 预览并执行受治理恢复 |
| `militaryWorkspace` | Host workspace 目录 | 只按 `workspaceId` 读取状态 |
| `militaryBenchmark` | 固定数据集、运行、样本、稳定性 | 确定性运行、评估既有 Provider Session |
| `militaryPrivateSkills` | redacted operation/lineage/recall projection | 提炼治理、晋升、撤回、模拟召回 |
| `militaryEvaluationCenter` | durable Job、报告谱系、Dataset、Evidence、目录 | 取消/重试、申诉、重算 superseding Report |

所有 Remote 都使用窄 `snapshot/execute` 面；浏览器不能获得 SQLite handle、
credential、任意文件 API、Git 写权限或 Host 内部对象。

RC.2 Typert 在 Cordis service proxy receiver 上调用 Remote 方法。上述六个
Remote 因此禁止 ECMAScript `#private` 字段和方法：它们会在代理 receiver 上
触发 private-brand 错误。实现使用 TypeScript `private`（运行时普通成员），并由
静态回归门扫描全部 Remote 源文件；真实安装后的浏览器工作台还会逐页调用这些
边界，避免“直接单元测试通过、Profile UI 调用失败”的盲区。

### 4. 失败与恢复语义

- 冲突返回当前 revision 和字段 Diff，不做 last-write-wins；
- 路径错误保留 canonical rejection，拒绝不消耗 Grant；
- Provider/网络错误不改变模型 capability 状态，除非形成单独审计记录；
- 恢复动作先预览、再精确确认、后持久化 receipt；
- 恢复健康页分别显示运行 Bundle 与当前 content-addressed preset 指针；历史
  generation 的首归档版本不冒充当前 Bundle；
- SQLite projection 返回深冻结快照；基准运行、Provider 样本、恢复 receipt 和
  召回模拟在排序前复制数组，重复运行不会修改只读 projection；
- 模拟和确定性门不能冒充真实 Provider 通过；
- 断线后 UI 从 SQLite/Session facts 重建，不能靠组件本地状态补写成功。

### 5. 发布证据

源码门禁至少包括：

```bash
pnpm all:local
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

自动回归覆盖 12 个默认简体中文提示词、Host prompt compiler、revision/回滚、
伪造简体中文回执拒绝、Workspace ID/path/Git rename、九场景 dataset hash、
Provider 去重与 N<10/宽区间趋势保护、绩效七视图、知识透明度、
N≥50/Wilson/零安全失败外部 acceptance、evidence 导出与独立重算、
真实/模拟召回同 renderer、RC.2 Web Profile 三次
启动和原生 Web Client 注册。

真实 DeepSeek Provider 仍是单独的部署验收：样本必须记录 exact route；
每场景 N≥50，首次工具和 E2E 同时满足点估计/Wilson 下界，且意外确定性错误、
越权写入、假完成和重复终态为 0。模型别名、网络和服务端行为可能变化，不能由
本地确定性 PASS 推导。


---

<a id="part-68"></a>

## Part 68：General 全流程门、DSH 全模型接入与设置持久化

源文件：`docs/68-general-workflow-live-models-and-settings-persistence.md`

> `0.9.0-alpha.28` 补充说明：本章保留 `71fe` 事故根因和模型/设置修复背景。
> Workflow 的当前权威实现已经升级为独立 `WorkflowObligation`、Task Version、
> Attempt、Activation 与 Dispatch，并使用 Desired/Applied 设置状态；完整语义见
> [第 69 章](docs/69-execution-liveness-flash-and-production-readiness.md)。

### 1. 事故证据与边界

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

### 2. Host 所有的 General 工作流义务

General 的项目执行请求现在被编译成一个按 request hash 持久的工作流义务。
Host 每次只公开一个下一动作：

```text
START_MISSION
→ CREATE_TASK
→ READ_DEPARTMENT_STATUS
→ SPAWN_DEPARTMENT
→ 等待部门终态 receipt
→ General 读取已验证结果并汇总
```

同一 Mission 中可以有多个 open Task，但每条用户消息只关联自己的 obligation。
Task 的指令 revision 不再充当执行次数；部门初次派遣、Rework、Guidance 和
Decision continuation 各自拥有 Attempt/Activation/Dispatch。

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

短输入“继续”会继承同一 root Session 最近一个未完成且 request-compatible 的
项目执行义务；已完成 Task 不会因“继续”
被重复创建。子 Agent 的 `subagent-report` 会自动唤醒父 General，取消后的纯
settlement wake 仍由既有取消门抑制。

### 3. DSH live 目录是可用性权威

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

### 4. Provider-owned reasoning 适配

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

### 5. 原子保存和权威回读

“Military-部门模型”的保存流程固定为：

```text
本地完整 RoleDraft
→ Host preview + Flash readiness + prompt diff
→ expected settings revision
→ 单次 Settings CAS
→ 写完整 Desired revision
→ Reconciler 串行校验/应用全部角色
→ 全部成功后推进 Applied revision
→ 新 Host snapshot 回读（Desired == Applied）
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

### 6. 回归与运行边界

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


---

<a id="part-69"></a>

## Part 69：执行活性、Flash 外部验收与生产可信度

源文件：`docs/69-execution-liveness-flash-and-production-readiness.md`

### 1. 本轮闭环的目标

本章记录 `0.9.0-alpha.28` 对执行活性、状态机、恢复、轻量模型、WebUI、安全、
评测和生产 Provider 的纵向收敛。它补充并在冲突处取代第 60—68 章中仍以
Session/Task 粗粒度描述的部分。

完成标准不是“新增类型或页面”，而是同一条请求从 Host admission 到最终
Integration/Completion 的每一个权威转移都有：

- 唯一 aggregate 身份和 version/fence；
- durable start、heartbeat、settlement 或 operation receipt；
- 崩溃后的明确恢复状态；
- Web projection 的来源 revision 与陈旧度；
- deterministic test 与真实 Provider evidence 的清晰边界。

### 2. 执行层级与唯一关联

#### 2.1 权威层级

```text
User Request
  └─ WorkflowObligation
      └─ Mission
          └─ Direction
              └─ Wave
                  └─ Task Version
                      ├─ Attempt
                      │   └─ Activation
                      │       └─ Dispatch
                      ├─ CandidateSubmission
                      │   ├─ CandidatePatch
                      │   └─ Verification
                      └─ IntegrationOrder → IntegrationReceipt
```

`WorkflowObligation` 是一条执行型用户消息的 Host-owned 义务。它保存 request
hash、Mission/Direction/Wave/Task 关联、当前 stage、唯一 `nextTool` 和
wake cursor。General 不再扫描 Mission 中任意 open Task 推测“继续”对应什么。

`Task Version` 只在 objective、scope、acceptance、environment、dependency
或权限发生实质修改时递增。初次执行、Rework、收到 Guidance、收到 Decision
Answer 都创建新的 Attempt/Activation/Dispatch，不复用已经 settlement 的
Session Snapshot。

#### 2.2 活性证明

| 观察 | 可以证明 | 不可以证明 |
|---|---|---|
| Session Snapshot 存在 | 历史 Session 可检查 | 当前仍在运行 |
| Dispatch receipt | Host 已发出 exact payload | 子进程已开始 |
| durable start receipt | exact Activation 已启动 | lease 永不过期 |
| heartbeat receipt | 截至该时间仍有活性 | Task 已完成 |
| settlement receipt | exact Activation 已收敛 | Task 必然成功 |
| Completion receipt | Host invariant 已满足 | 模型正文的自行声明 |

只有未过期 start/heartbeat 能投影 `RUNNING`。缺少证明、identity drift、过期
lease 或 snapshot/ledger 不一致时投影 `RECOVERY_REQUIRED`，而不是假
`RUNNING`。

### 3. settlement、取消、终止与恢复

child dispose 只结算对应 Activation，并释放 exact Capability Grant、预算、
Workspace lease 和并发 reservation。它不得把 `BLOCKED`、`REWORK`、
`FROZEN`、`AWAITING_GUIDANCE` 或 `AWAITING_DECISION` 无条件改回 `READY`。
即使 Staff/Advisor 没有 Workspace，只要 execution binding 存在，也必须结算
Attempt/Activation/Dispatch。清理会尝试所有资源并汇总失败组件；任何一项
未收敛都返回可重试的 `PERSISTENCE_FAILED`，不能用吞掉异常的方式伪造成功。
Mission 已先行取消 Task 时不再重复释放 Task lease；重复 child disposal 先读取
已有 `task/activation-settled` receipt，因此换一个 teardown 原因也不会二次
修改 Task。

同一 `dispatchKey + payloadHash` 才能重放原记录；不同 dispatch key 即使
payload 相同，也代表新的受治理意图，在旧 Dispatch 仍活跃时必须返回
`RESOURCE_LOCKED`。同状态 Dispatch receipt 只有 transport 字段完全一致时
才是只读重放，不得再次增加 heartbeat 或改写时间。Activation/Attempt 的
`SETTLED` 只能从已启动状态进入；`LOST` 同时记录 `settledAt` 与稳定原因。

取消语义分开：

- 用户 Stop：取消当前 Invocation/Activation；
- Task Cancel：显式终止一个 Task；
- Mission Cancel：显式终止整条 Mission；
- Freeze：保持证据并禁止继续执行；
- Identity Termination：只用于明确的稳定身份处置。

step、wall-clock 或 no-progress 耗尽进入可恢复失败/升级路径，不永久终止
General。迟到、重复、乱序 settlement 由 Activation version 和 idempotency
fence 收敛。显式用户取消不会被 parent wakeup 复活；自然停止的父 General
会在关键子 receipt 到达后由 RC.2 next-step 唤醒。

Operations Center 的 Mission Cancel 是高风险受治理操作，不是一个前端状态
切换。用户必须选择仍存在的 Mission、填写原因、预览影响范围，在预览未过期且
权威 state hash 未变化时输入精确确认短语。Host 以本地 DSH Web principal
通过 Mission Kernel 提交 command；成功后取消所有未终态 Task、失效
Radio/Decision，并按 persisted/live child binding 释放 Grant、预算、并发
reservation、capacity 和 Workspace lease。operation receipt 与 Mission
cancellation receipt 都使用稳定幂等键；网络中断后可查询或以新的受治理预览
收敛，不能通过重放按钮制造第二个终态。

### 4. Radio、Decision、Blocker 与 Rework

#### 4.1 Radio

一个 blocker 命令原子关联 Blocker Evidence、Task version、Attempt、
`AWAITING_GUIDANCE`、Radio queue 和 parent receipt。Advisor lease 具有 TTL、
重试次数和 dead-letter。Guidance 投递给 exact Attempt；若原 Attempt 已结算，
Host 创建 continuation Attempt。Worker acknowledge 后才恢复 `RUNNING`。

过期或 exhausted guidance 不伪装为成功，Task 明确升级 `BLOCKED`。

#### 4.2 Decision

Question Set 同时绑定 Task 与 Attempt。只有 root General 能按序展示给用户；
第一份合法 answer 胜出，重复答案幂等。Answer 先 durable delivery，Worker
acknowledge 后 Task 才恢复。TTL reconciliation 产生 expired outcome，不猜测
用户答案。

#### 4.3 Rework

Verification 或 Integration 的 `REWORK`、`CONFLICT`、`STALE`、
`REGRESSION_FAILED` 都产生新 continuation Attempt 和独立 Dispatch。旧
Activation、旧 Snapshot、旧预算与旧授权不复用。

### 5. Candidate、Verification、Specs 与 Integration

Task 写路径的成功链固定为：

```text
RUNNING
→ CANDIDATE_SUBMITTED
→ VERIFYING
→ VERIFIED
→ INTEGRATION_PENDING
→ INTEGRATING
→ COMPLETED
```

Verification `ACCEPTED` 只是“候选已验证”，不是 Task 终态。Integration 必须
验证 expected head/tree、patch lineage、回归和 local-main policy；只有
`APPLIED` receipt 能推进 Completion。`CONFLICT`、`STALE` 和
`REGRESSION_FAILED` 进入 Rework/Blocked/Failed，不保留成功终态。

Engineer 的 `military_specs_apply_order` 是一个浅层模型合同和完整 Host 事务：
模型只提交相对路径与最终内容；Host 先验证完整计划，再原子 materialize、验证、
本地提交、记录 Candidate/Evidence/Verification/Integration/Completion receipt
并通知父级。成功后同轮 terminal latch 阻止后续调用。

Completion 由共享 reducer 的唯一 invariant 判定。模型正文、parent report、
Session `turn/end` 或 UI 按钮都不能自行宣布完成。

### 6. SQLite Command Saga 与 Outbox

SQLite transaction callback 被结构性限制为同步函数。返回 Promise/thenable
会 rollback 并报错，防止连接写锁跨 LLM、Git、文件系统、Provider 或长验证。
公开数据库句柄上的 standalone `statement.run()` 和 `exec()` 写入也自动包裹在
短 `BEGIN IMMEDIATE` 事务内，因此调用方不能绕过统一 writer。只有 SQLite
禁止放入领域事务的启动 PRAGMA 和 `VACUUM` 可通过显式 `maintenance()` 边界
运行；该边界不得承载领域数据写入。

Execution Lifecycle Provider 在短事务外计算纯状态转移，并用 storage revision
CAS 提交。多个进程或 Coordinator 同时争用同一 Workflow/Task 时，Host 只对
`REVISION_CONFLICT` 做最多三次有界重读与重算：相同
`dispatchKey + payloadHash` 收敛为 recovered replay，不同 dispatch key
收敛为 `RESOURCE_LOCKED`，expected-revision 或领域冲突在重试后仍原样失败。
因此持久化竞争不会泄漏成偶发工具错误，也不会借重试放宽幂等身份。

Command Saga 使用：

```text
short tx: admission + PENDING_EFFECT lease
outside tx: idempotent/queryable external operation
short tx: EFFECT_APPLIED + durable result
short tx: command receipt + outbox + COMMITTED
```

失败 effect 进入 `RETRYABLE`，保留 admission 与领域事实。相同 idempotency key
可在重启后恢复；`EFFECT_APPLIED` 只补 finalization，不重复外部副作用。Operations
Center 显示 pending、过期 lease、RETRYABLE、EFFECT_APPLIED 和最老年龄。

transactional outbox 具有 claim、lease、retry、指数 backoff、dead-letter、
delivery receipt 和 partition offset。Tool evidence/budget settlement 即使
post hook 抛错也通过 `Promise.allSettled` 和 outbox 补偿，避免“副作用成功但
返回失败后重复执行”。

### 7. Workspace、Wave 与重启恢复

Workspace Snapshot、Lease、Candidate Patch、Integration Order/Receipt 使用
唯一生产 Store。启动 reconciliation 会发现并分类现有 worktree：可证明归属的
收养，可证明过期的隔离，未知状态停止并要求人工核验；不会先递归删除。

Mission Scheduler 校验 DAG、未知依赖、cycle、write scope conflict、Wave
barrier、scope lock、预算和 capacity。只有依赖完成且 Wave active 的 Task
才能 dispatch。Direction/Wave 事件和 Mission completion/cancellation 都是
权威事件；Trajectory、Evaluation 与 WebUI 不用默认值补写。

### 8. Flash-first 工具协议

Worker/Engineer 只看到当前 phase 所需的 1—4 个核心动作和少量恢复动作；
固定 ToolProfile 仍是权限上限。文件操作统一为：

- `military_workspace_read`
- `military_workspace_list`
- `military_workspace_search`
- `military_workspace_write`
- `military_workspace_edit`
- `military_workspace_operation_status`

模型只传 Task 相对路径。Host 把路径绑定到 lease-owned execution root，执行
canonical authorization、symlink/escape/forbidden scope 检查并生成 receipt。
超时后模型先查询 operation status，不直接重复写入。

Task Create 与 Specs Apply 都是浅层 draft；Task key、Direction/Wave、版本、
scope、budget、stop/escalation、operation ID、hash 和时间由 Host 编译。
Military 自有错误 envelope 固定包含稳定 code/message、retryable、唯一
`nextTool` 和从当前 installed RC.2 schema 求得的 `correctedShape`；
secret-like 字段、Bearer token、宿主绝对路径和无界 details 在进入模型上下文
前被删除或脱敏；
完全相同的无效参数被签名阻断。终态成功后同一 assistant response 的其他调用
不会执行。

### 9. 模型目录、Desired/Applied 与 Dispatch receipt

模型能力分为四个独立轴：

1. Catalog Presence；
2. Protocol Compatibility；
3. Policy Eligibility；
4. Performance Evidence。

所有 DSH live route 可见并可选择，未评测不阻断显式使用，也不伪造 tool
calling、reasoning、context、residency 或 `VALIDATED`。native tool route
直接执行；非 native route 只有已启用并通过 canary 的 Bridge 才可执行。
Dispatch 前校验 exact provider/model/adapter/capability profile，并写
provider、model、classification、residency、redaction、policy revision 和
pricing snapshot receipt。

内置策略同样遵守不可变 revision。`alpha.27` 把 Pro capability 从 revision 1
推进到 2、Flash 从 3 推进到 4，并把引用新 Flash capability 的部门模板从 7
推进到 8。真实 `alpha.24` 数据库中的未定制模板仍位于 revision 6，因此启动
必须先追加精确的 revision 7 资产，再追加 revision 8；已经高于或等于内置版本
的用户修订保持不变。升级只追加连续新记录，旧 revision 继续服务已固定的历史
Session；启动不得以相同 revision 覆写新增 capability axes，不得跳过模板
revision，也不得通过删除 SQLite 数据规避冲突。

角色设置一次保存完整 Desired revision。Reconciler 对 General 和全部部门
校验/应用，全部成功才推进 Applied revision。UI 只有
`desiredRevision == appliedRevision` 才显示已生效；失败显示 exact role/field，
可重试或回滚，不产生部分应用。

### 10. Runtime Center 与 Web 查询层

独立 Runtime Center 展示 Request 到 Integration 的权威层级以及 Radio、
Decision、Budget、Receipt。每个 snapshot 包含：

- `sourceRevision`；
- `generation`；
- `generatedAt`；
- `staleAfter`；
- health/staleness。

共享 query layer 统一 timeout、Abort、同读去重、mutation 不去重、visibility/
offline backoff、revision fence 和 multi-tab invalidation。相同或更旧 revision
不能覆盖新数据；dirty draft 和历史报告选择不被 polling 重置。跨标签页只广播
service scope 失效通知，不广播敏感正文。

Web adapter 只组合 RC.2 primitive 与 `--dsw-*` token。Settings、Runtime、
Knowledge、Evaluation、Operations 是独立 feature slice，并保留 focus restore、
inert/visibility、200% zoom、forced colors、reduced motion、长 model ID 和中文
IME 合同。

### 11. Principal、Artifact 与数据治理

Web Remote 从 Host 的 DSH principal/tenant authority context 鉴权；本地单用户
模式使用明确的 local principal boundary，不把常量 `web-user` 冒充多租户认证。

Content Blob 与 Artifact Reference 分离。Reference 绑定 tenant、workflow/
Mission/Task、classification、owner/audience、scope、expiry 和 grant；知道
content hash 不获得读取权限。同内容多来源按最高 classification 合并。

restricted/raw 数据支持加密、持久 Ed25519 签名/KMS seam、密钥轮换、retention、
legal hold、lineage、deletion receipt 和 orphan GC。模型 dispatch 使用真实上下文
分类，不硬编码 `internal`。

### 12. Evaluation 与真实 Flash 发行门

Evaluation ratio 保留 numerator、denominator 和 status；零分母是 `N/A`，缺失
权威事件是 `INCOMPLETE`，都不伪装成 0。长 narrative/provider shard 使用
heartbeat 和 lease fence。成本必须来自 exact route/version price snapshot；
未知成本不进入 Pareto。

固定 `military-flash-core-v1` 九场景 deterministic gate 不调用模型、不收费，
只证明 Host/Schema/路径/状态合同。真实 Provider 样本必须来自 immutable
Session event 和 Host-observed receipt。发行门逐 exact configuration × scenario
执行：

| 指标 | 要求 |
|---|---:|
| 独立 Session | `N ≥ 50` |
| 首次工具命中 | 点估计 `≥ 95%`，95% Wilson 下界 `≥ 85%` |
| E2E 完成 | 点估计 `≥ 90%`，95% Wilson 下界 `≥ 80%` |
| 意外确定性错误 | `0` |
| 越权写入 | `0` |
| 假完成 | `0` |
| 重复终态 | `0` |

UI 可导出证据。离线发行门：

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route deepseek-official/deepseek-v4-flash
```

若同场景有多个 configuration，必须再提供冻结的 selection JSON。仓库门禁不会
发起数百次付费调用；没有足够真实样本时准确返回 `INSUFFICIENT_SAMPLE`，不能
写成“Flash 已通过”。

### 13. Production Plane 与灾备

核心应用依赖可替换的 Ledger、Artifact Store、Durable Queue、KMS、Telemetry、
Capacity 和 Backup 接口。SQLite、本地 Artifact 与事务 outbox 是
`LOCAL_SINGLE_NODE` 实现。外部 PostgreSQL、对象存储、queue、KMS adapter
通过 composition root 注入 exact live instance。

distributed readiness 会拒绝：

- 用 SQLite descriptor 冒充 PostgreSQL；
- 用本地目录冒充对象存储；
- 用进程内队列冒充外部 durable queue；
- 用 ephemeral signer 冒充 KMS；
- 未声明 tenant isolation、durability、residency 或 multi-region deployment。

Operations Center 汇总 correlated trace/metric/log、outbox lag、Radio oldest
age、expired lease、Command Saga drift、capacity saturation、provider health、
签名备份和隔离 restore drill。它只报告观测事实，不把接口存在等同于生产部署。

### 14. 验证矩阵

本轮新增纵向回归覆盖：

- 多 open Task 请求关联与三次 Rework 的独立 execution aggregate；
- Radio/Decision TTL、delivery、acknowledge 和 resume；
- Candidate→Verification→Integration→Completion 与冲突/陈旧/回归失败；
- Stop、自然父停、迟到 settlement 和重启恢复；
- SQLite 同步事务约束、Command Saga crash window 和 CAS；
- Outbox ordering/retry/dead-letter/offset；
- Wave dependency/barrier；
- Workspace wrapper 路径、symlink、operation status 和幂等；
- Runtime Center 全层级 parent link；
- Web query timeout/abort/dedupe/revision/multi-tab；
- Artifact ACL/retention/legal hold/key rotation/GC；
- production queue、provider topology、capacity、telemetry 和签名恢复；
- Flash N=50/Wilson/零安全失败发行门算法。

真实外部 Flash acceptance 是部署证据，不由 deterministic fixture 伪造。源码
发行可以在该证据尚不足时完成，但发布说明必须明确其状态，生产推广必须再通过
上述外部门。

---

## 配套工程资产

本规范的可执行配套位于：

- `schemas/`：JSON Schema Draft 2020-12；
- `examples/`：合法实例与 Mission Ledger 示例；
- `reference/types/`：可编译 TypeScript 参考类型；
- `templates/specs/`：工兵维护的 specs 工程模板；
- `adr/`：架构决策；
- `diagrams/`：Mermaid 图；
- `quality/` 与 `checklists/`：评测、威胁模型、SLO 和门禁清单。

执行 `python scripts/validate_artifacts.py` 验证文档工程一致性。
