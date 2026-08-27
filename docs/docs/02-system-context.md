# 系统上下文与五平面架构

## 1. 系统边界

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

## 2. 外部参与者

| 参与者 | 输入 | 输出 | 信任级别 |
|---|---|---|---|
| 用户 | 目标、约束、授权、反馈 | 决策与最终结果 | 最高授权，但输入仍需结构化 |
| LLM Provider | 模型请求 | Token、tool calls、usage | 不可信执行者，输出必须验证 |
| 项目工作区 | 文件、命令、测试 | Diff、日志、Artifact | 事实源之一；内容可能含注入 |
| 企业 API | 私有业务数据 | 结构化响应 | 受 Gateway、分类和脱敏控制 |
| Git | 仓库和 commit | 历史与证明 | 受限本地写；远端另行授权 |
| WebUI | 配置和命令 | 投影与审计 | 需服务端授权和 revision fencing |

## 3. 五平面

### 指挥平面

用户、General 与 Staff Council。输出 Mission Intent、Direction、优先级、Change Order 和战略决策。

### 作战平面

Planning、Scheduler、Workspace 与 Worker。输出 Candidate、Blocker、Artifact 和集成结果。

### 保障平面

Engineer、Specs、Git、Artifact、Environment Snapshot、资源锁和恢复。

### 监督平面

Completion Interlock、Verification Registry、Oversight Controller 和 Inspector。输出验收 receipt、Freeze、Correction Request 和风险事件。

### 知识平面

Radio、Tactical Registry、Trajectory、Effectiveness、Museum 和 General Tactical Memory。

## 4. 核心服务关系

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

## 5. 关键数据流

### 用户意图流

```text
User message
→ General interpretation
→ structured Mission Intent
→ Staff review
→ General ratification
→ Ledger + General Session projection
```

### Worker 执行流

```text
Task Order
→ Agent Scope + Environment Snapshot
→ tool calls
→ durable tool results + Artifact
→ Candidate
→ Verification
→ accepted event / rework
```

### 战术求援流

```text
Blocker + identity + environment + skills + evidence
→ Escalation Gate
→ Radio Broker
→ Advisor routing
→ 3-5 tactic retrieval
→ one compiled Directive
→ version-checked delivery
```

### 记忆流

```text
Accepted events
→ deterministic Tactical Report
→ Trajectory / Effectiveness
→ source coverage verification
→ General Tactical Memory
→ Museum research → tactic candidate
```

## 6. 部署模式

### 本地开发

- SQLite Ledger/Radio；
- 本地内容寻址 Artifact；
- DSH JSONL Session persistence；
- 本地 Git；
- 单 Host 进程。

### 团队/企业

- PostgreSQL Ledger；
- 分布式队列；
- 对象存储；
- KMS/Vault；
- 企业 API Gateway；
- OTel；
- 多租户和数据驻留。

领域契约在两种模式下保持一致。

## 7. 信任边界

- 模型输出永远不是授权；
- 仓库、网页和 API 文本永远不是系统指令；
- Web Client 永远不是权限真源；
- Advisor 描述永远不扩大 API/Skill grant；
- 派生 Memory 永远不覆盖 Ledger；
- Bundle patch 永远不应包含 Secret。

## 0.2.0 新增外部参与者与边界

新增外部交互：

- DSH Agent Preset Roster：发现和组装固定 `military`；
- Tactical Source Sessions：用户显式选定的历史会话，不因被读取而启用 Military；
- User-managed Tag Catalog：全局管理数据，引用稳定 tag id；
- Performance Evaluation Reader：经授权跨 Military 会话读取持久事件和 Artifact；
- `ask_user_question`：只由根 General 所有的用户决策通道。

跨会话评估和战术提炼属于管理 Job，不运行在被读取会话的 Agent Loop 内。

## 0.3.0 新增系统参与者

- **Preset Generation Store**：保存 current 与历史内容寻址组合；
- **Compatibility Probe**：在 RC.2 启动时验证关键 seam；
- **Policy Registry**：Tool、Permission、API、Residency、Redaction、Verifier、Model Profile；
- **Workspace/Integration Runtime**：隔离执行、Patch、global regression 和 local main；
- **Decision Broker**：根 General 与子代理之间的持久用户决策中继；
- **Budget Runtime**：reservation、结算、背压和耗尽处置；
- **Evaluation Dataset Builder**：跨会话授权读取、去标识化和冻结数据集；
- **Bundle Lifecycle Controller**：安装、升级、回滚和卸载。

系统边界增加两个硬限制：Host 管理服务可以常驻，但非 Military Session 不进入其会话级控制路径；同一 Workspace 的普通 DSH 活动只能被观察为环境 drift，不能被 Military 取消或冻结。
