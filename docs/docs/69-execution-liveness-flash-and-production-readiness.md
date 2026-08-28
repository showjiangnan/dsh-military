# 执行活性、Flash 外部验收与生产可信度

## 1. 本轮闭环的目标

本章记录 `0.9.0-alpha.28` 对执行活性、状态机、恢复、轻量模型、WebUI、安全、
评测和生产 Provider 的纵向收敛。它补充并在冲突处取代第 60—68 章中仍以
Session/Task 粗粒度描述的部分。

完成标准不是“新增类型或页面”，而是同一条请求从 Host admission 到最终
Integration/Completion 的每一个权威转移都有：

- 唯一 aggregate 身份和 version/fence；
- durable start、heartbeat、settlement 或 operation receipt；
- 崩溃后的明确恢复状态；
- Web projection 的来源 revision 与陈旧度；
- deterministic test 与真实 Provider evidence 的清晰边界。

## 2. 执行层级与唯一关联

### 2.1 权威层级

```text
User Request
  └─ WorkflowObligation
      └─ Mission
          └─ Direction
              └─ Wave
                  └─ Task Version
                      ├─ Attempt
                      │   └─ Activation
                      │       └─ Dispatch
                      ├─ CandidateSubmission
                      │   ├─ CandidatePatch
                      │   └─ Verification
                      └─ IntegrationOrder → IntegrationReceipt
```

`WorkflowObligation` 是一条执行型用户消息的 Host-owned 义务。它保存 request
hash、Mission/Direction/Wave/Task 关联、当前 stage、唯一 `nextTool` 和
wake cursor。General 不再扫描 Mission 中任意 open Task 推测“继续”对应什么。

`Task Version` 只在 objective、scope、acceptance、environment、dependency
或权限发生实质修改时递增。初次执行、Rework、收到 Guidance、收到 Decision
Answer 都创建新的 Attempt/Activation/Dispatch，不复用已经 settlement 的
Session Snapshot。

### 2.2 活性证明

| 观察 | 可以证明 | 不可以证明 |
|---|---|---|
| Session Snapshot 存在 | 历史 Session 可检查 | 当前仍在运行 |
| Dispatch receipt | Host 已发出 exact payload | 子进程已开始 |
| durable start receipt | exact Activation 已启动 | lease 永不过期 |
| heartbeat receipt | 截至该时间仍有活性 | Task 已完成 |
| settlement receipt | exact Activation 已收敛 | Task 必然成功 |
| Completion receipt | Host invariant 已满足 | 模型正文的自行声明 |

只有未过期 start/heartbeat 能投影 `RUNNING`。缺少证明、identity drift、过期
lease 或 snapshot/ledger 不一致时投影 `RECOVERY_REQUIRED`，而不是假
`RUNNING`。

## 3. settlement、取消、终止与恢复

child dispose 只结算对应 Activation，并释放 exact Capability Grant、预算、
Workspace lease 和并发 reservation。它不得把 `BLOCKED`、`REWORK`、
`FROZEN`、`AWAITING_GUIDANCE` 或 `AWAITING_DECISION` 无条件改回 `READY`。
即使 Staff/Advisor 没有 Workspace，只要 execution binding 存在，也必须结算
Attempt/Activation/Dispatch。清理会尝试所有资源并汇总失败组件；任何一项
未收敛都返回可重试的 `PERSISTENCE_FAILED`，不能用吞掉异常的方式伪造成功。
Mission 已先行取消 Task 时不再重复释放 Task lease；重复 child disposal 先读取
已有 `task/activation-settled` receipt，因此换一个 teardown 原因也不会二次
修改 Task。

同一 `dispatchKey + payloadHash` 才能重放原记录；不同 dispatch key 即使
payload 相同，也代表新的受治理意图，在旧 Dispatch 仍活跃时必须返回
`RESOURCE_LOCKED`。同状态 Dispatch receipt 只有 transport 字段完全一致时
才是只读重放，不得再次增加 heartbeat 或改写时间。Activation/Attempt 的
`SETTLED` 只能从已启动状态进入；`LOST` 同时记录 `settledAt` 与稳定原因。

取消语义分开：

- 用户 Stop：取消当前 Invocation/Activation；
- Task Cancel：显式终止一个 Task；
- Mission Cancel：显式终止整条 Mission；
- Freeze：保持证据并禁止继续执行；
- Identity Termination：只用于明确的稳定身份处置。

step、wall-clock 或 no-progress 耗尽进入可恢复失败/升级路径，不永久终止
General。迟到、重复、乱序 settlement 由 Activation version 和 idempotency
fence 收敛。显式用户取消不会被 parent wakeup 复活；自然停止的父 General
会在关键子 receipt 到达后由 RC.2 next-step 唤醒。

Operations Center 的 Mission Cancel 是高风险受治理操作，不是一个前端状态
切换。用户必须选择仍存在的 Mission、填写原因、预览影响范围，在预览未过期且
权威 state hash 未变化时输入精确确认短语。Host 以本地 DSH Web principal
通过 Mission Kernel 提交 command；成功后取消所有未终态 Task、失效
Radio/Decision，并按 persisted/live child binding 释放 Grant、预算、并发
reservation、capacity 和 Workspace lease。operation receipt 与 Mission
cancellation receipt 都使用稳定幂等键；网络中断后可查询或以新的受治理预览
收敛，不能通过重放按钮制造第二个终态。

## 4. Radio、Decision、Blocker 与 Rework

### 4.1 Radio

一个 blocker 命令原子关联 Blocker Evidence、Task version、Attempt、
`AWAITING_GUIDANCE`、Radio queue 和 parent receipt。Advisor lease 具有 TTL、
重试次数和 dead-letter。Guidance 投递给 exact Attempt；若原 Attempt 已结算，
Host 创建 continuation Attempt。Worker acknowledge 后才恢复 `RUNNING`。

过期或 exhausted guidance 不伪装为成功，Task 明确升级 `BLOCKED`。

### 4.2 Decision

Question Set 同时绑定 Task 与 Attempt。只有 root General 能按序展示给用户；
第一份合法 answer 胜出，重复答案幂等。Answer 先 durable delivery，Worker
acknowledge 后 Task 才恢复。TTL reconciliation 产生 expired outcome，不猜测
用户答案。

### 4.3 Rework

Verification 或 Integration 的 `REWORK`、`CONFLICT`、`STALE`、
`REGRESSION_FAILED` 都产生新 continuation Attempt 和独立 Dispatch。旧
Activation、旧 Snapshot、旧预算与旧授权不复用。

## 5. Candidate、Verification、Specs 与 Integration

Task 写路径的成功链固定为：

```text
RUNNING
→ CANDIDATE_SUBMITTED
→ VERIFYING
→ VERIFIED
→ INTEGRATION_PENDING
→ INTEGRATING
→ COMPLETED
```

Verification `ACCEPTED` 只是“候选已验证”，不是 Task 终态。Integration 必须
验证 expected head/tree、patch lineage、回归和 local-main policy；只有
`APPLIED` receipt 能推进 Completion。`CONFLICT`、`STALE` 和
`REGRESSION_FAILED` 进入 Rework/Blocked/Failed，不保留成功终态。

Engineer 的 `military_specs_apply_order` 是一个浅层模型合同和完整 Host 事务：
模型只提交相对路径与最终内容；Host 先验证完整计划，再原子 materialize、验证、
本地提交、记录 Candidate/Evidence/Verification/Integration/Completion receipt
并通知父级。成功后同轮 terminal latch 阻止后续调用。

Completion 由共享 reducer 的唯一 invariant 判定。模型正文、parent report、
Session `turn/end` 或 UI 按钮都不能自行宣布完成。

## 6. SQLite Command Saga 与 Outbox

SQLite transaction callback 被结构性限制为同步函数。返回 Promise/thenable
会 rollback 并报错，防止连接写锁跨 LLM、Git、文件系统、Provider 或长验证。
公开数据库句柄上的 standalone `statement.run()` 和 `exec()` 写入也自动包裹在
短 `BEGIN IMMEDIATE` 事务内，因此调用方不能绕过统一 writer。只有 SQLite
禁止放入领域事务的启动 PRAGMA 和 `VACUUM` 可通过显式 `maintenance()` 边界
运行；该边界不得承载领域数据写入。

Execution Lifecycle Provider 在短事务外计算纯状态转移，并用 storage revision
CAS 提交。多个进程或 Coordinator 同时争用同一 Workflow/Task 时，Host 只对
`REVISION_CONFLICT` 做最多三次有界重读与重算：相同
`dispatchKey + payloadHash` 收敛为 recovered replay，不同 dispatch key
收敛为 `RESOURCE_LOCKED`，expected-revision 或领域冲突在重试后仍原样失败。
因此持久化竞争不会泄漏成偶发工具错误，也不会借重试放宽幂等身份。

Command Saga 使用：

```text
short tx: admission + PENDING_EFFECT lease
outside tx: idempotent/queryable external operation
short tx: EFFECT_APPLIED + durable result
short tx: command receipt + outbox + COMMITTED
```

失败 effect 进入 `RETRYABLE`，保留 admission 与领域事实。相同 idempotency key
可在重启后恢复；`EFFECT_APPLIED` 只补 finalization，不重复外部副作用。Operations
Center 显示 pending、过期 lease、RETRYABLE、EFFECT_APPLIED 和最老年龄。

transactional outbox 具有 claim、lease、retry、指数 backoff、dead-letter、
delivery receipt 和 partition offset。Tool evidence/budget settlement 即使
post hook 抛错也通过 `Promise.allSettled` 和 outbox 补偿，避免“副作用成功但
返回失败后重复执行”。

## 7. Workspace、Wave 与重启恢复

Workspace Snapshot、Lease、Candidate Patch、Integration Order/Receipt 使用
唯一生产 Store。启动 reconciliation 会发现并分类现有 worktree：可证明归属的
收养，可证明过期的隔离，未知状态停止并要求人工核验；不会先递归删除。

Mission Scheduler 校验 DAG、未知依赖、cycle、write scope conflict、Wave
barrier、scope lock、预算和 capacity。只有依赖完成且 Wave active 的 Task
才能 dispatch。Direction/Wave 事件和 Mission completion/cancellation 都是
权威事件；Trajectory、Evaluation 与 WebUI 不用默认值补写。

## 8. Flash-first 工具协议

Worker/Engineer 只看到当前 phase 所需的 1—4 个核心动作和少量恢复动作；
固定 ToolProfile 仍是权限上限。文件操作统一为：

- `military_workspace_read`
- `military_workspace_list`
- `military_workspace_search`
- `military_workspace_write`
- `military_workspace_edit`
- `military_workspace_operation_status`

模型只传 Task 相对路径。Host 把路径绑定到 lease-owned execution root，执行
canonical authorization、symlink/escape/forbidden scope 检查并生成 receipt。
超时后模型先查询 operation status，不直接重复写入。

Task Create 与 Specs Apply 都是浅层 draft；Task key、Direction/Wave、版本、
scope、budget、stop/escalation、operation ID、hash 和时间由 Host 编译。
Military 自有错误 envelope 固定包含稳定 code/message、retryable、唯一
`nextTool` 和从当前 installed RC.2 schema 求得的 `correctedShape`；
secret-like 字段、Bearer token、宿主绝对路径和无界 details 在进入模型上下文
前被删除或脱敏；
完全相同的无效参数被签名阻断。终态成功后同一 assistant response 的其他调用
不会执行。

## 9. 模型目录、Desired/Applied 与 Dispatch receipt

模型能力分为四个独立轴：

1. Catalog Presence；
2. Protocol Compatibility；
3. Policy Eligibility；
4. Performance Evidence。

所有 DSH live route 可见并可选择，未评测不阻断显式使用，也不伪造 tool
calling、reasoning、context、residency 或 `VALIDATED`。native tool route
直接执行；非 native route 只有已启用并通过 canary 的 Bridge 才可执行。
Dispatch 前校验 exact provider/model/adapter/capability profile，并写
provider、model、classification、residency、redaction、policy revision 和
pricing snapshot receipt。

内置策略同样遵守不可变 revision。`alpha.27` 把 Pro capability 从 revision 1
推进到 2、Flash 从 3 推进到 4，并把引用新 Flash capability 的部门模板从 7
推进到 8。真实 `alpha.24` 数据库中的未定制模板仍位于 revision 6，因此启动
必须先追加精确的 revision 7 资产，再追加 revision 8；已经高于或等于内置版本
的用户修订保持不变。升级只追加连续新记录，旧 revision 继续服务已固定的历史
Session；启动不得以相同 revision 覆写新增 capability axes，不得跳过模板
revision，也不得通过删除 SQLite 数据规避冲突。

角色设置一次保存完整 Desired revision。Reconciler 对 General 和全部部门
校验/应用，全部成功才推进 Applied revision。UI 只有
`desiredRevision == appliedRevision` 才显示已生效；失败显示 exact role/field，
可重试或回滚，不产生部分应用。

## 10. Runtime Center 与 Web 查询层

独立 Runtime Center 展示 Request 到 Integration 的权威层级以及 Radio、
Decision、Budget、Receipt。每个 snapshot 包含：

- `sourceRevision`；
- `generation`；
- `generatedAt`；
- `staleAfter`；
- health/staleness。

共享 query layer 统一 timeout、Abort、同读去重、mutation 不去重、visibility/
offline backoff、revision fence 和 multi-tab invalidation。相同或更旧 revision
不能覆盖新数据；dirty draft 和历史报告选择不被 polling 重置。跨标签页只广播
service scope 失效通知，不广播敏感正文。

Web adapter 只组合 RC.2 primitive 与 `--dsw-*` token。Settings、Runtime、
Knowledge、Evaluation、Operations 是独立 feature slice，并保留 focus restore、
inert/visibility、200% zoom、forced colors、reduced motion、长 model ID 和中文
IME 合同。

## 11. Principal、Artifact 与数据治理

Web Remote 从 Host 的 DSH principal/tenant authority context 鉴权；本地单用户
模式使用明确的 local principal boundary，不把常量 `web-user` 冒充多租户认证。

Content Blob 与 Artifact Reference 分离。Reference 绑定 tenant、workflow/
Mission/Task、classification、owner/audience、scope、expiry 和 grant；知道
content hash 不获得读取权限。同内容多来源按最高 classification 合并。

restricted/raw 数据支持加密、持久 Ed25519 签名/KMS seam、密钥轮换、retention、
legal hold、lineage、deletion receipt 和 orphan GC。模型 dispatch 使用真实上下文
分类，不硬编码 `internal`。

## 12. Evaluation 与真实 Flash 发行门

Evaluation ratio 保留 numerator、denominator 和 status；零分母是 `N/A`，缺失
权威事件是 `INCOMPLETE`，都不伪装成 0。长 narrative/provider shard 使用
heartbeat 和 lease fence。成本必须来自 exact route/version price snapshot；
未知成本不进入 Pareto。

固定 `military-flash-core-v1` 九场景 deterministic gate 不调用模型、不收费，
只证明 Host/Schema/路径/状态合同。真实 Provider 样本必须来自 immutable
Session event 和 Host-observed receipt。发行门逐 exact configuration × scenario
执行：

| 指标 | 要求 |
|---|---:|
| 独立 Session | `N ≥ 50` |
| 首次工具命中 | 点估计 `≥ 95%`，95% Wilson 下界 `≥ 85%` |
| E2E 完成 | 点估计 `≥ 90%`，95% Wilson 下界 `≥ 80%` |
| 意外确定性错误 | `0` |
| 越权写入 | `0` |
| 假完成 | `0` |
| 重复终态 | `0` |

UI 可导出证据。离线发行门：

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route deepseek-official/deepseek-v4-flash
```

若同场景有多个 configuration，必须再提供冻结的 selection JSON。仓库门禁不会
发起数百次付费调用；没有足够真实样本时准确返回 `INSUFFICIENT_SAMPLE`，不能
写成“Flash 已通过”。

## 13. Production Plane 与灾备

核心应用依赖可替换的 Ledger、Artifact Store、Durable Queue、KMS、Telemetry、
Capacity 和 Backup 接口。SQLite、本地 Artifact 与事务 outbox 是
`LOCAL_SINGLE_NODE` 实现。外部 PostgreSQL、对象存储、queue、KMS adapter
通过 composition root 注入 exact live instance。

distributed readiness 会拒绝：

- 用 SQLite descriptor 冒充 PostgreSQL；
- 用本地目录冒充对象存储；
- 用进程内队列冒充外部 durable queue；
- 用 ephemeral signer 冒充 KMS；
- 未声明 tenant isolation、durability、residency 或 multi-region deployment。

Operations Center 汇总 correlated trace/metric/log、outbox lag、Radio oldest
age、expired lease、Command Saga drift、capacity saturation、provider health、
签名备份和隔离 restore drill。它只报告观测事实，不把接口存在等同于生产部署。

## 14. 验证矩阵

本轮新增纵向回归覆盖：

- 多 open Task 请求关联与三次 Rework 的独立 execution aggregate；
- Radio/Decision TTL、delivery、acknowledge 和 resume；
- Candidate→Verification→Integration→Completion 与冲突/陈旧/回归失败；
- Stop、自然父停、迟到 settlement 和重启恢复；
- SQLite 同步事务约束、Command Saga crash window 和 CAS；
- Outbox ordering/retry/dead-letter/offset；
- Wave dependency/barrier；
- Workspace wrapper 路径、symlink、operation status 和幂等；
- Runtime Center 全层级 parent link；
- Web query timeout/abort/dedupe/revision/multi-tab；
- Artifact ACL/retention/legal hold/key rotation/GC；
- production queue、provider topology、capacity、telemetry 和签名恢复；
- Flash N=50/Wilson/零安全失败发行门算法。

真实外部 Flash acceptance 是部署证据，不由 deterministic fixture 伪造。源码
发行可以在该证据尚不足时完成，但发布说明必须明确其状态，生产推广必须再通过
上述外部门。
