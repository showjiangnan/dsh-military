# 版本信息

- 文档工程版本：`0.9.0-draft`
- 源码实现版本：`0.9.0-alpha.28`
- 领域事件 Envelope：`2.0.0`
- 其余领域 Schema：各自按 SemVer 演进，当前主要基线为 `1.0.0`
- 文档同步日期：`2026-08-28`
- 唯一支持的 DSH 基线：`dsh@0.1.1-rc.2`
- 上游固定提交：
  `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- 固定公开 preset id：`military`
- 当前 preset generation：
  `military@sha256:054486e73b1b1f8385782497cda79e9a887897fbc338dd9bc6ca80d01a1e8146`
- 最终 RC.2 发行门验证时间：`2026-08-28T03:23:27.624Z`

Preset generation 由
`reference/preset/agent-presets/military/generation-manifest.json` 计算并与源码
package 镜像校验，不手写。任何其他 DSH release、commit、回移植版本或自定义
组合都不属于本版本支持范围；Compatibility Probe 通过也不会自动扩大正式支持
矩阵。

## alpha.28 Workbench 无损升级与控制面恢复版本

本版本新增并冻结以下 Web/Host 契约版本：

```text
Military control plane schema   1.0.0
Military operations schema      1.0.0
Military workspace schema       1.0.0
Military benchmark schema       1.0.0
Military knowledge schema       1.0.0
Military evaluation schema      1.0.0
Military runtime schema         1.0.0
Military production schema      1.0.0
Benchmark dataset               military-flash-core-v1
Benchmark dataset SHA-256       76ea0817a8daab513ed9661b61965e0524e5aa15007ddcc1c16797b17d8a50d0
SQLite migration                0010-command-saga.sql
```

Web 交付包含 12 角色工作台、六层有效 Prompt、Flash readiness/模拟、提示词
Desired/Applied revision、能力模型目录、成本、诊断/恢复、Specs workspace、
Request→Integration Runtime Center、固定评测、简体中文辅助检查、知识透明度/
模拟召回、绩效七视图决策中心以及键盘/IME/高对比度合同。

绩效 v2 冻结 canonical Dataset、精确 Attempt/配置/路线、预执行难度、缺失与失败
阶段、Wilson/Mission-cluster 区间、Flash/Pro 非劣硬门、Accepted Outcome
经济性、可恢复 SQLite 分片和 immutable Appeal lineage。Provider 趋势仍可在
至少 10 个 exact-route 独立 Session 且区间足够窄时显示；发行 acceptance 是更
严格的独立门：每个 exact configuration × scenario 至少 50 个独立 Session，
首次工具命中点估计 ≥95%/Wilson 下界 ≥85%，E2E ≥90%/下界 ≥80%，意外确定性
错误、越权写入、假完成和重复终态全为 0。确定性门和真实 Provider 样本是两个
独立证据维度。

## 兼容与发布承诺

- General 默认路由属于固定 Preset；用户显式会话模型选择只影响 General 后续
  请求，不改写既有子代理的 `AgentExecutionBinding`。
- 不满足 Thinking、上下文、工具、数据驻留、Authority 或 Budget 条件的请求在
  Provider/Tool 副作用前拒绝。
- JSON Schema、Event Catalog 和 Error Catalog 是跨进程合同真源；生成物、
  TypeScript parity、示例和运行时 handler validation 必须一致。
- Preset 使用内容寻址 generation。旧 Session 无法精确恢复时必须
  `QUARANTINED`，禁止静默挂载 current generation。
- Mission/Admin Ledger、持久化 receipt 和宿主观察证据是权威真源；模型陈述
  和 DSH experimental Agent Team 不是完成证据。
- 外部插件不向 DSH Session Log 写入 required `military/*` 私有事件。
- `pnpm verify:rc2` 校验固定合同快照；`pnpm typecheck:rc2` 必须针对精确、已
  构建的官方 checkout；`pnpm release:verify` 还必须完成干净 Profile 安装、
  Loader 激活、重启 E2E、pack/publint、可重复打包和校验和验证。

## 相互独立的版本层次

```text
Bundle/NPM version
Preset generation hash
Domain Schema version
Event envelope version
Agent Template revision
Tactical Skill SemVer
Policy/Profile revision
Evaluation rubric version
Database migration version
```

不得用 Bundle 版本替代运行时对象、政策或持久化合同的精确身份。
