# ADR-0031：昂贵工作执行前必须预留资源并幂等结算

- 状态：Accepted
- 日期：2026-08-19

## 背景

只配置预算上限不足以防止并发超卖。多个 Staff、Worker、Compaction 和 Evaluation Job 可能同时看到相同剩余额度，事后计量会形成负余额或无法确定谁应停止。

## 决策

所有昂贵操作先创建版本化 `ResourceBudgetReservation`，按 Deployment→Tenant→Mission→Wave→Task 层级执行 CAS。成功后才能发布 Agent 或发起模型/批量工作。完成、取消或恢复后以 `ResourceUsageReceipt` 幂等结算。

`REJECTED` 不执行副作用；`RESERVED` 只能进入 `SETTLED | EXPIRED | REVOKED`。相同 idempotency key 只计一次。

## 后果

- 预算和并发可在高并发下保持非负；
- 崩溃后可回收过期 lease 或重放结算；
- 调度增加 reservation 延迟和恢复队列；
- Verifier 和安全停止的必要资源应通过独立保留池保障，不能被普通 Worker 耗尽。
