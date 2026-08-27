# 一致性测试、Golden Trace 与模型检查

## 1. 目标

文档语法通过不等于系统契约一致。本工程把以下门禁加入校验：

```text
generated-artifact freshness
schema ↔ TypeScript field parity
event catalog ↔ envelope ↔ JSONL parity
preset generation hash
RC.2 fixture compatibility
state-machine invariants
SQL migration shape
Golden Trace replay
```

## 2. Golden Trace

`examples/traces/` 保存至少：

- normal candidate acceptance；
- rework；
- Radio guidance；
- Freeze/Release；
- Brainstorm decision；
- specs commit；
- workspace integration；
- compaction；
- preset restart resume；
- tactical ingestion/revocation；
- performance evaluation；
- install/rollback。

每条 Trace 指定输入 Event、预期投影 hash 和必须成立的不变量。

## 3. 属性测试

关键属性：

```text
ACCEPTED task cannot return to EXECUTING
FROZEN agent cannot execute write tools
one task version has at most one accepted candidate
stale guidance cannot be delivered
non-Military session cannot obtain Military tool schema
PAUSED/DELETED tag cannot create automatic association
only Harness can append task/accepted
main moves only after accepted patch and global regression
user model switch never changes child template route
```

## 4. 并发模型

参考 [`reference/tla/MilitaryCore.tla`](../reference/tla/MilitaryCore.tla) 建模：

- Candidate 与 Change Order；
- Guidance 与 Task version；
- Freeze 与工具执行；
- Compaction 与用户问题；
- Tag delete 与 ingestion commit；
- Evaluation cancel 与 report publish；
- Integration 与外部 workspace drift。

模型检查目标不是证明模型内容正确，而是证明权限和状态转换不存在已知竞态路径。

## 5. RC.2 Conformance Fixture

Fixture 在真实 DSH RC.2 组合中验证：

1. `military` 出现在 preset picker；
2. Standard Session 不见 Military 工具；
3. Military Session 默认 General model；
4. Session model selector 能覆盖 General；
5. 子 Agent route 来自 template；
6. 非空 Session preset lock；
7. current-generation restart resume + archived-only root quarantine/migration；
8. root-only ask-user；
9. Freeze pre-step；
10. Compaction event 和 effectiveness dedupe。

## 6. Fault Injection

注入：

- Event append failure；
- Artifact fsync failure；
- Radio lease timeout；
- 模型 timeout；
- 工具忽略 Abort；
- Git commit 成功、DB 失败；
- profile 写入中断；
- generation asset 缺失；
- 两个标签页并发回答；
- 评估数据读取中断。

每个注入点有明确恢复状态，不允许未知半成功。

## 7. Validation Categories

`validate_artifacts.py` 输出新增：

```text
generated
contract-parity
event-coverage
preset-generation
rc2-compatibility
state-invariants
sql
trace
```

0.3.0 发布要求全部通过。

## 8. Contract Freeze Gate

进入实现契约冻结必须满足：

- 所有 P0 Schema 和服务接口存在；
- Event Catalog 无开放 Payload；
- 共享字段 parity 通过；
- 数据库 migration 可应用；
- preset generation 可精确匹配；不支持的 archive rebind 会 fail closed；
- Workspace integration 有 Receipt；
- Authority Context 覆盖所有管理操作；
- Golden Trace 可重放；
- RC.2 Fixture 在干净环境通过。

## 9. 变更后测试选择

契约变更通过影响图决定：

```text
Schema → examples + TS parity + services
Event → generator + reducers + traces + migrations
Preset → generation hash + RC.2 fixture + resume
Permission → negative tests + revocation races
Workspace → integration + crash recovery
Evaluation → dataset reproducibility + fairness tests
```

## 10. 验收条件

- 生成物不可手工漂移；
- 事件示例覆盖全部 Event Type；
- 关键状态竞态有模型；
- 每个故障点有终态；
- 验证报告明确区分语法、一致性和运行 Fixture；
- 只有全部门禁通过才把 tarball、manifest 和校验和标记为已验证 release。
