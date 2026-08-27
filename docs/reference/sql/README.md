# SQLite 参考持久化

这些 migration 定义 `0.9.0-draft` 的 RC.2 本地参考 Provider。生产实现通过 migration runner 按编号应用并记录 checksum；不得用启动时 `CREATE TABLE IF NOT EXISTS` 取代版本治理。

- `0001-core.sql`：Mission/Admin Ledger、Artifact、Radio、Workspace、Integration、Decision 与 Generation；
- `0002-indexes.sql`：核心唯一约束和查询索引；
- `0003-projections.sql`：Projection checkpoint、Transactional Outbox、Migration Ledger、Dataset Manifest 和 compaction assessment；
- `0004-governance.sql`：Authority、Policy、Model Receipt、Budget、Tactical Source/Revocation、Evaluation Job、Compaction Attempt、Preset Resume、Agent Execution Binding、绩效申诉与 Bundle Lifecycle。

SQL 是该参考 Provider 的物理真源；领域语义仍由 JSON Schema、Event Catalog 和服务契约定义。

## 迁移要求

- 每个 migration 记录 checksum、Bundle version、RC.2 commit 和 rollback class；
- 开启 foreign keys 和 WAL；
- 所有 tenant 数据表首键含 `tenant_id`；
- Event append 使用 aggregate revision CAS；
- Outbox consumer、usage receipt、Git/Artifact recovery 均幂等；
- Projection 可从 Event 从零重建；
- migration checksum 漂移时停止启动。
