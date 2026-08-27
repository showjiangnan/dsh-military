# 运行与故障处置手册

## 1. 启动前检查

1. 确认 DSH 版本处于支持矩阵；
2. 运行 Bundle 配置 dump，确认 `dsh-military` 位于基础 Bundle 之后；
3. 验证 Ledger、Artifact、Radio 和 Session persistence；
4. 验证默认模型支持所需 reasoning effort；
5. 执行权限自检：Worker/工兵/参谋/将军工具矩阵；
6. 在临时仓库执行 Git policy 演练；
7. 注册 Verifier，并检查关键任务类型不存在空验收；
8. 检查 Advisor Profile 所引用的技能/API/凭据均可解析；
9. 执行事件重放与 schema 校验；
10. 启动后确认没有 orphan lease、open compaction 或 frozen session。
11. 检查 Command Saga pending/expired effect lease、transactional outbox lag 和
    dead-letter；
12. 分布式部署核对 Ledger、对象存储、队列、KMS descriptor 与探针，任一仍为本地
    实现时保持 `LOCAL_ONLY`。

## 2. Mission 启动

```text
用户输入
→ 将军创建 Mission Intent 草案
→ 项目侦察
→ 用户约束回显
→ 参谋会商
→ Direction 批准
→ 工兵基线（如需要）
→ Wave 进入
```

Mission Intent 中的未知项可有默认假设，但必须标明 `assumption`，不得伪装为用户事实。

## 3. 正常波次运行

- 调度器只租赁 Ready Task；
- Worker 获得 Task Context Packet；
- 每个工具调用进入 Evidence Ledger；
- Agent 只能通过 Candidate 或 Blocker 结束任务；
- Candidate 进入 Verifier；
- Rework 返回原 Task 的新 attempt，不修改冻结验收；
- Wave Barrier 后工兵更新 specs；
- 所有 commit、报告和指标完成后才进入下一 Wave。

## 4. Agent 冻结

### 触发

- 无工具证据却声称完成；
- 修改禁止路径；
- 调用未授权 API；
- 任务版本过期仍继续写；
- 重复无进展循环；
- 输出与 Artifact 明显冲突；
- 工兵 Git 纪律违规；
- 参谋越权访问技能或数据。

### 自动动作

1. 追加 `oversight/freeze-requested`；
2. Harness 将 Agent 状态设为 `FROZEN`；
3. `agent.cancel({kind:'hook'}, {keepInbox:true})`；
4. `agent/pre-step` 拒绝新步骤；
5. Tool Guards 拒绝写调用；
6. 保存最新环境快照；
7. 创建 Inspection Report；
8. 发送参谋部审查任务。

### 解除

只允许：

- 修正命令已形成；
- Task Version 未过期或已重发；
- 权限和环境已修复；
- Harness 追加 `oversight/released`。

如果 Agent 已不可信，替换 Agent，不恢复原会话写权限。

## 5. Radio 堵塞

### 指标

- oldest admissible request age；
- queue depth；
- advisor utilization；
- stale/duplicate ratio；
- dead-letter growth。

### 处置

1. 暂停派发会产生同类阻塞的新 Task；
2. 提升对应领域参谋并发，但不超过技能/API 配额；
3. 合并重复请求；
4. 将缺证据请求退回 Worker；
5. 对战略问题直接升级将军；
6. 超过 SLO 时降低新 Wave 并发。

## 6. Verifier 不可用

- 禁止自动接受；
- Candidate 保持 `VERIFY_PENDING`；
- 可以继续执行无依赖的其他 Task；
- 不能进入依赖该结果的下一 Task；
- 对非关键可配置 Verifier 可使用已批准的替代 Provider；
- 替代行为必须写入事件和 Tactical Report。

## 7. Git 失败

### `git init` 失败

- 工兵停止；
- 保存命令和 stderr Artifact；
- 检查权限、路径和磁盘；
- 不通过删除用户文件“修复”。

### commit 失败

- 保留工作树；
- 不执行 `reset --hard`；
- 生成 Blocker；
- 参谋决定修复 identity、hook 或索引问题。

### 发现已有非 main 默认分支

- 不重命名用户分支；
- 创建受控本地 main worktree 的具体策略由 Git Provider 决定；
- 任何可能重写历史的动作升级将军并要求用户授权。

### 发现远端

工兵仍禁止 push。远端存在不改变权限。

## 8. Compaction 与效能评估

- `compaction/start` 无匹配 `end`：标为 orphan，暂停该 Session 的新评估；
- 成功结束：以 `compactionId` 创建幂等 Evaluation Job；
- Evaluation 失败：重试任务，不回滚 compaction；
- Memory 生成失败：保留确定性 Tactical Report，通知将军“摘要不可用”。

## 9. Ledger 故障

### 写失败

- 不向模型声称状态已改变；
- 当前操作返回明确失败；
- 禁止“先执行后补记”高风险动作。

### Command Saga 或 Outbox 卡住

1. 按 `operationId` 查看 `PENDING_EFFECT/RETRYABLE/EFFECT_APPLIED/COMMITTED`、
   lease owner/fence 和最后 heartbeat；
2. effect lease 未过期时不启动第二执行者；
3. lease 过期后先查询外部 operation receipt/postcondition，再决定补记 checkpoint
   或使用同一 operationId 重投；
4. `EFFECT_APPLIED` 只允许补交领域 receipt + outbox + COMMITTED fence，不重复
   外部副作用；
5. outbox 依据 claim/lease/delivery offset 幂等重投，超过策略后 dead-letter 并
   提升健康告警；
6. 禁止在事务中运行 Git/Provider/文件操作，也禁止手工把 operation 改成
   COMMITTED。

### 投影损坏

1. 锁定 Mission 写；
2. 从不可变事件全量重建；
3. 对比 checksum；
4. 若事件本身损坏，从备份恢复；
5. 记录 Incident 和恢复边界。

## 10. Tactical Skill 回滚

- 将版本标记 `QUARANTINED`；
- 停止新分配；
- 找出所有使用该版本的 Task；
- 对尚未接受结果重新评估；
- 已接受结果按风险决定回归验证；
- 恢复前必须发布新版本，禁止原地篡改。

## 11. 紧急停止

紧急停止顺序：

1. 停止新 Mission 和新 Task lease；
2. 冻结所有写 Agent；
3. 取消活动模型请求；
4. 等待已启动工具达到 quiescence；
5. flush Session、Ledger、Artifact metadata；
6. 释放租约和工作区锁；
7. 生成 Shutdown Report；
8. 不自动执行远端 Git 或破坏性清理。

## 12. 恢复

恢复不等于重启所有 Agent：

1. 重放 Mission Ledger；
2. 识别 `LEASED/EXECUTING` 且 lease 过期的 Task；
3. 检查其工作区和工具副作用；
4. 通过恢复策略决定 resume、replace 或 manual review；
5. stale Agent 结果只可作为证据，不可直接接受；
6. 恢复后先运行 Oversight reconciliation，再继续 Wave。

## 0.2.0 运维操作

### Preset 故障

- roster 显示 broken 时停止创建新 Military 会话；
- 已运行 generation 保持，记录兼容状态；
- 修复文件后只让新会话进入新 generation；
- 不强制迁移正在执行的 Mission。

### Ingestion 事故

- 暂停 Tag 或 Quarantine 受影响 Tactic；
- 保留来源和使用审计；
- 执行 redaction/撤回评估；
- 禁止物理删除掩盖历史使用。

### Evaluation 事故

- 取消 Job 不删除已完成分片；
- retryable failure/timeout 保留 Frozen Dataset 和成功 configuration shard；
- 重启后重新取得 lease/fence，只补缺失 shard；
- dataset hash 改变时创建新 Run，禁止复用旧 shard；
- 错误报告通过申诉/撤回和 superseding revision 处置，不就地改写；
- 权限撤销后关闭 Evidence 下载。

## 0.3.0 运维扩展

### A. 恢复旧 preset generation

1. 暂停该 Session 的模型和写工具；
2. 读取 `MilitarySessionBinding.presetGeneration`；
3. 校验 generation manifest、文件 hash 和 RC.2 commit；
4. 若 generation 等于 current，则 `MATCHED`；
5. 若只是 archive 且进程已重启，根 Session 进入 `QUARANTINED/MIGRATION_REQUIRED`；只有同进程旧 standing scope 或显式受支持 resolver 才可 `ARCHIVE_REBOUND`；
6. 缺失则 `QUARANTINED`，禁止挂 current；
7. 由用户选择执行 Migration Order、创建新 Session 或导出；
8. 记录 `PresetResumeReceipt`。

### B. Integration 卡住

1. 确认 Candidate 已 Accepted 且 source snapshot 未变；
2. 检查 Workspace Lease、local main HEAD 和 external drift；
3. 若仅补丁冲突，生成 `IntegrationConflictReport`；
4. 新建 Conflict Resolution Task，不让原 Worker直接改 main；
5. 重新运行全局回归；
6. commit 后写 `IntegrationReceipt`；
7. 若 Git 成功而 Ledger 失败，恢复扫描按 commit trailer/idempotency 补 receipt。

### C. Decision 无人回答

1. 查看 Broker 状态和 expiry；
2. 确认根 General 仍存活；
3. 检查是否已被其他标签页回答；
4. 到期后执行配置的 `PAUSE/DEFAULT/ESCALATE`，高风险禁止默认；
5. Task Version 变化则标记 `STALE`；
6. 用户恢复时创建新问题，不复用旧 revision。

### D. 预算耗尽

1. 停止新 reservation；
2. 取消未开始的推测任务；
3. 保留已产生 Candidate/Evidence；
4. 生成 `PAUSE_AND_REPORT`；
5. 展示已用/预留/预计完成差额；
6. 用户追加时生成 Authorization Receipt 和 Change Order；
7. 不关闭 Thinking、Verifier 或安全 Guard。

### E. Compatibility Probe 失败

- 关键 seam 缺失：停止 Military admission；
- 只读能力可用：允许历史导出，不运行 Agent；
- Standard Session 保持默认 DSH 流程；
- 保存 probe report 与版本；
- 恢复组件后重新探测，不能手工篡改状态为 READY。

### F. 安装/升级/卸载

遵循[Bundle 生命周期](46-install-upgrade-rollback-uninstall.md)。任何 profile 写入先备份和 revision CAS；卸载前枚举未完成 Mission、generation、战术、报告、Artifact 和 legal hold。

### G. 使用“Military-安全与恢复”

1. 先刷新健康快照，确认 SQLite/WAL、Preset/Bundle、Mission/Task、child、
   worktree、Grant、outbox 和 receipt 的时间；
2. 选中异常对象并查看 Session 诊断时间线；确认原始模型选择、Schema、Host
   补全、路径、执行和终态 receipt 的断点；
3. 选择恢复动作，只生成预览；
4. 阅读 operation scope、影响、风险和不会发生的副作用；
5. 复制预览生成的精确确认短语，再执行；
6. 保存返回的 `operationId` 和 receipt；网络中断时只用同一 ID 重试；
7. 刷新权威状态，不能以按钮成功提示代替 postcondition。

显式取消整条 Mission 时：

1. 在 Mission 下拉框中选择目标并核对标题、状态、revision 和更新时间；
2. 填写可审计原因，生成 `CANCEL_MISSION` 预览；
3. 核对 CAS diff、影响范围和“停止全部未终态 Task、释放 child 资源”的警告；
4. 在预览过期前输入精确高风险确认短语并执行；
5. 从 receipt 核验 Kernel cancellation reference 和已清理 child 数；
6. 若预览后 state hash 改变，丢弃旧预览并重新生成；若网络中断，先刷新 receipt
   与 Mission 状态，禁止把 Stop、Freeze 或手工终态当作 Mission Cancel。

允许的操作只有数据库验证、`VACUUM INTO` 一致备份、reconcile、stale outbox
重投、已证明过期资源释放、父级唤醒和上述受治理 Mission Cancel。不存在编辑
SQLite、删除任意 worktree、手工标记 Task 完成或覆盖终态。

### H. Specs 路径或写入异常

1. 在“Military-Specs 工作区”选择发生问题的 Session workspace；
2. 对照 canonical root/hash、Git HEAD/tree、dirty/untracked 和路径授权树；
3. 查看 Task lease、worktree、Candidate 和 integration receipt；
4. 若工作区不在目录中，先修复 Session binding，不要在浏览器粘贴绝对路径；
5. 对 `FORBIDDEN/UNSCOPED` 路径按 Task/Permission 修订重新派遣，不手工扩大
   Grant；
6. 若 Git 已提交但 receipt 缺失，使用受治理 `RECONCILE`；
7. 未提交或验证失败时保持零部分 Specs 状态，由原 operation ID 恢复。

RC.2 当前没有外部目录 picker；`workspaceId` 是唯一选择输入。插件源码目录、
其他 Session workspace 和 symlink escape 必须保持不可选。

### I. Flash 工具错误评估

1. 先运行固定九场景 deterministic gate，确认 dataset hash；
2. 从可评估 Session 中选择 exact provider/model 的真实样本；
3. 分别检查 General、Worker、Engineer、Staff 的首调用、Schema、纠正、终态、
   写 receipt 和父级唤醒；
4. 不把 deterministic PASS 记为 Provider PASS；
5. 不把 alias 名称当 exact route；
6. 相同 exact configuration/场景按 dataset + Session + scenario 去重；独立
   Session 少于 50 时保持 `INSUFFICIENT_SAMPLE`；
7. 失败样本导出 Session/Host evidence 后进入回归，不通过手工修改 capability
   为 `VALIDATED`。
8. 导出后运行
   `npm run acceptance:flash -- --input <export.json>`；全部场景必须同时满足首次
   工具命中估计≥95%且 Wilson 下界≥85%、E2E≥90%且下界≥80%，并且意外确定性
   失败/越权成功写/假完成/重复终态均为 0。
9. 每次失败只按 envelope 中唯一 `nextTool` 和 `correctedShape` 修正；若错误
   details 出现 secret、Bearer token 或宿主绝对路径，立即按安全缺陷阻断发布。

### L. 生产 Provider readiness 或灾备异常

1. 查看 Operations Center 的 provider topology、capacity/backpressure、
   backup signature 与 restore drill receipt；
2. descriptor、probe 或 residency 不一致时停止分布式 admission，保留本地只读
   诊断，不自动 fallback 到无同等策略的存储；
3. 验证备份清单、内容 hash、签名 key id 和 legal-hold index 后再恢复；
4. 恢复到隔离目标，重放 Ledger/outbox，比较 canonical projection 和 Workspace
   receipt，完成后生成 restore receipt；
5. 未完成 PostgreSQL/对象存储/队列/KMS 适配器注入和演练的部署只能标记
   `LOCAL_ONLY`，不能报告 HA READY。

### J. 私有技能召回异常

1. 在 Knowledge Center 查看 sanitized snapshot、redaction/injection receipt
   和 Chunk/extraction 状态；
2. 沿 Candidate→review→version→promotion→Usage→revocation lineage 定位；
3. 使用同一任务文本运行“模拟召回”，核对入选/排除原因和 exact delivery
   block；
4. 确认 Skill lifecycle、owner/license/scope、retention、dependency 和来源
   撤回状态；
5. 模拟不会创建 Task；若模拟与实际投放不同，应以 registry/settings/Task
   版本和 Host context manifest 对账；
6. 禁止把 Raw Vault 原文复制到诊断或浏览器日志。

### K. 绩效评估 Job、报告或申诉异常

1. 在“Military-绩效评估 → 历史/申诉”确认 Job state、failure code、
   `evaluationRequestId`、dataset hash 和最后成功 shard；
2. `FAILED` 且 `retryable=true` 时使用“从冻结分片重试”；不要重新扫描或删除
   SQLite 行；
3. 若失败原因是 Dataset Artifact/hash/Schema 不一致，停止重试，保留 Artifact
   并重新发起新 Request；
4. 对 stale lease/fence 冲突，确认旧进程退出并让新 owner 续租；不能手工覆盖
   revision；
5. committee model 失败应自动回退确定性叙述；若指标也变化，按数据完整性事故处理；
6. 价格目录缺失只影响 cost，UI 必须显示 unavailable，不能补 0；
7. 报告样本错误时提交绑定固定 finding/Evidence 的申诉；成立后由
   `RECOMPUTE_AND_SUPERSEDE` 产生新 Dataset/Report；
8. 核对旧 Report Artifact digest 未变、新 Report 的 `supersedesReportId`、
   unique Attempt/Mission、区间和 decision 差异；
9. 即使新报告 `DECISION_ELIGIBLE`，仍不得直接修改默认模型；另走显式 Canary/
   Active 治理 receipt。
