# 契约真源与代码生成

## 1. 决策

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

## 2. Event Catalog

[`contracts/event-catalog.json`](../contracts/event-catalog.json) 为 Mission 与 Administrative Ledger 的唯一事件真源，保存：

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

## 3. Error Catalog

[`contracts/error-catalog.json`](../contracts/error-catalog.json) 是稳定错误码、分类、默认 retryability 和恢复指引的唯一真源。`scripts/generate_error_artifacts.py` 生成：

- `schemas/military-failure.schema.json`；
- `reference/types/generated-error-catalog.ts`；
- `contracts/ERROR-CATALOG.md`；
- 一个合法 Failure 示例。

错误码不得只写在实现或 Markdown 表格中。新增、重命名或删除错误码需要兼容评审；已进入持久 Receipt/Event 的 code 不原地复用。

## 4. Shared Contract Parity

[`contracts/parity-map.json`](../contracts/parity-map.json) 指定关键共享对象：

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

## 5. Schema Versioning

每个持久对象都携带 `schemaVersion`。规则：

- 新增可选字段：minor；
- 新增必填字段、删除字段、改变枚举意义：major；
- 文档澄清和不改变实例集合的约束修复：patch；
- Event 名一旦发布不得复用；
- 旧事件通过 Upcaster 投影到当前读取模型，原始 Event 不改写。

本版将 Ledger Event Envelope 提升到 `2.0.0`，因为 Payload 从开放对象改为判别联合。

## 6. 生成工作流

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

## 7. Contract Review

任何契约 PR 必须回答：

1. 哪个真源改变；
2. 这是 additive 还是 breaking；
3. 是否需要 Upcaster 或 SQL migration；
4. 哪些 Golden Trace 改变；
5. 哪些 preset generation 必须更新；
6. 是否改变模型可见前缀；
7. 是否影响权限或数据分类；
8. 回滚后旧实现是否还能读取新数据。

## 8. 禁止做法

- 在服务实现中定义未进入 Schema 的隐藏字段；
- 仅修改 TypeScript，不更新 Schema；
- 用 `payload: object` 逃避事件契约；
- 把数据库列当作领域语义真源；
- 让模型输出直接写入未校验 JSON；
- 手工编辑生成事件文件；
- 用当前示例推断所有合法实例。

## 9. 验收条件

- 每个 Event Catalog 项都产生合法 Golden Ledger 行；
- Mission/Admin Event Type 与生成 TS 完全一致；
- 关键共享 interface 与 Schema 字段完全一致；
- Schema、生成物和 Manifest 可重复生成；
- 任何漂移在本地校验和 CI 中失败。


## 10. 索引和示例映射

`schemas/INDEX.md` 与 `examples/README.md` 由 `scripts/update_indexes.py` 确定性生成。每个重要持久对象都必须至少有一个映射示例；仅出现在目录但未进入 `contracts/example-map.json` 的 Schema 不算完成契约覆盖。Conformance Trace 使用动态目录映射，但仍必须引用 Event Catalog 中存在的事件。

CI 使用：

```bash
python scripts/update_indexes.py --check
```

防止新 Schema、Golden Trace 或 reference asset 被添加后总览继续报告旧数量。
