# 机器契约真源

- `event-catalog.json` 是 58 个 Mission Event 与 36 个 Administrative Event 的名称、Payload Schema、示例和生成类型唯一真源。
- `error-catalog.json` 是 65 个稳定错误码、retryability 与恢复指引的唯一真源。
- `parity-map.json` 指定 39 个必须在 JSON Schema 与 TypeScript 参考接口之间保持顶层字段/required 一致的对象。
- `example-map.json` 绑定非事件 Schema 与合法示例；Conformance Trace 由目录动态纳入。
- 运行 `python scripts/generate_contract_artifacts.py` 生成事件 Envelope、TypeScript、JSONL 与事件目录。
- 运行 `python scripts/generate_error_artifacts.py` 生成 Failure Schema、TypeScript 和错误恢复目录。
- 运行 `python scripts/update_indexes.py` 生成 Schema/Example 索引。
- 运行 `python scripts/validate_artifacts.py` 检查生成物新鲜度、字段一致性、事件覆盖、Preset generation、RC.2 Fixture、SQL、状态机和 Trace。

## 权威顺序

```text
JSON Schema = wire/storage object truth
Event Catalog = event name/payload truth
Error Catalog = failure code/recovery truth
SQL migration = physical persistence truth
TypeScript = compile-time projection
Markdown = 语义、约束与理由
```

生成文件和目录索引不得手工修改。
