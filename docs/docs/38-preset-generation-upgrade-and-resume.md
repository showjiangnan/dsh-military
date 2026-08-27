# Preset generation、升级与恢复

## 1. 问题定义

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

## 2. RC.2 适配边界

RC.2 本身继续负责：

- 新会话从 preset roster 选择 `military`；
- 空白会话选择后记录 `agent-preset/selected`；
- 常规子代理通过 `composeFrom()` 继承父级 standing scope；
- 会话历史和 DSH Session Persistence；
- 当前进程内的 preset generation 保留。

`dsh-military-preset-generations` 适配器额外负责：

- 计算当前资产哈希；
- 持久保存 [`PresetGenerationManifest`](../schemas/preset-generation-manifest.schema.json)；
- 将旧 generation 复制到只读内容寻址归档；
- 在恢复 Agent 发布之前读取 `MilitarySessionBinding`；
- 对当前 generation 执行精确匹配；对同进程仍存在的旧 standing scope 允许继续；RC.2 公共第三方 seam 无法在进程重启后把非空根 Session 重新组装到 archive generation；
- 找不到或不兼容时进入 `QUARANTINED`；
- 生成 [`PresetMigrationOrder`](../schemas/preset-migration-order.schema.json)。

该适配器是 RC.2 专用薄层。它不得修改 DSH Session 历史来伪装 generation，也不得在模型请求已经开始后热切组合。

## 3. Generation Manifest

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

## 4. 恢复状态机

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

## 5. 兼容分类

| 变更 | 处理 |
|---|---|
| 文案、UI、非模型可见元数据 | 可保持同一 generation，前提是资产哈希不参与这些外部文件 |
| Prompt、工具 Schema、权限、事件可见投影 | 新 generation |
| 工具名删除、持久事件语义破坏、恢复算法改变 | 新 generation，通常同时发布新公共 major preset id |
| RC.2 Adapter 实现修复但行为兼容 | 新 Bundle 版本，是否新 generation 由 capability fingerprint 决定 |

固定 `military` 是当前 major 产品入口。未来破坏性产品线可使用 `military-v2`，但普通非破坏性升级仍保留 public id `military`。

## 6. Migration

当旧 generation 不再能直接运行时，只允许：

1. `EXPORT_IMPORT`：导出已认证事实、Artifact、决策和 specs 引用，创建新 Military Session；
2. `NEW_PRESET_ID`：转移到明确的新 major preset；
3. `REBIND_ARCHIVE`：只在运行时仍持有对应 standing scope，或部署提供经过兼容验证的 generation-addressable resolver 时使用；当前标准 RC.2 根 Session 重启路径不支持。

迁移必须有用户授权、expected session revision 和过期时间。模型不能自行批准。

## 7. 垃圾回收

一个 archived generation 只有在以下条件全部满足时才能删除：

- 没有可恢复 Session 或 Mission 引用；
- 没有未完成评估和审计引用；
- 所有相关 Session 已迁移、导出或按保留策略删除；
- 管理员批准；
- 删除前生成 Manifest 和引用清单；
- 删除后保留 tombstone。

## 8. 验收条件

- current generation 的 Session 可在重启后恢复；archived-only 根 Session 在模型请求前进入 `QUARANTINED/MIGRATION_REQUIRED`；
- 当前 preset 文件修改不会改变旧 Session 的工具和 Prompt；
- 找不到旧资产时不会调用模型；
- non-Military Session 不读取 generation archive；
- generation 归档文件与 Manifest 哈希一致；
- breaking migration 有明确授权和可审计 Receipt。

## 9. Preset Resume Receipt

每次恢复必须产生 [`PresetResumeReceipt`](../schemas/preset-resume-receipt.schema.json)，而不是只返回一个内存枚举。Receipt 固化：

- 请求和实际解析到的 generation；
- `MATCHED | ARCHIVE_REBOUND | QUARANTINED | MIGRATION_REQUIRED`；
- RC.2 Compatibility Report；
- generation archive 哈希；
- Migration Order 和 General Model Selection Receipt（如适用）；
- 支撑恢复结论的 Event/Artifact 引用；
- 开始和完成时间。

Receipt 在 Agent 发布前提交。若 Receipt 无法落盘，恢复事务回滚；不能先启动模型再补记恢复事实。重放器以 Receipt、Session Binding 和 Generation Manifest 三者对账，任何不一致都进入隔离。
