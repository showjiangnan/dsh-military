# ADR-0006：私有战术是版本化可执行程序

- 状态：Accepted
- 日期：2026-08-18

## 背景

传统 Skill 文档不能充分表达前置条件、状态机、验证、回滚、冲突和效能。

## 决策

建立 `ctx.militaryTactics`，管理含场景标签、状态机、Playbook、Verifier Contract、停止条件、回滚、依赖、冲突、来源和指标的 Tactical Procedure。

生命周期：

```text
DRAFT → SIMULATION → CANARY → TESTING → STABLE
                       ↘ QUARANTINED / DEPRECATED
```

## 后果

普通 `ctx.skills` 仅承载经过编译的可见视图；Museum 不能直接发布 STABLE。
