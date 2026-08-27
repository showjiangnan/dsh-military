# 物理存储、事务与迁移设计

## 1. 存储分层

RC.2 完整版默认提供 SQLite + 本地内容寻址 Artifact Store，接口允许替换 PostgreSQL 和对象存储。

```text
DSH Session Persistence  → 原始会话和模型可见历史
Mission Ledger           → 单 Mission 权威事件
Administrative Ledger    → 跨会话治理事件
Projection Store         → 可重建查询模型
Radio Store              → 请求、租约、投递与死信
Artifact Store           → 内容寻址大对象
Policy Store             → 模板、权限、工具、API、模型能力
Generation Store         → preset manifest 与只读资产
```

## 2. SQLite 参考

参考 DDL 位于：

- [`reference/sql/0001-core.sql`](../reference/sql/0001-core.sql)
- [`reference/sql/0002-indexes.sql`](../reference/sql/0002-indexes.sql)
- [`reference/sql/0003-projections.sql`](../reference/sql/0003-projections.sql)
- [`reference/sql/0004-governance.sql`](../reference/sql/0004-governance.sql)

关键唯一约束：

```text
UNIQUE(mission_id, seq)
UNIQUE(mission_id, idempotency_key)
UNIQUE(tenant_id, administrative_seq)
UNIQUE(request_id)
UNIQUE(guidance_id)
UNIQUE(compaction_id, assessment_kind)
UNIQUE(integration_order_id)
UNIQUE(decision_set_id, version)
```

## 3. 事务规则

### Append + Outbox

领域状态改变以单事务完成：

```text
validate expected revision
append immutable event
update aggregate revision
insert outbox row
commit
```

Projection、Web push 和异步 Agent 调度从 Outbox 消费。不能先通知模型再写 Ledger。

### Artifact

```text
write temp bytes
fsync
compute hash
atomic rename into content-address path
insert metadata/ref transaction
```

如果 metadata 失败，孤儿对象由 GC 扫描；如果对象已存在，验证长度和 hash 后复用。

### Radio

`lease` 使用 CAS：

```text
state=QUEUED AND visibility_until < now
→ state=LEASED, lease_owner, lease_version+1
```

Guidance persist、outbox 和 request completion 同事务。实际投递是幂等 Inbox 操作。

### Git Integration

Git 不能和 SQLite 形成单一原子事务，因此使用 Saga 和 repository marker：

1. Ledger `integration/started`；
2. 在临时 worktree 产生 commit；
3. 写 commit trailer `Military-Integration-Order`；
4. CAS 移动 local main；
5. 写 Receipt；
6. 崩溃时根据 trailer 对账。

## 4. Snapshot 和 Projection

Mission Snapshot 是性能优化，不是真源。每个 Snapshot 记录：

- last event seq；
- aggregate revision；
- reducer version；
- state hash；
- createdAt。

Reducer 版本改变时丢弃旧 Projection 并重放 Event。

## 5. Migration Ledger

每个数据库 migration 具有：

```text
migration_id
checksum
applied_at
bundle_version
dsh_baseline
rollback_class
```

分类：

- `REVERSIBLE`：提供 down migration；
- `FORWARD_FIX`：只能前向修复；
- `DATA_REWRITE`：需要备份、校验和双读；
- `DESTRUCTIVE`：必须用户授权和导出。

## 6. Upcaster

Event 原文不可改写。读取时按 schemaVersion 依次 Upcast：

```text
v1 raw event
→ v1-to-v2 upcaster
→ current reducer input
```

Upcaster 必须纯函数、可重复、带 Golden Trace。无法 Upcast 时 Mission 进入只读隔离。

## 7. 多租户

所有管理表和跨会话索引必须含 tenantId。Mission 表也保存 tenantId，查询必须以 tenant scope 为首个谓词。Artifact Ref 授权不能只凭 hash；相同内容 hash 不授予跨 tenant 读取权。

## 8. 备份与恢复

- SQLite 使用在线 backup API 或停写快照；
- Artifact Store 先标记 snapshot epoch，再复制；
- Generation Store 必须与 Session Binding 同时备份；
- 恢复后运行 Event hash、Artifact hash、Git marker 和 Projection 对账；
- 不完整恢复只允许 `DEGRADED_READ_ONLY`。

## 9. 保留与删除

删除是治理流程：

- Session、Mission、Artifact、战术源和报告有独立 retention；
- 引用计数不替代授权；
- legal hold 优先；
- 删除源触发 knowledge impact analysis；
- 删除 generation 前检查可恢复 Session；
- 管理员操作写 Administrative Ledger。

## 10. 验收条件

- 事件 append 幂等且 CAS 生效；
- Projection 可从零重建；
- Git/DB 崩溃点均有补偿；
- tenant 查询不能越界；
- migration checksum 漂移失败；
- 备份恢复后 Golden Mission hash 一致。


## 11. 治理表补充

`0004-governance.sql` 还冻结：

- `agent_execution_bindings`：精确 Agent generation、模板、模型和 preset generation；
- `preset_resume_receipts`：跨重启解析与隔离结论；
- `budget_reservations` / `budget_usage_receipts`：CAS 预留和幂等结算；
- `performance_evaluation_appeals`：不可变报告的申诉链；
- Authority、Policy、Tactical Source、Evaluation、Compaction 和 Bundle Receipt。

这些表保存完整 canonical JSON，同时用少量索引列支撑租户、状态、revision 和恢复查询。JSON 字段不能绕过 Schema；写入前和重放时都必须验证。
