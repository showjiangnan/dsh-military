# ADR-0040：SQLite 短事务 Command Saga

**状态：Accepted**

## 背景

把 Mission admission、模型调用、Git/文件系统副作用、验证、receipt 和 outbox
放进一个异步 SQLite 事务，会让写锁跨越不可控 I/O。其他写入可能串入同一连接，
随后被无关 rollback 回滚；进程崩溃也无法判断外部副作用是否已经发生。

## 决策

`SqliteMilitaryDatabase.transaction()` 只接受同步回调；返回 thenable 会立即
rollback 并抛错。通过公开数据库句柄执行的 standalone
`statement.run()`/`exec()` 写入自动使用短 `BEGIN IMMEDIATE` 事务，避免任何
repository 绕过 writer 约束。SQLite 禁止置于事务内的启动 PRAGMA 和 `VACUUM`
只能经过显式 `maintenance()`；该入口不得承载领域写入。

命令执行拆成三个短事务阶段：

1. 写 admission event 和 `mission_command_operations` intent，取得 effect lease；
2. 在 SQLite 事务外执行具有稳定 operation/idempotency key 的外部操作；
3. 写 `EFFECT_APPLIED` checkpoint，再原子写 command receipt、transactional
   outbox 和 `COMMITTED` fence。

状态固定为：

```text
PENDING_EFFECT → RETRYABLE ─┐
       │                    ├→ PENDING_EFFECT
       └→ EFFECT_APPLIED ───┴→ COMMITTED
```

`EFFECT_APPLIED` 表示副作用结果已持久化但 receipt 尚未完成；重试只执行 finalization。
`RETRYABLE` 必须使用原 idempotency key 重新进入同一可查询外部 operation。错误详情
只持久化稳定类别和摘要指纹，避免 Provider 文本泄露凭据或绝对路径。

## 结果与限制

- SQLite 写锁不跨模型、Provider、Git、文件系统或长验证。
- transaction、standalone write 和 maintenance 三条路径互斥；常规调用者不能
  取得未保护的 writable handle。
- admission、effect checkpoint、receipt 和 outbox 各自可恢复；重复调用不重复
  已 checkpoint 的副作用。
- Host 不猜测不可查询、非幂等的第三方副作用；这类 adapter 必须先提供 operation
  status 或 idempotency contract，否则不得接入命令路径。
- Operations Center 报告过期 effect lease、`RETRYABLE` 和 `EFFECT_APPLIED`，
  但不会伪造自动恢复结果。
