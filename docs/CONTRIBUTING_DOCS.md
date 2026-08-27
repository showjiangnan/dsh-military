# 文档工程贡献规范

## 1. 变更分类

- 组织职责或流程：修改对应 `docs/`，必要时新增 ADR；
- Mission/Admin Event：只修改 `contracts/event-catalog.json`，再运行生成器；
- 跨进程数据契约：修改 JSON Schema、示例和 TypeScript parity；
- preset：修改公开资产，重新计算 generation 并评估迁移；
- 状态机：同步更新 TypeScript、Event、Schema、Golden Trace 和 TLA+/属性测试；
- 权限/数据：同步 Authority、Policy、威胁模型、负向测试和撤回；
- DSH 适配：更新 RC.2 matrix、Fixture 和 reference source；
- WebUI：使用 durable event/projection，不以组件本地状态代替权威事实。

## 2. 真源优先级

不同领域有不同的唯一真源：

```text
Architecture decision       → ADR
Mission/Admin event         → contracts/event-catalog.json
Cross-process data shape    → JSON Schema
Shared field parity         → contracts/parity-map.json
Runtime service behavior    → TypeScript Service Definition + tests
Preset composition          → reference/preset/.../military assets
Preset generation identity  → compute_preset_generation.py output
Physical storage            → migration source + migration tests
Examples                    → generated or schema-mapped fixtures
Prose/UI/Prompt              → derived explanation and presentation
```

Prompt、UI 文案、模型输出或示例不能覆盖权威契约。

## 3. 文档编号

`docs/` 使用两位连续编号。新增独立主题附加在末尾；编号连续性和单文件汇编由校验器检查。当前范围为 `00–67`。

## 4. Event 变更流程

1. 修改 `contracts/event-catalog.json`；
2. 判断 additive、upcast 或 breaking；
3. 运行 `python scripts/generate_contract_artifacts.py`；
4. 更新 reducer/projector、Golden Trace 和 migration；
5. 运行 freshness 和 Event coverage；
6. breaking 变化提升 Envelope major 并新增 ADR/Migration Order。

禁止手工编辑生成的 Event Schema、TypeScript 或 Golden JSONL。

## 5. Schema 规则

- JSON Schema Draft 2020-12；
- 顶层包含 `$id`、`title`、`schemaVersion`；
- 默认 `additionalProperties: false`；
- 时间使用 RFC 3339 `date-time`；
- 大内容使用 Artifact reference；
- Secret 只保存 credential reference；
- 稳定身份不依赖数组位置；
- required/optional 与 TypeScript parity 一致；
- 每个顶层 Schema 至少有一个合法实例；
- enum 收紧、字段删除或语义改变需要 major/migration。

## 6. Preset 规则

修改 `reference/preset/agent-presets/military/{preset.yml,agent.cordis.yml}` 后：

```bash
python scripts/compute_preset_generation.py
```

必须：

- 保留旧 archive；
- 更新 migration/compatibility 结论；
- 运行 RC.2 picker/mount/composeFrom/restart Fixture；
- 证明 Standard Session 工具表面不变；
- 证明 General default 与用户 Session override；
- 破坏性能力变化考虑新 public preset major id。

## 7. 权限和跨会话规则

任何新管理写入或跨会话读取都必须说明：

- Principal/Tenant；
- Authority Scope；
- 数据分类；
- expected revision；
- Authorization Receipt；
- 撤权/过期；
- 审计 Event；
- 负向测试。

角色名、Agent prompt、sessionId、cwd 和模型自报都不能授予权限。

## 8. 外部副作用规则

Git、Artifact、API、Profile 和 Queue 无法与 Ledger 直接原子提交。新能力必须定义：

```text
intent/outbox
idempotency key
side-effect receipt
compensation
recovery scan
crash windows
```

禁止在文档中用“事务完成”掩盖未定义的双写窗口。

## 9. ADR 规则

下列变化必须新增或 supersede ADR：

- 权威边界、状态机和数据真源；
- Agent 通信或用户交互所有权；
- preset/generation/恢复；
- Workspace/Git/Integration；
- Thinking、模型和预算策略；
- 战术供应链、绩效统计和安全边界；
- DSH seam 或存储事务；
- 安装、升级和卸载。

ADR 包含 Context、Decision、Consequences、Rejected Alternatives、Migration 和 Status。

## 10. 相对链接与可移植性

- 使用仓库相对路径；
- 不写本机绝对路径；
- 在线页面不是唯一规范；
- DSH 外部事实记录仓库、commit、路径和观察日期；
- Mermaid/TLA/SQL 可独立读取；
- 示例不得包含真实 Secret、个人数据或企业专有内容。

## 11. 全量校验

```bash
python scripts/generate_contract_artifacts.py --check
python scripts/generate_error_artifacts.py --check
python scripts/compute_preset_generation.py --check
python scripts/update_indexes.py --check
tsc -p reference/types/tsconfig.json
python scripts/build_single_spec.py
python scripts/build_single_spec.py --check
python scripts/validate_artifacts.py --write-manifest
python scripts/validate_artifacts.py
```

提交前确认：

- 生成物无漂移；
- Schema/TS parity 通过；
- Event type/payload 示例全覆盖；
- preset generation/archive 新鲜；
- RC.2 常量与 General policy 一致；
- SQL、State、Trace 和链接通过；
- MANIFEST 与 Validation Report 已重建。

真实实现仓库还必须运行 RC.2 E2E、故障注入、数据库 migration、Git worktree 和 Web accessibility；文档静态通过不能替代运行时通过。

## 12. 合并说明

变更说明至少回答：

- 为什么改；
- 哪个真源改变；
- 影响哪些角色、状态、权限和数据；
- 是否使 Task/Guidance/Decision/Generation stale；
- 是否需要 migration/upcaster；
- 是否改变 General model 或 Department route；
- 如何恢复/回滚；
- 哪些静态与真实测试证明行为。
