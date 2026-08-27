# ADR-0041：本地与分布式 Production Plane 使用同一能力接口

**状态：Accepted**

## 背景

本地 RC.2 Bundle 需要零外部基础设施即可运行；多租户或多地域部署则需要
PostgreSQL、对象存储、外部 durable queue、KMS、容量控制、签名备份与可观测性。
仅在设置或文档中写出这些名称，不等于系统具备对应生产能力。

## 决策

Contracts 定义可替换的 Ledger/Artifact/Queue/KMS/Telemetry/Capacity/Backup
能力和不可变 provider descriptor。SQLite 本地实现明确报告 `LOCAL_SINGLE_NODE`；
外部 adapter 必须以运行时注入的 exact instance 同时承载真实调用和 readiness
证据。

`assessProductionReadiness()` 校验：

- exact provider topology 与部署目标一致；
- provider 为 `READY`，并声明 durability、tenant isolation 和 residency；
- 分布式目标不得把 SQLite、本地文件或进程内队列冒充 PostgreSQL、对象存储、
  外部 durable queue 或 KMS；
- 备份签名、恢复演练、capacity/backpressure 和 telemetry 均有独立证据。

事务 outbox 同时实现 `MilitaryDurableQueue` seam，保持 partition order、
idempotency、claim/retry/dead-letter/offset。它是本地权威实现，不被标成外部队列。

## 结果

单机安装继续可用；企业部署可以注入真实云或自建 adapter，而核心 Workflow、
Artifact ACL 和恢复协议不变。仓库不捆绑特定云厂商 SDK，也不声称未配置的外部
服务已部署。
