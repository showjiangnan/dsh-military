# 数据保留与删除策略

| 数据 | 默认保留 | 删除/归档条件 | 备注 |
|---|---|---|---|
| Mission Ledger | 长期 | 用户删除/合规策略 | 删除需保留最小审计 tombstone 时应明确 |
| DSH Session | 与 Mission 一致 | Mission 删除或用户策略 | 可能含模型可见敏感上下文 |
| Artifact 原文 | 按分类 TTL | hash 引用失效前归档 | Restricted 默认最短 |
| Tool raw logs | 短期 | 生成脱敏证据后 | 禁止保留密钥 |
| Radio requests | Mission + 30 天 | 关闭且无审计需求 | Dead letter 单独策略 |
| Tactical Memory | 长期 | 来源 Mission 删除时重评 | 是派生投影 |
| Tactical Skill | 版本长期 | Deprecated 后归档 | 不原地篡改 |
| Metrics | 聚合长期 | 原始事件按分类删除 | 防止重新识别 |

删除必须覆盖：主存储、索引、缓存、导出、对象存储和备份生命周期，并记录执行结果。

## 0.2.0 数据类型

| 数据 | 默认保留 | 删除/归档条件 | 备注 |
|---|---|---|---|
| MilitarySessionBinding | 与 Session 一致 | Session 删除/合规策略 | 保留最小 preset/generation tombstone 需明确 |
| Agent Template revisions | 长期 | Retired 后归档 | 绩效和恢复需要原配置快照 |
| Tactical Tags | 长期 | DELETED 为 tombstone | rename/alias 不破坏历史引用 |
| Ingestion Request/Review Receipt | 按审计策略 | Job 关闭且来源政策允许 | 不应含未脱敏原文 |
| Source Snapshot | 按分类 TTL | 用户撤回、企业策略、候选拒绝后缩短 | 战术仍引用时需衍生数据审查 |
| Extraction Candidate/Diff | Draft 生命周期 + 审计期 | Reject 后按分类删除 | 未批准不能进入调用目录 |
| Evaluation Dataset | 短至中期 | 报告固化且审计窗口结束 | 冻结 hash；默认不长期保留完整提示 |
| Individual/Overall Report | 长期或用户策略 | 数据撤回后重建/标注 | 含 classification 与 rubric/model 版本 |
| Decision Question/Answer Receipt | 与 Mission/Brainstorm 一致 | 用户策略 | 用户选择与高风险授权必须区分 |

跨会话数据撤回时，系统必须识别受影响的 Tactical Skill、Effectiveness、Performance Report 和 Museum Archive，并执行删除、重建或“数据已撤回”标记，不能只删来源 Session 索引。

## 0.3.0 数据类型与保留建议

| 数据 | 默认保留 | 删除/撤回语义 |
|---|---:|---|
| Preset generation archive | 被 Session 引用期间 + 安全窗口 | 仅无引用、无 legal hold 后 GC；保留 manifest tombstone |
| Authority/Authorization Receipt | 审计期 | 不改写；到期停止新使用 |
| Tool/Permission/API Policy revision | 被 Event/Agent binding 引用期间 | REVOKED/RETIRED，不删除历史 revision |
| Workspace snapshot/worktree | Attempt 结束后的短窗口 | worktree 可删；manifest/Patch/Receipt 按审计期保留 |
| Candidate Patch | Mission 审计期 | 内容可按分类策略归档/删除，保留 hash 与 disposition |
| Decision Broker records | Mission + 申诉窗口 | 敏感回答可脱敏；保留状态和 answer receipt hash |
| Tactical Source Snapshot | 战术存在期间 | 撤回后限制内容访问，保留派生图和合规 tombstone |
| Evaluation Dataset Manifest | 报告存在期间 | source shard 可按策略删除；保留 hash、纳入规则、报告 revision |
| Budget/Usage Receipt | 账务与审计期 | 幂等 identity 永久/长期保留，防重复结算 |
| Bundle Lifecycle Receipt | 部署生命周期 | 卸载后保留最小审计和数据处置结果 |
| Agent Execution Binding | Agent/Mission 审计期 | 不原地修改；保留精确 Profile revision 与 preset generation |
| Preset Resume Receipt | Session 可恢复期 + 审计窗口 | generation asset 删除后仍保留 disposition 与 manifest tombstone |
| Performance Evaluation Appeal | 报告 revision 链存在期间 | 不删除原报告；撤回只改变 Appeal state |

删除顺序必须尊重派生关系、legal hold、来源权利和租户策略。Session/Artifact 内容删除不应导致历史 Event 被错误解释为普通文本；使用 redaction/tombstone/不可访问引用。
