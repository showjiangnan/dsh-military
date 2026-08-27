# ADR-0033：Mission Kernel 单写者 Command Bus

**状态：Accepted**

每个 Mission 按 `tenantId + missionId` 串行化。Agent 和外部执行器只提交 Command，Mission Kernel 独占领域事件、Outbox 和 Projection 提交。该决策减少跨 Agent CAS、双写和终止竞态。
