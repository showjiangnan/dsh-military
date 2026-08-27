# ADR-0009：程序化创建 Agent，并以薄适配隔离 DSH

- 状态：Accepted
- 日期：2026-08-18

## 背景

军事角色需要独立 persona、tools、reasoning、权限、身份和 setup；DSH 仍在快速演进。

## 决策

通过公开 `ctx.agents.create/resume` programmatic path 创建角色 Agent。领域核心只依赖自有接口；DSH hooks 和类型封装在 `adapters-dsh-*` 包。

## 后果

DSH 升级成本集中于适配层；需要支持矩阵和契约重放 CI。
