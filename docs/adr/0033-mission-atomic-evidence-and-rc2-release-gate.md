# ADR-0033：Mission 原子提交、Observed Evidence 与 RC.2 发布门禁

状态：Accepted  
版本：0.9.0

## 决策

1. Mission Command 的 Receipt、Domain Events、Outbox 与 Projection Checkpoint 必须处于同一个 SQLite 事务。
2. 所有外部副作用移出事务并由 Durable Activity + Receipt 驱动。
3. Candidate 只能引用 Harness 观察并持久化的 Evidence Receipt。
4. 文件资源在 Capability Grant 前规范化为 repository-relative canonical resource。
5. 默认发布命令必须执行固定提交的 exact RC.2 类型与 Web package gate。
6. RC.2 experimental Agent Team 只允许作为非权威 Projection，不替代 Military Mission Kernel、Task、Radio 或 Workspace 隔离。

## 后果

系统增加了事务、Outbox、Reconciliation 和 Evidence Store 的实现复杂度，但获得可重试、可恢复、可审计且不会依赖 Agent 自报的完成语义。
