# ADR-0015：所有非 General 子代理由版本化模板和显式上下文策略创建

- 状态：Accepted
- 日期：2026-08-18

## 背景

用户需要在 WebUI 管理各部门模型、Thinking、上下文预算和压缩比例。若配置直接热改运行中 Agent，绩效归因、恢复和请求重建都会失真。

## 决策

每个非 General Agent 从 `AgentTemplateProfile(templateId, revision)` 创建。实例冻结 provider/model/reasoning/context policy 快照；安全撤权可立即收紧。达到配置阈值时，系统在安全边界创建一次可审计 compaction attempt；失败不能伪装为成功。绩效按 template revision 和实际模型路由分组。

## 后果

- 配置变更只影响新实例或显式迁移；
- UI 需要显示 effective budget 和 revision；
- 运行时需要 pressure generation、hysteresis 和 compaction failure 处置；
- 用户可用 Canary revision 比较新配置。
