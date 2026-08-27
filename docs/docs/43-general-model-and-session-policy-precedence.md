# General 模型与会话策略优先级

## 1. 用户决策

General 的初始默认模型由固定 `military` preset 提供。独立侧栏入口
`Military 设置中心 → Military-部门模型` 通过 `military-model-routing` 可视化
修改后续 General 默认 route；它不属于 `military-agent-templates` 部门 registry。
用户仍可在 DSH WebUI 会话模型选择器中更换当前 General 模型。

子 Agent 不跟随 General 的会话模型切换。它们继续使用各自冻结的 `AgentTemplateProfile` revision。

## 2. RC.2 实现

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

## 3. 优先级

```text
1. 当前 Session 的用户显式模型选择
2. 新建会话时用户显式模型选择
3. `military-model-routing` 保存的 General default
4. military preset 编译时默认（Flash/high/16K）
5. 显式兼容 fallback（仅策略允许）
6. 无合法路由则 fail closed
```

DSH 全局默认不能静默覆盖 military preset 默认。仅当 preset 策略明确 `allowGlobalDefaultFallback=true` 且能力验证通过时才可使用。

## 4. Reasoning 与全 Provider 适配

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

## 5. 模型选择事件

成功选择生成 [`ModelSelectionReceipt`](../schemas/model-selection-receipt.schema.json) 并记录：

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

## 6. Resume

恢复时：

1. 先恢复准确 preset generation；
2. 读取 DSH 当前 Session model selection；
3. 若历史有显式选择，验证当前 capability profile；
4. 若无显式选择，应用该 generation 的 preset default；
5. 模型已下线时只使用显式兼容 fallback，否则 `QUARANTINED` 或请求用户选择。

旧 generation 的 default model 也属于 generation 资产，不能用新 preset default 偷换。

## 7. Context Policy

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

## 8. Fallback

模型状态不会触发自动 fallback。只有用户或显式治理策略选择另一个 exact route
时才改变 provider/model，并记录新的选择 Receipt；绩效状态不能偷偷改路由。

## 9. 设置页面

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

## 10. 验收条件

- 新 Military Session 未显式选模型时使用 preset default；
- 用户切换后下一请求使用新模型；
- 子 Agent 不随 General 切换；
- 无 reasoning 或自定义 reasoning 的 DSH 模型按 adapter vocabulary 执行；
- 恢复保留历史显式选择；
- 非 Military Session 不受该 request listener 影响。
