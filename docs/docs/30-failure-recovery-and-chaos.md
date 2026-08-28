# 失败恢复、幂等与混沌测试

## 1. 恢复模型

`dsh-military` 采用事件驱动 Saga，而不是跨模型、数据库、Git 和工具的分布式事务。

每个有副作用的步骤必须：

- 先建立 intent/lease；
- 执行外部动作；
- 写入可验证 receipt；
- 完成状态迁移；
- 崩溃后可判断“未执行、已执行或未知”。

未知不能被当成成功。

## 2. 关键崩溃窗口

| 窗口 | 恢复 |
|---|---|
| Task lease 后、Agent 创建前 | lease 超时，重新派发 |
| Agent 工具执行后、tool/result 前 | 检查外部幂等键/Artifact；标为 UNKNOWN_EFFECT |
| Candidate 写入后、Verifier 前 | 重启 Verifier |
| Verifier 通过后、accept event 前 | receipt 幂等重放，CAS 接受 |
| Guidance 生成后、投递前 | 按 guidanceId 重投 |
| Guidance 投递后、ack 前 | at-least-once 投递，Worker 去重 |
| specs 文件写后、Git commit 前 | 工兵恢复并验证 change-set |
| Git commit 后、ledger receipt 前 | 通过 commit hash 对账并补记 |
| compaction end 后、evaluation 前 | compactionId 扫描补任务 |
| Tactical version 发布后、catalog invalidation 前 | Provider generation 对账 |

## 3. Agent 崩溃

- 保存 Session 和最后 Agent Status；
- 取消或过期 lease；
- 检查工作区副作用；
- 原 Agent 可冷恢复时仍需重新验证 Task Version；
- 无法证明执行边界时创建 Recovery Task；
- 新 Worker 不继承旧 Worker 的自由文本“完成度”，只继承已记录证据。

## 4. 网络与 Provider 故障

- Radio 与 Ledger 操作使用 bounded retry + idempotency；
- 模型请求错误与任务失败分离；
- API 超时不自动证明未产生副作用；
- Git 远端写只能由 Promotion Order 路径处理；
- 高风险企业 API 使用请求幂等键或 read-after-write 验证。

## 5. 死锁

资源锁使用全局稳定排序：

```text
workspace → repository → path-set → API-resource
```

禁止 Agent 自行持锁跨 Turn。Harness lease 有上限。检测到等待环后：

1. 冻结相关新派发；
2. 取消最低优先级未执行 Task；
3. 保留已产生 Artifact；
4. 参谋重新分解写集合；
5. 记录 deadlock graph。

## 6. 混沌测试矩阵

注入点：

- Ledger append 前/后；
- Artifact 写一半；
- Radio lease 丢失；
- Advisor 超时；
- Worker Session dispose；
- Verifier 进程崩溃；
- Git hook 拒绝；
- 磁盘满；
- DSH HMR 卸载 Adapter；
- Compaction orphan；
- Web Client 断线和乱序；
- stale Task Version 并发提交；
- Credential provider 暂时不可用；
- 工具忽略 cancellation。

每个注入测试验证：

- 不错误接受；
- 不丢失不可变事实；
- 不重复外部副作用；
- 可重放；
- 恢复后权限不扩大；
- 用户可得到明确状态。

## 7. 恢复状态

任务恢复结果只有：

```text
RESUMABLE
REPLACE_AGENT
REVERIFY
UNKNOWN_EFFECT
MANUAL_RECONCILIATION
CANCELLED
```

禁止用模糊的 `FAILED` 隐藏是否发生了副作用。

## 0.2.0 故障注入

- preset 文件在两个新会话创建之间被修改；
- child creation 时 parent preset generation 被删除；
- Host listener 同时接收 Military 和 Standard Session Event；
- Tag 在 extraction Job 中途被 pause/rename/delete；
- source session 在 Candidate 审阅前被追加新事件；
- context threshold 连续跨越，compaction 返回 null；
- pending ask-user 时 General 被取消或 compaction；
- Chief Advice 生成后 Task Version 改变；
- Evaluation Dataset 构建中 Session 被保留策略删除；
- Examiner 第 N 个模板失败，Chair 不应读取未验证分片。

## 0.3.0：新增故障窗口

### Preset generation

- manifest 写入完成但 archive 不完整；
- current 指针更新但 profile 未提交；
- 重启后旧 Session generation 丢失；
- asset hash 与 manifest 不匹配。

处置：内容寻址 temp → fsync → rename；current 指针最后更新；恢复时 quarantine，不回退 current。

### Workspace/Integration

- Worker 完成但 Candidate Patch 未落盘；
- Patch 落盘但 Candidate Event 失败；
- Integration 应用一半；
- Git commit 成功但 Receipt 失败；
- 外部 Session 在集成前修改同一文件。

处置：隔离 worktree、Patch hash、intent、commit trailer、recovery scan、global regression 和 conflict task。

### Decision Broker

- 问题已展示但浏览器断开；
- 两个标签页同时回答；
- 答案提交时 Task Version 已变化；
- General compaction/重启期间问题待定。

处置：durable broker、CAS、first-commit-wins、STALE、resume projection。

### Storage/outbox

- Event 已提交但 projection/outbox 未处理；
- Artifact 文件存在但 metadata 未提交；
- Artifact metadata 已提交但 Reference Index 未提交；
- active/retained Artifact metadata 存在但 Blob 丢失；
- Radio lease holder 崩溃；
- Evaluation dataset 读取中断。

处置：幂等 consumer、checkpoint、metadata-authoritative index rebuild、
orphan sweep、active Blob 完整性 fail-closed、visibility timeout 和 immutable
dataset shard。

### Performance Evaluation

- Request 已入队但进程在 Session discovery 前退出；
- canonical Dataset Artifact 已写、SQLite pointer 尚未提交；
- 第 N 个 exact-configuration shard 失败；
- Job 超过 wall-clock budget；
- lease holder 崩溃后陈旧 worker 继续完成；
- Report 已构建但 Request/Dataset/Schema hash 校验失败；
- appeal resolution 已写、superseding recompute 中断；
- committee model 超时、返回额外字段或无效 Evidence；
- Settings 仍含旧版 `lastReportJson`；
- Provider 价格目录缺失。

处置：

```text
SQLite revision + lease + fence
canonical Frozen Dataset Artifact
idempotent shard key
structured FAILED { code, message, failedAt, retryable }
retry only missing shards
publish only after all invariants
immutable old Report + superseding revision
deterministic narrative fallback
lastReportId pointer; legacy JSON cleared after success
unknown cost = unavailable
```

超时或 retryable failure 不删除 Dataset 和成功 shard。重启执行者重新取得新 fence，
验证已持久化 shard 的 configuration/dataset key，只计算缺失分片。陈旧执行者无法
完成。取消保持 `CANCELLED`；用户取消 Session、Provider failure 和系统 crash 在
Attempt missingness 中分别归因。

### Budget

- reservation 后执行者崩溃；
- usage receipt 重复；
- 价格表缺失；
- 全局与 Mission 余额竞态。

处置：lease expiry、usage id 去重、非货币配额、事务 CAS。

所有故障注入必须得到有限终态：`RECOVERED/PAUSED/QUARANTINED/CANCELLED/FAILED`，不得停留在未知“可能已完成”。

## 0.9.0-alpha.28 Command Saga 恢复合同

Mission command 的外部 operation 具有稳定 idempotency key 和 durable state：

```text
PENDING_EFFECT
├─ effect failure/crash before checkpoint → RETRYABLE
├─ valid active lease                    → wait / RESOURCE_LOCKED
└─ result checkpoint                     → EFFECT_APPLIED → COMMITTED
```

恢复调用必须提交原语义 command；Host 校验 semantic fingerprint、tenant、
Mission、payload hash 和 idempotency key。`EFFECT_APPLIED` 不重跑 effect，
只补 command receipt/outbox；`RETRYABLE` 只能调用同一可查询/幂等 operation。
Operations health 公开 state 计数、过期 lease 和最老年龄，但不显示可能含秘密的
Provider 错误正文，也不会凭 UI 猜测副作用。

故障注入覆盖：

- admission commit 后、effect 前崩溃；
- effect 报错并进入 RETRYABLE；
- effect 成功后、checkpoint 前中止；
- EFFECT_APPLIED 后、receipt/outbox 前崩溃；
- finalization CAS 丢失；
- 同 idempotency key 使用不同 authority/semantic payload；
- async SQLite transaction callback 的同步前缀 rollback。

## 0.9.0-alpha.28 控制中心恢复合同

浏览器恢复流程是三步协议：

```text
authoritative snapshot
→ PREVIEW_RECOVERY(operation, scope)
→ EXECUTE_RECOVERY(operationId, exact confirmation phrase)
```

执行前 Host 重算预览；预览漂移、确认短语错误、operationId 与不同 payload
复用、权限过期或 postcondition 无法证明都会失败关闭。成功/失败 receipt 均写入
SQLite，重启后同 ID 返回原结果。

专项故障注入包括：

- 数据库验证/备份期间取消；
- `VACUUM INTO` 临时目标存在或写失败；
- reconcile 在 Git commit 与 receipt 窗口崩溃；
- stale outbox 重投与正常 consumer 竞态；
- 过期 lease/claim 释放与 live owner 续租竞态；
- 子报告持久化后、父 wake/steer 前崩溃；
- Workspace catalog 生成后 root 被删除、替换或变为 symlink；
- Provider Session 评估读取不完整 event；
- Evaluation 第 N 个分片失败后进程重启，只补缺失分片；
- wall-clock timeout 后保留 Dataset/hash 与已完成分片；
- stale evaluation lease/fence 试图覆盖新 Report；
- committee narrative 返回无效 JSON，确定性报告仍完成；
- appeal recompute 在新 Dataset 与 Report 提交之间崩溃；
- recall simulation 写入前后崩溃。

恢复 UI 只触发这些受治理操作；没有原始 SQL、任意路径删除、Git reset、手工
Task 完成或 capability 状态覆盖入口。

“插件与 Preset”健康项把运行 Bundle 版本与 content-addressed preset
generation 分开显示。相同 preset bytes 可以由后续 Host-only Bundle 继续使用；
generation 的首个归档版本保持不可变，当前性由 archive `current.json` 指针和
exact DSH commit 决定，不能把历史 manifest 中曾经的 `CURRENT` 字样误当作当前
指针，也不能把归档起始版本误显示成正在运行的 Bundle 版本。
