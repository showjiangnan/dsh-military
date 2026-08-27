# Military preset 参考组合与 generation 资产

本目录给出固定 system preset `military` 的 RC.2 参考形状。生产实现以 RC.2 `standard` preset 为已知良好起点，将通用自由派生能力替换为 Military Runtime 受控子代理创建，并加入 General、Session Gate、Brainstorm、模型默认和领域工具。

## 目录

- `agent-presets/military/preset.yml`：公开 roster 元数据；
- `agent-presets/military/agent.cordis.yml`：公开 current Agent Plane 组合；
- `agent-presets/military/generation-manifest.json`：current 内容寻址清单；
- `generations/<sha256>/`：不可变历史 generation；
- `package.example.json`：preset 资产包发布形状；
- `profile-installer-pseudocode.ts`：保留现有 roster 并原子安装的参考算法。

示例包名使用 `@your-org/*`，不是已发布 NPM 包。Ledger、Settings、Storage、Sandbox、Model Adapter、Policy Registry 和 generation resolver 属于 Host Plane，不应重复放入 preset。

## General 模型

`military-general-model-default` 是 preset 的组成部分。它只在根 General 请求未带显式 Session model selection 时填充默认 provider/model。用户通过 DSH WebUI 切换模型后，显式选择优先，但仍通过 Military ModelCapability、reasoning、数据驻留和预算校验。

子代理不读取该覆盖；其 route 来自 Department Template revision。

## Generation 生成

修改 `preset.yml` 或 `agent.cordis.yml` 后运行：

```bash
python scripts/compute_preset_generation.py
python scripts/compute_preset_generation.py --check
```

脚本：

1. 计算两个资产的 hash；
2. 写 current manifest；
3. 将精确资产复制到 `generations/<assetHash>/`；
4. 保留旧 generation，不原地改写。

运行中进程可以由 RC.2 standing mount 保留旧实例，但跨进程恢复必须读取 Military Session Binding 并挂载对应 archive；不能只重新解析公开 `military` ID。

## 安装适配边界

RC.2 AgentPresets `roots` 是启动配置，不是动态 Provider Registry。安装器必须：

1. 读取 profile revision 和 `agent-presets` row 的**完整有效配置**；
2. 解析 preset 资产包的绝对 system root；
3. 检测所有 roots 中的 `military` ID 冲突；
4. 安装/校验 generation archive；
5. 追加 system root，保留原 `default`、全部 `roots` 和 `includeUserRoot`；
6. 使用临时文件、fsync、rename 和 revision CAS 原子写 overlay；
7. 重启/重载后运行 roster health 和 Compatibility Probe；
8. 失败时恢复旧 profile 和 current generation pointer。

不得：

- 插入第二个 `@deepseek-ai/dsh-agent-presets` 服务；
- 自动把 default 改为 `military`；
- 覆盖用户 roots；
- 让 Host Plane 注册全局 Military 模型工具；
- 覆盖同名 user preset；
- 删除仍被历史 Session 引用的 generation。

参考 overlay：[`../../examples/preset/agent-presets-profile-overlay.example.yml`](../../examples/preset/agent-presets-profile-overlay.example.yml)。
