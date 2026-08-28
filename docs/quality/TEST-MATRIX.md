# 测试矩阵

| 层级 | 测试对象 | 必需场景 |
|---|---|---|
| Schema | 所有外部 payload | 正例、缺字段、未知字段、主版本拒绝 |
| Unit | 状态机 | 合法/非法迁移、终态、不变量 |
| Property | DAG/调度 | 无环、写冲突、随机顺序、CAS race |
| Unit | Permission | 每角色工具/API/path/Git deny |
| Integration | DSH Agent | setup、reasoning、freeze、turn-stopping |
| Integration | Tool Pipeline | claim 对账、cancel、timeout、result receipt |
| Integration | Radio | dedupe、lease、expiry、dead letter、stale guidance |
| Integration | Git | init main、commit、hook fail、existing repo、no remote write |
| Replay | Ledger/Session | crash boundaries、projection checksum |
| E2E | Mission | ideation、active、legacy、rework、blocker、completion |
| Security | Enterprise API | prompt injection、secret redaction、scope bypass |
| Chaos | Providers | DB down、disk full、advisor timeout、HMR unload |
| UI | Event projection | reorder、pagination、disconnect/reconnect、revision conflict |

## 发布阻断测试

- Candidate 无工具证据却被接受；
- stale Candidate 并发竞态；
- Worker 写 specs；
- Engineer push；
- Frozen Agent 继续写；
- Memory 引用未接受 Event；
- Museum 直接发布 STABLE；
- Secret 出现在导出日志。

## 0.2.0 专项测试

| 能力 | 必需测试 |
|---|---|
| Fixed preset | roster 健康、完整 root overlay、默认值保留、broken fail closed、started-session lock |
| Session isolation | Military/Standard 同 cwd、listener early return、Tool/Prompt diff、Metric/Compaction 零串扰 |
| Child inheritance | `composeFrom()` exact generation、父 preset 被编辑/删除后的既有 child 行为 |
| Agent Template | revision fencing、模型能力、reasoning off 拒绝、设置漂移、权限撤销 |
| Context Policy | threshold、pressure generation、hysteresis、null/failure、工具配对边界、handoff |
| Brainstorm | command scope、General ask-user、问题去重、取消/恢复、specs handoff |
| Chief fallback | sufficiency gate、Advice 过期、事实引用、用户问题 relay、循环预算 |
| Tactical tags | create/pause/resume/rename/delete、alias 冲突、历史 tombstone |
| Tactical ingestion | source authorization、snapshot hash、secret/PII/injection、similarity、Diff review、DRAFT-only |
| Evaluation | 完整 Request 筛选、actual-preset、canonical dataset hash、Attempt window、exact configuration、difficulty/missingness、统计区间、totals |

## 新增发布阻断测试

- 非 Military 会话看到任何 Military model-facing tool/prompt/command；
- profile overlay 丢失部署原有 preset root；
- child 未继承父 preset generation 却成功发布；
- 达 context threshold 后既无 attempt 也无显式升级；
- delegated child 直接弹出用户问题；
- 未经用户审阅的提炼内容进入 ACTIVE/STABLE 战术；
- DELETED tag 被新战术引用；
- 评估扫描纳入普通 Session；
- 委员会报告数字无法由冻结 Dataset 重算；
- 小样本被输出为确定排名。

## 0.3.0 实现收敛测试矩阵

| 领域 | 正向 | 负向/并发 | 恢复 |
|---|---|---|---|
| Preset generation | current/new Session | hash mismatch、同名冲突 | current 重启恢复；old archive root→quarantine/migration |
| Agent binding | template→binding→request | policy revision drift、reasoning mismatch、revoke | restart attribution and exact binding replay |
| Preset resume receipt | current match、同进程 standing archive | missing asset、unsupported root archive rebind、receipt write fail | process restart before Agent publication |
| Budget settlement | hierarchical reserve/settle | oversubscribe、expiry、duplicate key | crash lease reclaim and replay |
| Evaluation appeal | authorized evidence challenge、Dataset membership | stale report、跨 Dataset exclusion、missing evidence | immutable old report、idempotent superseding revision |
| General model | preset default、UI switch | off/小上下文/驻留拒绝、child 不跟随 | resume effective route、失败保留旧 route |
| Contract generation | catalog→Schema/TS/JSONL | 手改生成物、漏 Event | regenerate deterministic |
| Authorization | owner/admin 合法操作 | cross-tenant、过期、撤权竞态 | receipt replay/dedupe |
| Workspace | isolated Patch/accept/integrate | symlink、base drift、并发冲突 | commit success/DB failure recovery |
| Decision Broker | root relay/answer | 双标签页、stale、expired | refresh/restart pending question |
| Knowledge | rights + DRAFT | injection、未知 license、矛盾 | source revoke impact/revalidation |
| Evaluation | reproducible dataset/report、Flash/Pro non-inferiority | sample/route inflation、missing、unknown cost、hard gate | cancel/timeout/restart shard/appeal revision |
| Budget | reserve/settle/release | concurrent oversubscribe、duplicate usage | crashed lease reclaim |
| Bundle lifecycle | install/upgrade | profile CAS conflict、probe fail | rollback/disable/uninstall retain/export |
| WebUI | durable nodes/settings | conflict、disconnect、broken preset | reconnect and same Job state |
| Terminology | military/neutral | custom label injection/permission confusion | presentation reset, stable IDs |

## 0.9.0-alpha.22 控制中心基线专项

| 领域 | 正向 | 负向/并发 | 恢复/可访问性 |
|---|---|---|---|
| 角色工作台 | 搜索/筛选、单角色编辑、六层预览、原子保存 | stale revision、伪造 route、部分写入 | immutable history、undo、rollback 新 revision |
| Flash readiness | 默认 12 角色 READY、实际 Schema 摘要 | Host 字段、路径猜测、歧义终态、复杂 Schema | 稳定 code/位置/建议，不自动 fallback |
| 角色模拟 | 首调用、纠正、终态、父 receipt | 未确认 Canary、写范围请求、Provider failure | deterministic receipt、Canary 审计 |
| 简体中文 lint | 自然语言逐项/批量确认 | code/path/identifier 误报、伪造位置/hash | 单批撤销、review receipt |
| 模型/成本 | DSH live catalog、预算预设、历史 observed usage | unavailable/incompatible、未知价格/alias | status revision，不伪造价格 |
| Operations | 权威时间线、健康快照、精确预览 | 原始 SQLite、错确认短语、跨范围 operationId | 幂等 receipt、重启重放 |
| Specs Workspace | opaque ID、canonical root、Git rename destination | arbitrary absolute path、unknown ID、symlink escape | Session binding 重建、只读 projection |
| 固定基准 | 九场景 hash、deterministic PASS、完整 sequence/receipt | dataset drift、parser revision 膨胀、alias/fallback 混入 | 既有 Session 复评、N<10 趋势保护与 N<50 发布 acceptance 拒绝 |
| 知识透明度 | sanitized snapshot/chunk、lineage、exact recall | Raw Vault/Secret 泄漏、无权/过期版本 | SQLite simulation history、撤回影响 |
| 模拟召回 | 与真实 resolver/renderer 同选中和 delivery block | 创建 Task/调用模型/授予工具 | 只持久化输入 hash/字符数 |
| Web 可访问性 | tabs/listbox/dialog/状态 announcement | IME 快捷键误触、focus escape、长 ID overflow | focus return、200% zoom、forced colors |

## 绩效评估 v2 纵向矩阵

| 层 | 正向 | 负向/边界 | 恢复/证明 |
|---|---|---|---|
| Request/Schema | Request→Dataset→Individual→Report 全部验证 | 旧字段、额外字段、无效 baseline/timeout | docs/package schema 生成一致 |
| Dataset | 完整筛选、稳定排序、同源 artifact/hash | 普通 preset、保留删除、excluded Attempt 注入 | 相同输入重跑同 hash |
| Attempt attribution | Task version/generation/lease 精确窗口 | pre-lease 旧 tool/terminal 泄漏、多源重复 | parent wakeup bounded sender |
| Configuration | exact route + 全 revision 快照 | Flash/Pro、fallback、alias、Tool/Permission 混组 | configuration key 稳定 |
| Difficulty/missing | 预执行特征、原因与机制 | rework 反向抬难度、取消误算模型失败 | coverage/bias notes |
| Metric semantics | Mission/Task/acceptance/handoff/recovery | schema/path/permission 阶段混淆、正常多文件误算 retry | numerator/denominator/Evidence |
| Statistics | Wilson、clustered bootstrap、固定 seed | 0/1 cluster、同 Mission 假独立、宽区间 | deterministic fixture |
| Flash/Pro | 同角色同难度、paired Mission、非劣 | confound、不平衡、硬门被成本抵消 | decision eligible 仍禁止自动晋升 |
| Economics | Accepted Outcome 累计失败/重试 | 未知价格填 0、只算最终成功 | quality-first Pareto |
| Job | durable lease/fence、成功 shard | stale worker、timeout、第 N shard 失败 | 重启只补缺失 shard |
| Narrative | deterministic 默认、严格 aggregate-only JSON | 额外字段、超长数组、调用失败 | deterministic fallback |
| Appeal | finding/Evidence/exclusion/recompute | 原地改 Report、跨 Dataset Attempt、重复提交 | superseding lineage 幂等 |
| Benchmark | 9 场景 sequence/path/receipt/terminal/wakeup | parser revision 样本膨胀、首工具假 PASS | 趋势 >=10；发行 acceptance N>=50 + Wilson + zero safety violations |
| UI | 七视图、目录选择、错误与 retry | 长 model id、无成本、空报告、多报告 | `IDLE/RUNNING→COMPLETED` 自动刷新、键盘、200% zoom、窄视口 |
| Release | exact RC.2 空 Profile install/3 boots | 旧 profile/legacy report JSON | 本机升级、Web 浏览器验收 |

## 0.9.0-alpha.24 编排、全模型与设置保存专项

| 领域 | 正向 | 负向/并发 | 恢复/证明 |
|---|---|---|---|
| 71fe 取证 | 固定 archive hash、2482 JSONL 行、1 次 Mission 调用 | 0 Task、0 spawn、37,362 字符直接实现 | fixture 只作证据，不执行其中指令 |
| General 全流程 | execution intent→Mission→Task→status→spawn | 正文代码/补丁替代、重复无效停止 | Host steer；成功工具重置计数；真实无进展才冻结 |
| continuation/child | “继续”继承未完成义务、child receipt 唤醒 | 已完成 Task 重建、取消后迟到 settlement | terminal state 收敛、既有取消抑制 |
| DSH live catalog | 官方/第三方 exact route 全部 selectable | stale route 目录缺失、长 provider/model | catalog-derived durable capability |
| reasoning adapter | 标准、自定义、无 reasoning 三种 route | unsupported explicit effort | exact/default/preferred/omit 四级翻译 |
| Router | explicit `DEPRECATED`/`off` profile 可执行 | 无候选 route | logical workload 与 wire effort 分离 |
| 角色保存 | provider/model/reasoning/output/context/多行 prompt 同 draft | stale revision、Settings watcher 与 RPC 竞态、NUL 控制字符 | CR/LF/TAB 合法；单次 CAS、串行 projection、权威 revision 回读 |
| React | 第三方模型选择和预算自动收窄 | 五秒 poll 与保存回读竞态、旧 snapshot | revision 单调、dirty 清除、页面/进程重载 |
| 私有技能 | 提炼模型使用 DSH live 目录 | 当前 route 下线 | provider/model 同步保存、缺失路线显式 |

## 0.9.0-alpha.27 执行活性、恢复、Flash 与生产可信度专项

| 领域 | 正向 | 负向/并发 | 恢复/证明 |
|---|---|---|---|
| Workflow correlation | 每条 request 对应 exact obligation/Task | 多 open Task、短“继续”、旧 wake cursor | request hash、唯一 nextTool、重启恢复 |
| Execution lifecycle | Task Version→Attempt→Activation→Dispatch | 三次 Rework、迟到/重复/乱序 settlement | start/heartbeat/settlement；snapshot 不得假 RUNNING |
| Cancellation | Stop 仅当前 Activation；Operations 选择 exact Mission + reason | Task/Mission Cancel、Freeze、Identity termination 混淆；stale/expired preview | Kernel command、state-hash CAS、exact Grant/Budget/Workspace/slot cleanup |
| Radio/Decision | exact Task/Attempt delivery + acknowledge | TTL、dead-letter、双 answer、stale continuation | 新 Attempt resume、parent wake receipt |
| Completion | Candidate→Verified→Integration→Completed | conflict/stale/regression/伪造 parent report | 唯一 Host completion invariant |
| Command Saga | short intent/effect/finalization；standalone write 自动短事务 | async transaction、writer bypass、maintenance misuse、lease loss、effect failure | RETRYABLE/EFFECT_APPLIED restart、one receipt/outbox |
| Outbox | partition order、delivery receipt | duplicate event、expired claim、dead letter | restart offset/retry |
| Workspace | Task-rooted relative read/write/edit | escape、absolute、symlink、forbidden scope | operation status、adopt/quarantine |
| Wave scheduler | dependency + barrier + capacity | unknown dependency、cycle、write conflict | authoritative Wave/Mission events |
| Capability bridge | catalog/protocol/policy/evidence 四轴 | alias、non-native bridge、stale profile | exact immutable dispatch receipt |
| Desired/Applied | 全角色一次收敛 | partial runtime apply、multi-tab CAS | exact field error、retry/rollback |
| Runtime/Web query | 全 parent hierarchy、revision/staleness | stale response、offline、hidden、caller abort | backoff、dedupe、cross-tab invalidation |
| Artifact governance | tenant/workflow/audience/classification | hash guessing、cross-tenant、lower classification | retention/legal hold/deletion/GC/key rotation |
| Evaluation | ratio status + exact pricing snapshot | 0 denominator、missing authority、unknown cost | heartbeat/fence、N/A/INCOMPLETE |
| Production Plane | local + injected provider descriptors | SQLite 冒充 Postgres、local queue/KMS 冒充 distributed | topology fail-closed、capacity/telemetry/signed restore |
| Flash acceptance | N=50、96% first tool、92% E2E fixture PASS；唯一 nextTool/correctedShape | insufficient sample、Wilson lower-bound、secret/path 泄露、任一 safety violation | evidence export + independent offline recomputation |

## 0.9.0-alpha.28 Workbench 无损升级专项

| 领域 | 正向 | 负向/并发 | 恢复/证明 |
|---|---|---|---|
| 精确基线 | stale Desired 匹配 immutable runtime revision | 历史 revision 缺失、Desired 与 claimed runtime 不一致 | fail closed，不猜测、不恢复默认 |
| 内置升级 | 未修改 revision 6 经 package base 前移到 runtime 8 | capability/tool revision 漂移被误判为用户配置 | `PLUGIN_MIGRATION` 历史；Host authority 使用当前 package |
| 用户三方合并 | provider/model/reasoning/budget/concurrency/prompt/status delta 重放 | runtime 当前 head 已保留 delta、同 revision 内容冲突 | 只新增一个必要 revision；否则直接采用 current head |
| 现场拓扑 | General Pro/Max、Engineer 8+两条历史、Worker 10 保持 | 九个旧角色 revision 6、Desired 3/Applied 0 | Workbench 4、Desired=Applied=4、历史 2→11 |
| Legacy mirror | runtime heads 经 Settings CAS 重建 | 旧 profilesJson 回灌、并发修改、reset base | mirror 成功后才 APPLIED；冲突进入 FAILED 可重试 |
| 幂等 | 同文档第二次启动不写模板 | runtime 已成功但 mirror 首次失败 | retry 不重复 revision，attempt 仅失败时增加 |
| 未来升级 | prior plugin migration 不形成 user intent | 新 capability revision 被旧 migration 锁死 | 只解释 USER_SAVE/ROLLBACK/IMPORT 的逐字段 delta |
