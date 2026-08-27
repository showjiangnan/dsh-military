# 固定 `military` Preset 与会话隔离

## 1. 决策

`dsh-military` 不实现可在运行中热切换的“模式开关”。Bundle 随安装包交付一个固定、独立、只读的 system preset：

```text
preset id: military
显示名称: Military 模式
```

用户在 DSH WebUI 的**新建会话**界面，通过 agent preset chip 手动选择 `military`。该选择在会话创建和组装时生效，并在会话开始产生内容后锁定。只有实际组装到 `military` preset 的会话，才能获得 General persona、Military 工具、命令、监听器、子代理编排和 Mission 投影。

这项决策复用 DSH 原生 agent preset 机制，不在 composer 中维护第二套真假难辨的布尔状态。

## 2. 为什么不是运行时开关

Preset 决定模型请求中的系统提示词、工具 Schema、技能目录和监听器。会话已经使用某个工具集产生历史后再更换，会出现以下不可重放状态：

- 历史中存在新 preset 无法执行的工具调用；
- 同一会话前后使用不同安全和审批边界；
- 恢复会话时无法判断应加载哪一代插件组合；
- KV Cache、压缩摘要和工具结果的语义前缀发生改变；
- 用户以为关闭了 Military，实际上旧监听器仍在处理任务。

因此，Military 能力是创建期组合事实，不是每轮请求的偏好设置。

## 3. WebUI 用户体验

### 3.1 新建会话

新建会话界面显示 DSH 原生 preset chip。选项中新增：

```yaml
id: military
name: Military 模式
description: 验证驱动的多代理指挥、参谋、执行、督战、specs 与战术学习工作流。
```

选择值只作用于**下一个空白会话**。会话创建后，暂存选择被消费，下一次新建会话重新使用部署默认 preset，除非用户再次选择 `military`。

### 3.2 已开始会话

会话出现第一条有效输出、工具事件或其他产出后，preset 不再可编辑。标题旁显示只读标签：

```text
Military 模式
```

任何试图把已开始会话切入或切出 `military` 的请求都必须返回 `agent-preset-locked`，不能排队等待未来切换。

### 3.3 管理平面与会话能力的区别

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

## 4. Preset 目录

随 Bundle 交付的参考目录为：

```text
agent-presets/
└── military/
    ├── preset.yml
    └── agent.cordis.yml
```

参考文件位于：

- [`reference/preset/agent-presets/military/preset.yml`](../reference/preset/agent-presets/military/preset.yml)
- [`reference/preset/agent-presets/military/agent.cordis.yml`](../reference/preset/agent-presets/military/agent.cordis.yml)
- [`reference/preset/package.example.json`](../reference/preset/package.example.json)

`preset.yml` 只描述显示元数据；`agent.cordis.yml` 是 Agent Plane 组合。

### 4.1 system root 安装适配

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

参考 overlay 见 [`examples/preset/agent-presets-profile-overlay.example.yml`](../examples/preset/agent-presets-profile-overlay.example.yml)。安装后必须通过 `agentPreset.list`/WebUI roster 验证 `military` 为健康 system preset；损坏时 fail closed，不创建半组装 Session。

## 5. Host Plane 与 Preset Plane

为了同时做到可管理和不干扰普通会话，组件分成两个平面。

### 5.1 Host Plane

Host Plane 可以常驻，但不得直接向模型贡献提示词或工具：

- Mission Ledger、Artifact Store、Radio Store；
- Advisor、Agent Template、Tag、Tactical Skill 注册表；
- Evaluation Job 和报告存储；
- Settings namespace 与 Web RPC；
- Credential/API Gateway；
- system preset 根目录注册。

这些服务必须按 Session、Mission、Job 或用户租户键控，不得把“当前会话”保存在进程级可变单例中。

### 5.2 Military Preset Plane

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

## 6. 双重准入

Preset scope 是第一层能力隔离，所有关键入口仍需要第二层防御性检查。

```ts
function requireMilitaryAgent(agent: Agent): MilitarySessionBinding {
  const preset = ctx.agentPresets.composedPreset(agent.ctx)
  if (preset !== 'military') throw new MilitaryError('MILITARY_PRESET_REQUIRED')
  return militarySessions.requireBinding(agent.id)
}
```

冷读持久会话时，应使用 DSH 的实际 preset 解析结果，而不是部署默认值。不得依据工作目录、标题、模型名或某个曾经出现的 Military 文本推断启用状态。

## 7. 子代理继承

General 创建 Worker、Engineer、Advisor、Chief of Staff、Inspector 或 Evaluation 子代理时，必须在未发布的 `setup(agentCtx)` 窗口中：

1. 调用 `ctx.agentPresets.composeFrom(childCtx, general.ctx)`；
2. 验证返回的 preset id 为 `military`；
3. 再安装角色 persona、工具限制、模型策略和 Task Binding；
4. 任何步骤失败都回滚整个创建事务。

不得让子代理重新按字符串 `military` 调用 `mount()`。重新解析可能让子代理进入被编辑后的另一代 preset，而父会话仍运行旧代组合。

## 8. `MilitarySessionBinding`

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

机器契约见 [`military-session-binding.schema.json`](../schemas/military-session-binding.schema.json)。绑定不可被普通模型修改；会话恢复必须验证实际 preset 与绑定一致。

## 9. 同工作区多会话隔离

相同 `cwd` 不代表相同 Military Run。所有内部键至少包含：

```text
tenantId + rootSessionId + missionId
```

Worker、Task、Radio、Freeze、Context Budget、Compaction、Metric 和 Artifact 不能只按工作区路径索引。

### 9.1 普通会话不受 Military 锁干扰

Military Workspace 锁只协调本 Mission 管理的 Worker/Engineer。它不得向全局 DSH 文件工具安装会阻塞普通 preset 的锁。

如果普通会话或外部进程同时修改相同文件，Military 应：

- 通过基线哈希、Git tree 或文件版本检测外部变化；
- 将 Candidate 标记为环境漂移；
- 暂停、重新读取或要求用户决策；
- 绝不冻结、取消或修改普通会话。

“互不干扰”是插件控制面的隔离，不承诺两个独立进程编辑同一文件永远无冲突。

### 9.2 监听器准入

所有 Host 级监听器使用统一判定：

```text
session event arrives
→ resolve actual session preset
→ preset != military: immediate return
→ preset == military: resolve binding and continue
```

不能使用模块级 `militaryEnabled = true`。

## 10. 状态与恢复

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

## 11. 设置变更的影响

修改参谋或子代理模板不改变已经创建的 Agent。每个子代理实例记录其模板 revision 和 effective model policy；新实例使用新 revision。已运行的根会话仍使用它创建时加入的 preset generation。

## 12. 测试矩阵

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

## 13. 验收条件

- `military` 出现在新建会话 preset roster；
- preset 文件损坏时显示 broken，不能创建半组装会话；
- 非 Military 会话的模型请求中不存在 Military prompt/tool schema；
- 非 Military 会话不会触发 Military completion、freeze 或 compaction；
- 所有 Military 子代理继承精确的父 preset generation；
- 断线、恢复和冷读可以重建会话的启用事实；
- 同工作区多会话压力测试中，Mission/Radio/Metric 的 key 零碰撞。

## 0.9.0-alpha.6：跨重启 generation 检测、隔离与迁移

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

只有显式 `PresetMigrationOrder` 能把历史事实投影到新 Session；原 Session 历史不被改写。详见[Preset generation 升级与恢复](38-preset-generation-upgrade-and-resume.md)。

## General model default

`military` preset 内置 General default provider/model，但允许当前根会话通过 DSH 原生模型选择器覆盖。此模型表面不是 preset 切换：

- actual preset 和 generation 不变；
- Military 工具/Prompt 不变；
- 只改变 General 后续请求；
- child template routes 不变；
- 不满足 reasoning、上下文、数据驻留或预算时拒绝。

因此同 cwd 的 Standard Session 仍完全独立，Military General 的模型切换也不会影响它。
