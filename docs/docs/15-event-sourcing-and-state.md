# 事件溯源、状态与持久化

## 1. 为什么需要全局 Mission Ledger

DSH Session Log 适合单 Agent 的持久上下文，但一个 Mission 需要跨多个 Session 管理：

- Direction/Wave/Task DAG；
- Agent lease/generation；
- Candidate/Verification；
- Radio；
- Tactical Skill；
- Specs/Git；
- 全局预算、风险与并发。

因此建立独立 Mission Ledger，并把模型需要看到的事实镜像到相关 DSH Session。

## 2. 四类存储

| 存储 | 内容 | 是否真源 |
|---|---|---|
| Mission Ledger | 不可变领域事件、revision、关联 | 全局真源 |
| DSH Session Log | 单 Agent message/tool/military projection | 该 Session 模型上下文真源 |
| Artifact Store | 大日志、文件、Diff、截图、测试、API receipt | 内容真源 |
| Read Models/Documents | UI、Report、Memory、Specs | 派生投影；Specs 是工程契约但事实需有来源 |

## 3. Event Envelope

```yaml
schemaVersion:
eventId:
missionId:
seq:
aggregateRevision:
type:
timestamp:
actor:
causationId:
correlationId:
idempotencyKey:
payload:
```

Actor identity 由 Harness 注入，不能只信任模型参数。

## 4. 核心事件族

```text
mission/*
direction/*
wave/*
task/*
verification/*
radio/*
oversight/*
specs/*
git/*
model/*
memory/*
tactic/*
incident/*
```

DSH Session 中使用相应稳定 `military/*` Event Family 展示模型可见事实和 Web Conversation Node。

## 5. Revision 与 Task Version

- Aggregate Revision：任何聚合变更递增，用于 CAS；
- Task Version：Objective、scope、acceptance、environment、dependency 或权限改变时递增；
- 普通 observation/metric 可增加 revision，但不使 Candidate stale；
- Guidance 固定 expectedTaskVersion；
- Agent generation 防止旧 Session 写回。

## 6. 幂等

- 每个 Command 有 idempotency key；
- 相同 key + 相同规范 payload 返回原 receipt；
- 相同 key + 不同 payload 报冲突；
- Candidate 唯一键 `(taskId, taskVersion, attemptId)`；
- Compaction Evaluation 唯一键 `compactionId`；
- Git specs commit 用 change-set hash 对账；
- Radio request 去重使用 blocker fingerprint 与 idempotency。

## 7. Session 镜像

凡将进入模型请求的 Mission 事实必须：

1. 已在 Ledger/Artifact 持久；
2. 以稳定 Event 或 message projection 写入目标 Session；
3. 可在冷启动时重建；
4. 携带来源 ID；
5. 遵守 Agent 数据分类和最小上下文。

禁止只通过运行时隐藏内存把关键状态塞进 Prompt。

## 8. Artifact Store

Artifact 使用内容寻址：

- sha256；
- media type；
- byte length；
- classification；
- producer；
- task/version；
- retention；
- redaction lineage。

Event 只保存引用。Secret、超大日志和二进制不内嵌 Ledger。

## 9. 投影

常用 Read Model：

- Mission Overview；
- Direction/Wave Board；
- Task Roster；
- Agent Status；
- Radio Queue；
- Evidence Graph；
- Specs Status；
- Tactical Registry；
- Metrics Dashboard。

投影可删除重建。投影写失败不能宣称领域命令失败，Ledger 写失败则必须 fail closed。

## 10. 恢复与重放

- 启动时重放 Event；
- 识别过期 lease、orphan compaction、未知副作用；
- 对比 projection checksum；
- Agent resume 前重新验证 taskVersion/identity；
- 外部动作通过 receipt 对账；
- 无法判断时 `UNKNOWN_EFFECT`，不自动成功。

## 11. 保留与删除

数据按分类和用户策略保留。删除必须覆盖：Ledger（或合规 tombstone）、Session、Artifact、索引、缓存、导出和备份生命周期。Tactical Memory/Skill 若依赖被删除 Mission，应重新评估来源完整性。

## 0.2.0 新增事实域

新增持久事实：

- DSH Session Log：只记录 DSH 已知会话/模型事件以及模型可见 `user/message`；不写 required `military/*` 私有事件；
- Mission Ledger：记录 `military/session-bound`、Brainstorm、Template instantiated、Task、Radio、Freeze、Specs、Memory 和 Context pressure/compaction attempt；
- Administrative Ledger：Tag revision、Ingestion Job/Candidate review、Agent Template revision、Evaluation Run/Report；机器 envelope 见 [`administrative-event.schema.json`](../schemas/administrative-event.schema.json)；
- Artifact Store：source snapshot、extraction diff、evaluation dataset、individual/overall report。

跨会话管理事件不应硬塞进需要 `missionId` 的 Mission Ledger envelope。

## 0.3.0：生成事件、物理事务与 upcast

Mission/Admin Event Envelope 升级为 `2.0.0` 判别联合，由 Event Catalog 生成。Event payload 不允许自由扩展字段；新增字段通过新 catalog revision 和 upcaster 管理。

物理实现使用 append + aggregate revision CAS。需要外部副作用的操作记录 intent/outbox，再写 receipt 或 compensation。Projection 保存 checkpoint，但可从 Event 重建；Artifact 使用内容寻址文件与 metadata commit。参考 DDL 位于 [`reference/sql/`](../reference/sql/README.md)。
