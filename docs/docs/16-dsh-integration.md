# 与 DeepSeek Harness 的集成方案

## 1. 基线

设计基于 `deepseek-ai/deepseek-harness` `master` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，对应 `dsh@0.1.1-rc.2`。实现时应固定支持矩阵；DSH 变化通过薄 Adapter 吸收。

DSH 使用 Cordis 插件树，模型适配器、工具注册表、Session Log、Agent Loop、Skill、Compaction 与 Web 扩展均有组合 seam。`dsh-military` 作为后置 Bundle，避免修改内部 Agent Loop 源码。

## 2. Bundle

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

## 3. Agent 创建

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

## 4. 推理强度强制

1. Role/Task Policy 决定最低和首选 effort；
2. Agent Scope 的 `agent/request` listener 设置/覆盖；
3. Worker/Engineer/General/Staff 的 `off` 在请求前 fail closed；
4. 读取持久 `request/header` 确认 effective value；
5. Oversight 对角色与实际值对账；
6. Adapter 级全局 `thinking: disabled` 不适用。

## 5. Subagent

可复用 DSH continuable subagent，但由 `MilitaryRuntime` 统一创建和持有 Handle：

- 标准 follow-up 权限围绕直接父级；
- 兄弟 Agent 不形成自由通信网；
- Radio 使用自有 Broker；
- child report 可用于直接父级；
- Worker 禁止派生下级；
- Mission Ledger 掌握 identity、taskVersion 和 lease。

## 6. Session Events

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

## 7. Tool Pipeline

利用：

```text
tools/pre-execute
→ monotonic guards
→ execute
→ post-execute
→ result
```

实现：身份、冻结、taskVersion、路径、企业 API、Git、超时、脱敏、Evidence 和指标。`military_submit_candidate` 调用 `ToolRunContext.concludeTurn()`。

## 8. Agent Hooks

- `agent/pre-step`：冻结、lease、版本和消息准入；
- `agent/request`：模型路由、reasoning、预算和审计；
- `agent/request-error`：Provider 错误，不混同 Task 失败；
- `agent/turn-stopping`：无 Candidate/Blocker 的兜底；
- `agent/status`：Roster/UI；
- `agent/created/disposed`：Handle 和 lease 清理；
- `agent.cancel(...,{keepInbox:true})`：Freeze。

## 9. Compaction

订阅 General Session 的：

```text
compaction/start
compaction/summary
compaction/end
```

成功 end 后，以 compaction identity 幂等创建效能评估。评估不在 compaction transaction 内运行。

## 10. Skill

- DSH `ctx.skills` 保留通用技能发现；
- `ctx.militaryTactics` 是私有战术真源；
- Adapter 把允许的 ACTIVE/STABLE 视图注册到 Skill Registry；
- Advisor 读取完整战术；Worker 只读取编译 Directive。

## 11. Settings 与 Web

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

## 12. 持久化 Provider

- Ledger：SQLite/PostgreSQL；
- Radio：SQLite/外部 Queue；
- Artifact：本地内容寻址/对象存储；
- Tactics：Git/Database hybrid；
- Metrics：OTel/时序系统；
- Session：DSH persistence。

## 13. Adapter 包

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

## 0.2.0：Agent Preset 适配

Bundle 交付一个固定 system preset 资产根，包含 `military/preset.yml` 与 `agent.cordis.yml`。会话创建在 `setup(agentCtx)` 调用 `ctx.agentPresets.mount(agentCtx, selectedId)`；Military Runtime 创建的子代理同步调用 `composeFrom(childCtx, parentCtx)`。

### Roster 安装不是动态注册

`AgentPresets.Config.roots` 是服务启动配置。生产包应提供 profile 安装适配器：读取已有 `agent-presets` row 的完整配置、解析 preset 资产包绝对路径、追加 `trust: system` root，再完整写回 `default + roots + includeUserRoot`。DSH patch 会替换一个 row 的整个 `config`，所以不完整覆盖会删除部署已有 preset。

安装适配器不得：

- 创建第二个 AgentPresets 服务；
- 自动把默认 preset 改成 `military`；
- 覆盖用户自定义 preset root；
- 让普通 Session 通过 Host Plane 获得 Military tool/prompt；
- 在运行中的非空 Session 上重组 preset。

参考材料：

- [`reference/preset/README.md`](../reference/preset/README.md)
- [`examples/preset/agent-presets-profile-overlay.example.yml`](../examples/preset/agent-presets-profile-overlay.example.yml)

Agent Plane 的 Military prompt、工具和命令只存在于 preset standing scope。Host Plane 服务可以常驻，但必须不注册全局模型表面，并对非 Military Session 立即返回。

DSH 当前命令标识只接受小写 ASCII，故中文显示“头脑风暴”映射到 `/brainstorm`。DSH 的 delegated subagent 不能调用 `ask_user_question`，因此 General 是唯一弹窗调用者。

参考组合见 [`reference/preset/agent-presets/military/agent.cordis.yml`](../reference/preset/agent-presets/military/agent.cordis.yml)。

## 14. 0.3.0：精确 RC.2 支持边界

完整实现只针对：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

启动执行 [`CompatibilityProbe`](45-compatibility-probe-and-feature-matrix.md)，验证 AgentPresets、programmatic agent setup、`composeFrom`、`agent/request`、`request/header`、Compaction Event、User Questions、Settings、Conversation Nodes、Session Persistence 和 Tool Pipeline。其他 commit 即使 API 相似，也只可标记为未验证，不声明完整兼容。

## 15. Preset generation Adapter

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

不得只调用 `mount('military')` 恢复旧 Session。缺失资产进入 quarantine，详见[升级与恢复](38-preset-generation-upgrade-and-resume.md)。

## 16. General 路由 Adapter

preset 内的 `military-general-model-default` 只在 General 请求未显式选择 provider/model 时填充。用户通过 RC.2 会话模型表面选择后，Adapter 接受该显式值，再执行 Military ModelCapability、reasoning、驻留和预算校验。

Agent 身份必须证明 `rootRole=general`；子 Agent 请求不能读取该会话覆盖，而是使用 Agent Template 创建时冻结的 route。

## 17. 生成契约与事件

Mission/Admin Event 不再手工在多个文件维护。`contracts/event-catalog.json` 生成：

- 判别联合 JSON Schema；
- TypeScript Payload Map；
- Golden JSONL；
- 事件目录文档。

共享对象通过 `contracts/parity-map.json` 校验 JSON Schema 与 TypeScript required/optional 字段。实现包应消费生成类型或同一 IDL，不复制事件字符串。

## 18. Workspace 与集成

Worker 写任务在独立 Git worktree 或等价 copy-on-write Workspace 中运行。DSH `cwd` 指向该隔离根。Worker 只提交 `CandidatePatch`；Harness 验收后由 Integration Runtime 在受控 local `main` 上应用、执行全局回归并写 `IntegrationReceipt`。

普通 DSH Session 的文件变更只作为 external drift 被发现，Military 无权取消或冻结该 Session。

## 19. 持久化和事务

参考 [`reference/sql/`](../reference/sql/README.md) 定义 Mission/Admin Event、Radio、Artifact、Workspace、Integration、Decision、Generation、Evaluation 和 Outbox 表。跨 Event + 外部副作用使用：

```text
prepare intent
→ durable event/outbox
→ execute side effect
→ receipt/compensation
```

Git commit、Artifact rename、Profile write 和 API 调用不能与数据库假装成一个原子事务，必须使用 receipt 和恢复扫描。

## 20. Decision Broker 与预算

子代理问题通过持久 Decision Broker 交给根 General。Broker 使用 revision、expiry、taskVersion 和 dedupe key；多标签页的第一个有效回答胜出。

模型请求、工具、Radio、Evaluation 和研究工作在执行前从 [`ResourceBudgetPolicy`](../schemas/resource-budget-policy.schema.json) 预留资源。预算耗尽产生 durable disposition，不静默降级。
