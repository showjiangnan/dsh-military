# DSH 设计参考与基线

## 1. 固定基线

本方案的 DSH 兼容性分析固定于：

```text
Repository: deepseek-ai/deepseek-harness
Branch: master
Commit: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
Release commit message: dsh@0.1.1-rc.2
Observed: 2026-08-19
```

实现仓库应把该值写入 Adapter compatibility fixture。升级 DSH 时重新核对本页列出的接口，并运行契约重放测试。

## 2. 核心参考文件

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

## 3. 兼容性核对表

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

## 4. 非目标

本方案不依赖：

- DSH 内部 `ReactLoopAgent` 类型；
- 私有源文件路径；
- 浏览器组件的未公开 value import；
- 某一个数据库或消息队列；
- 某一个模型必须优于另一个模型的假设。

所有易变细节都应封装在 `adapters-dsh-*` 包。

## 0.2.0 新增 DSH 参考文件

- `packages/preset/agent-presets/README(.zh).md`：preset standing scope、`mount()`、`composeFrom()`、空白切换和会话实际 preset；
- `packages/client/ui-agent-preset/README(.zh).md`：新建会话 chip、只读标签、管理 roster 和锁定行为；
- `apps/cli/config/agent-presets/standard/preset.yml`：内置 preset metadata 形状；
- `apps/cli/config/agent-presets/standard/agent.cordis.yml`：Agent Plane、Host Plane 和 isolate realm 的参考；
- `packages/interaction/commands/README(.zh).md`：命令 id 语法和 agent-scoped registration；
- `packages/interaction/tool-ask-user/README(.zh).md`：`ask_user_question` 协议和 delegated caller 限制；
- `docs/cookbook/adding-a-settings-card.md`：外部插件 Settings card；
- `docs/cookbook/adding-a-conversation-node.md`：Session Event 到 Web conversation node。


## 0.3.0 兼容性说明

当前文档只对上述 RC.2 commit 声明完整支持。`reference/dsh-rc2/compatibility-matrix.yml` 固化所需 seam；真实实现通过 Capability Probe 和 E2E Fixture 验证，而不是根据版本字符串乐观运行。

0.3.0 新增重点核对：

- RC.2 preset 恢复只持久 ID，Military 必须额外保存 generation；
- preset 内 General model default 与 Session model selector 的 request 优先级；
- `request/header` 对 effective reasoning/route 的重建；
- `composeFrom()` 继承父代 standing generation；
- delegated child 的 `ask_user_question` 限制；
- settings revision、conversation projection 和 compaction event；
- Agent cancellation/pre-step/tool guard 的 Freeze 竞态。
