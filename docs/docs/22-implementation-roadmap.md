# 实施路线图

## 1. 原则

`0.3.0` 不再按“先堆角色、后补基础设施”的顺序实现。路线以**可恢复权威闭环**为主线；每个阶段必须有真实 RC.2 Fixture、机器契约和退出条件。

完整支持基线固定为：

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

## 2. Phase 0：契约、生成与 RC.2 Scaffold

实现：

- 从 `contracts/event-catalog.json` 生成事件类型、Schema 和 Fixture；
- 领域 ID、错误码、Authority Context 和 Profile 类型；
- preset asset package、generation hash 和 archive；
- RC.2 Compatibility Probe；
- 真实 DSH fixture app；
- SQLite migrations 和测试数据库；
- CI 中的 Schema/TS parity 与 Golden Trace。

退出条件：

- 所有静态门禁通过；
- RC.2 干净组合能发现 `military`；
- Standard Session 看不到 Military 工具；
- current generation 可在重启后恢复；archived-only 根 Session 会在模型请求前隔离并生成迁移路径。

## 3. Phase 1：General 与模型路由

实现：

- Military Session Binding；
- General persona 和领域入口；
- preset General model default；
- 会话模型选择覆盖；
- ModelCapability/Reasoning/Residency/预算准入；
- ModelSelectionReceipt；
- Preset Resume Receipt 与不可变 General route 恢复；
- root-only Decision Broker 与 `ask_user_question` Relay。

退出条件：

- 没有用户覆盖时使用 preset 默认；
- 切换只影响 General 后续请求；
- child route 不跟随；
- 不合规模型拒绝且旧路由保留；
- request/header 可重建 effective route。

## 4. Phase 2：单 Task 的隔离执行闭环

实现：

```text
Task Order
→ Workspace Snapshot/Lease
→ AgentExecutionBinding + Resource Reservation
→ one Thinking Worker
→ Candidate Patch + Evidence
→ deterministic Verifier
→ ACCEPTED/REWORK
→ Integration Order
→ global regression
→ local main commit
→ Integration Receipt
```

退出条件：

- 未验收文件不进入主工作树；
- FROZEN Worker 无法写入；
- stale Task Version/Candidate 被拒绝；
- Git commit 成功但 Ledger 失败可恢复；
- 普通 Session 外部修改只产生 drift。

## 5. Phase 3：Direction、Wave 与参谋部

实现：

- Direction/Wave/Task DAG；
- Advisor Profile、Template revision 和资格过滤；
- 独立研判、Lead/Consulting Advisor 合成；
- Workforce Plan 与并发准入；
- Wave Barrier、Change Order 和任务重规划。

退出条件：

- DAG 无环且依赖可解释；
- 任务满足最小可独立验收；
- 权限、预算和 Workspace 冲突能裁剪兵力建议；
- 模型不能自行接受或改变验收合同。

## 6. Phase 4：工兵、specs 与 Git 纪律

实现：

- 项目阶段侦察；
- IDEATION/SPECS_ONLY baseline；
- `/brainstorm`；
- specs 模板和追踪矩阵；
- 工兵专用路径/工具；
- local `main` init、Integration 和 commit；
- General-only Promotion Order。

退出条件：

- 空项目在实现前有 specs baseline；
- 每个 Wave 关闭前 specs 和 commit receipt 存在；
- 工兵无法 push、force、切远端分支；
- 用户问题和授权可恢复。

## 7. Phase 5：督战与完整 Verification

实现：

- Completion Interlock；
- 只读 Inspector；
- 确定性 Freeze/Release；
- Evidence Graph；
- Verifier Registry/Profile；
- 事故包与恢复策略。

退出条件：

- 谎报工具或范围外写入可冻结；
- 冻结与进行中工具竞态安全；
- Inspector 模型意见不能改变权威状态；
- 误冻结可审计、释放有合同。

## 8. Phase 6：Radio、参谋长与私有战术

实现：

- Radio Broker、lease、dedupe、DLQ；
- Escalation Gate；
- Tactical Registry 和 3–5 候选检索；
- 单一 Directive 编译；
- Tactical Sufficiency Gate；
- Chief of Staff fallback；
- DecisionQuestionSet Relay。

退出条件：

- 无 Evidence 的求援不消耗 Advisor；
- stale guidance 不投递；
- Advisor 不能直接控制兄弟 Worker；
- Chief 建议明确假设并有预算。

## 9. Phase 7：知识供应链与研究部

实现：

- 历史 Session/直接经验/Artifact ingestion；
- 来源权利、Secret/PII/Injection、矛盾和时效检查；
- DRAFT/Canary/Stable 生命周期；
- 撤回影响图；
- Tactical Report、Trajectory、Effectiveness、Museum；
- General compaction 后 exactly-once 评估。

退出条件：

- 来源可追溯且可撤回；
- 未验收内容不进入确认记忆；
- Museum 不能单独发布 Stable；
- 战术效果不把相关性误写为因果。

## 10. Phase 8：军事评估委员会

实现：

- Evaluation Request 和 Dataset Manifest；
- 跨会话权限和去标识化；
- 确定性指标；
- 双 Examiner、Chair、难度校正和缺失机制；
- individual + overall 报告；
- 结构化申诉、独立复核和 superseding report revision。

退出条件：

- 报告可由 dataset hash 复现；
- 样本不足不排名；
- 模型不能覆盖确定性指标；
- 普通 Session 不进入数据集。

## 11. Phase 9：WebUI 与运营

实现：

- 全部 Settings Cards；
- Military Remote/Projection 驱动的 Conversation Nodes 和 Mission Dashboard（Beta 目标；不得依赖私有 DSH Session Event）；
- model source/selection UI；
- generation quarantine 和迁移；
- Workspace/Integration、Freeze、Radio、Budget、Ingestion、Evaluation；
- revision conflict、多标签页、断线恢复；
- 中性术语和可访问性。

退出条件：

- UI 可从 durable facts 重建；
- 高风险操作有权限/范围/receipt；
- 刷新不丢 Job；
- 键盘与屏幕阅读器路径通过 E2E。

## 12. Phase 10：生产化与分布式 Provider

实现：

- PostgreSQL/对象存储/队列/KMS Provider；
- 多租户限额和数据驻留；
- 资源 reservation 与背压；
- OTel、SLO 和容量测试；
- 安装、升级、回滚、disable、uninstall；
- 签名资产、灾备和 legal hold。

退出条件：

- 恢复演练和故障注入通过；
- 预算不出现负余额或重复结算；
- 租户数据隔离通过安全测试；
- 升级后旧 Session 要么精确匹配 current generation，要么安全隔离并完成显式迁移；
- 卸载数据处置可审计。

## 13. 首个推荐 PR 序列

```text
PR-01 generated contracts + event catalog
PR-02 preset assets + generation archive
PR-03 RC.2 fixture + compatibility probe
PR-04 SQLite ledger/outbox/artifact metadata
PR-05 General binding + model policy/receipt
PR-06 Authority/policy registry + AgentExecutionBinding
PR-07 budget reservation + usage settlement
PR-08 workspace + candidate patch
PR-09 verifier + integration/local main
PR-10 decision broker + ask-user relay
PR-11 one-session WebUI projection
```

前 11 个 PR 完成后再开始大规模多 Agent 编排。

## 14. 发布门禁

每个 Phase 必须：

- 文档/Schema/TS/Event Catalog 同步；
- Golden Trace 更新；
- RC.2 Fixture 无回归；
- 权限负向测试；
- 故障恢复路径；
- 变更说明和 migration；
- `IMPLEMENTATION-READINESS.md` 对应项更新。
