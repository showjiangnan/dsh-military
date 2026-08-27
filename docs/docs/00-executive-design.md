# dsh-military 完整设计总纲

## 1. 定位

`dsh-military` 是建立在 DeepSeek Harness（DSH）之上的多代理组织与控制 Bundle。它不是“同时启动很多 Agent”的包装器，而是一套把复杂任务转化为可指挥、可执行、可验证、可恢复、可学习的软件体系。

它解决四个核心问题：

1. 将用户的自然语言方向转译为版本化 Mission、Direction、Wave 与 Task Order；
2. 让相对轻量的模型在明确边界、适量上下文和强工具支持下完成局部任务；
3. 阻止 Agent 仅凭自然语言自报完成、伪造工具使用或把猜测写成事实；
4. 把成功和失败经验沉淀为可版本化、可测试、可回滚的私有战术。

Bundle 的核心是**指挥权、计划权、执行权、验收权、冻结权、通信权、记忆权和 Git 权限的分离**。

## 2. 组织映射

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

## 3. 五平面架构

### 3.1 指挥平面

```text
User Direction
  → Mission Intent
  → Staff Council
  → Direction Proposal
  → General Ratification
```

### 3.2 作战平面

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

### 3.3 保障平面

由工兵、specs、受限 Git、Workspace、Artifact Store、环境快照和资源锁组成，确保项目可持续维护并能恢复。

### 3.4 监督平面

由 Completion Interlock、Verification Engine、Oversight Controller 和只读 Inspector Agent 组成。原则是：

> 模型可以发现和解释异常，但只有 Harness 可以改变 Task 与 Agent 的权威状态。

### 3.5 知识平面

由参谋部电台、私有战术注册表、轨迹记忆、效能评估和战术博物馆组成，把一次任务经验变成可检索、可测试、可晋级的组织知识。

## 4. 核心闭环

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

## 5. 三个关键修正

### 5.1 任务不是“越小越好”

目标是**最小可独立验收单元**。无限拆分会增加 Agent 启动、上下文打包、电台、锁、合并和验收成本。一个 Task 应具有一个主要结果、一个责任 Agent、一个冻结上下文包、一个有限写集合和一份独立验收合同。

### 5.2 督战不能只靠另一个模型

实时冻结必须由 Harness 事件控制器执行。Inspector Agent 只读取日志、Diff、工具结果和声明，输出结构化 Inspection Report。真正冻结发生在工具 Guard、`agent/pre-step`、完成联锁或 turn-stopping 边界。

### 5.3 Thinking 按角色强制

本版本放弃“关闭 Worker Thinking 节省成本”的策略。General、Staff、Worker、Engineer 与研究 Agent 都必须使用 Thinking；具体强度按风险和任务复杂度调整。有效值以模型请求的持久请求头审计，不能只相信 Prompt 或配置。

## 6. 数据真源

1. **Mission Ledger**：跨 Agent、跨 Session 的不可变全局事件账本；
2. **DSH Session Log**：单 Agent 的持久模型可见事实；
3. **Artifact Store**：文件、Diff、测试、日志、截图、API receipt 等内容寻址证据；
4. **Derived Documents**：Tactical Report、Memory 与 Museum Archive，只是投影，不是真源。

## 7. 权威控制矩阵

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

## 8. 成功标准

- 未验收事实进入 General Memory：0；
- stale Task Version 被接受：0；
- 未授权远端 Git 写：0；
- Worker/Engineer 实际 reasoning 为 off：0；
- 一次战术指导后的验收通过率高于可比无指导基线；
- specs 与已接受实现具备可追踪覆盖；
- Mission 可从 Ledger、Session 和 Artifact 重放；
- 私有战术晋级来自真实验收和可复现实验，而非模型自评。

## 0.2.0 增量：固定 Preset、知识提炼和绩效治理

本版将“用户选择 Military 模式”落为 DSH 原生固定 system preset `military`，而不是运行时布尔开关。Preset 在空白会话创建期组装并锁定；普通会话完全不获得 Military 模型表面。参见[固定 Military Preset 与会话隔离](32-military-preset-and-session-isolation.md)。

系统新增三个跨 Mission 能力：

- 用户显式把历史会话或直接经验提炼为带来源的私有战术候选；
- 用户按部门管理非 General Agent Template 的模型、Thinking、上下文预算和压缩阈值；
- 军事评估委员会按时间区间评估模板 revision 和总体组织绩效。

这些能力都保持“模型提出、Harness 验证、用户批准”的权威分离。

## 0.3.0 增量：从组织设计到可恢复实现契约

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

完整实现门禁见 [`IMPLEMENTATION-READINESS.md`](../IMPLEMENTATION-READINESS.md)。
