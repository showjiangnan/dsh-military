# 风险登记册

## 1. 评分

- 影响：1（轻微）～5（灾难性）
- 可能性：1（极低）～5（很高）
- 优先级：影响 × 可能性
- 任何涉及未授权远端写、密钥泄漏、错误接受或账本损坏的风险都视为硬阻断项。

## 2. 主要风险

| ID | 风险 | 影响 | 可能性 | 控制措施 | 责任组件 |
|---|---|---:|---:|---|---|
| R-001 | 模型把猜测写成已确认事实 | 5 | 4 | Candidate 两阶段提交、证据引用、Memory 来源覆盖验证 | Verification / Memory |
| R-002 | “督战 Agent”本身幻觉或漏报 | 4 | 4 | Harness 确定性联锁为主；Inspector 仅补充语义检查 | Oversight |
| R-003 | 任务无限拆小导致协调成本失控 | 4 | 4 | 最小可独立验收单元、上下文交换成本、波次屏障 | Planning |
| R-004 | 任务过大导致轻量模型失败 | 4 | 4 | Complexity Vector、分解阈值、参谋复核、历史指标 | Planning / Staff |
| R-005 | 参谋部成为吞吐瓶颈 | 4 | 3 | 资格路由、领域分片、缓存、预留容量、队列 SLO | Staff / Radio |
| R-006 | 多参谋产生冲突指导 | 4 | 3 | 独立意见后由主责参谋编译单一 Directive，保存异议 | Staff |
| R-007 | 旧指导写回新版本任务 | 5 | 3 | `expectedTaskVersion`、CAS、expiresAt、stale 拒绝 | Radio / Runtime |
| R-008 | Worker 伪造“已调用工具” | 5 | 4 | 工具日志为真源，模型声明只作索引，完成联锁对账 | Oversight |
| R-009 | Worker 越权修改 specs 或 Git | 5 | 3 | Tool Guard、路径策略、专用工兵 Scope、系统 Git Provider | Specs / Git |
| R-010 | 工兵破坏用户已有 Git 历史 | 5 | 2 | 先侦察；不重写；专用 worktree；仅新增 commit；故障回滚 | Git |
| R-011 | 未授权 push/远端分支写入 | 5 | 2 | 默认网络 Git deny；Promotion Order；将军专属工具；用户明确授权 | Git / General |
| R-012 | 企业 API 密钥泄漏到 Prompt/日志 | 5 | 3 | Credential reference、Gateway、响应脱敏、secret schema、日志扫描 | Security |
| R-013 | 企业数据被提示注入操纵 | 5 | 3 | 数据/指令分离、来源信任、工具返回框定、不可执行外部文本 | API Gateway |
| R-014 | Verifier 覆盖不足造成错误接受 | 5 | 4 | Acceptance Coverage、独立回归、人工阻断类别、红队测试 | Verification |
| R-015 | 模型和 Verifier 共享同一错误假设 | 5 | 3 | 确定性工具优先、不同实现/模型交叉检查、负面测试 | Verification |
| R-016 | Tactical Skill 自我强化错误经验 | 5 | 3 | 生命周期门禁、对照样本、置信区间、Canary、回滚、隔离 | Tactics / Museum |
| R-017 | 指标被模型或团队“刷分” | 4 | 3 | 以外置验收和端到端结果为主；禁止用自报完成率 | Metrics |
| R-018 | Compaction 后评估重复执行 | 3 | 3 | compactionId 幂等键、exactly-once ledger transition | Memory |
| R-019 | Memory 摘要遗漏关键风险 | 5 | 3 | 确定性 Tactical Report、来源覆盖检查、风险强制章节 | Memory |
| R-020 | 并发锁死或波次无法退出 | 4 | 3 | 有序锁、租约、deadlock 检测、超时、人工/将军解锁流程 | Runtime |
| R-021 | Worker 数量超过验收能力 | 4 | 4 | workerCount 纳入 Verifier/Advisor capacity，返工预留 | Runtime |
| R-022 | 模型成本和延迟失控 | 4 | 4 | 角色预算、Wave budget、动态 reasoning、停止条件、压缩 | Metrics / Runtime |
| R-023 | DSH API 快速变化 | 4 | 5 | 自有领域契约、薄 Adapter、基线锁定、契约重放 CI | Adapters |
| R-024 | UI 状态与 Ledger 不一致 | 3 | 3 | Durable event projection、revision fencing、重连重放 | Web Client |
| R-025 | “军事化”命名造成组织或伦理误解 | 3 | 3 | 明确软件隐喻；督战无惩罚/胁迫语义；可配置中性显示名 | Product |
| R-026 | 用户输入与主 Agent 解释偏离 | 5 | 3 | Mission Intent 回显、约束/未知项分离、变更命令、用户覆盖权 | General |
| R-027 | 长期存储包含敏感 Artifact | 5 | 3 | 分类、TTL、加密、删除、访问日志、最小保留 | Artifact |
| R-028 | 子 Agent 崩溃后留下孤儿锁/租约 | 4 | 3 | Heartbeat 仅做 liveness、lease timeout、reaper、幂等恢复 | Runtime |
| R-029 | 多工作区合并产生隐藏冲突 | 4 | 3 | 写集合声明、隔离 workspace、集成任务、三方 Diff 验收 | Workspace |
| R-030 | 模型供应商降级或不可用 | 4 | 3 | 路由策略、可审计 fallback、暂停关键任务、不静默降 reasoning | Model Policy |

## 3. 风险处置规则

- `priority >= 16`：进入发布阻断清单；
- 影响 5：即使可能性低，也必须有自动化控制和演练；
- 风险接受必须由明确角色批准并记录到 Decision Ledger；
- 任何控制失败都生成 Incident，而不是只写日志；
- 风险状态在每个 Wave Barrier 重新评估。

## 4. 禁止的“风险控制”

以下做法不能被视为有效控制：

- 仅在 Prompt 中要求“不要撒谎”；
- 让同一个 Worker 自己验收自己；
- 用另一个同质模型的“看起来没问题”替代测试；
- 认为工具可见性等同于权限；
- 用最终自然语言答案替代 Artifact 和事件；
- 让模型决定是否记录其失败；
- 依赖主 Agent 记住所有约束。

## 0.2.0 新增风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Preset 插件误放 Host 全局层 | 普通会话被污染 | standing scope、isolate 检查、prompt/tool snapshot 测试 |
| 同 cwd 锁误拦普通会话 | 破坏默认 DSH 工作流 | Military 锁仅协调绑定 Agent，外部变化只做 drift |
| 历史会话提炼泄漏 Secret | 私有知识污染/泄漏 | 显式来源、分类、redaction、fail closed、用户 Diff |
| Tag rename/delete 破坏引用 | Skill 无法检索 | 稳定 tagId、alias、tombstone |
| 模板热改导致绩效混合 | 归因错误 | immutable revision、实例快照、分组报告 |
| 压缩循环 | 延迟和上下文损坏 | pressure generation、hysteresis、每 Turn attempt 上限 |
| 子代理并发弹窗 | 用户阻塞/错答 | root General 单一所有权、DecisionQuestionSet |
| Chief 建议被当事实 | 错误推进 | GENERATED_REFERENCE、事实/假设分离、Verifier |
| 委员会自评和任务偏差 | 不公平排名 | 独立 examiner、难度分层、小样本保护、数据质量 |

## 0.3.0 新增高优先风险

| 风险 | 影响 | 主要缓解 |
|---|---|---|
| 旧 Session 重启后被挂到新 preset generation | 工具/Prompt/权限历史不可重放 | 内容寻址 archive、Binding、quarantine、migration fixture |
| Schema、TS、Event Payload 漂移 | 不同组件对同一事实解释不同 | Event Catalog 生成、parity、示例全覆盖、CI freshness |
| Worker 共享工作树相互覆盖 | 未验收代码污染、错误验收 | 独立 worktree、Patch Artifact、Integration Queue、global regression |
| 跨会话提炼/评估越权 | 租户或敏感数据泄漏 | Authority Context、source rights、classification、audit |
| Git/Artifact 与 DB 双写失败 | 账本和真实副作用不一致 | intent/outbox/receipt/compensation/recovery scan |
| General 模型切换错误传播到子代理 | 模板评估与权限漂移 | root-role scoped override；child route 冻结 |
| 用户问题并发或旧回答落地 | 错误决策进入新 Task Version | Decision Broker revision、expiry、stale、first-commit-wins |
| 绩效样本偏差与伪精确排名 | 用户做出错误模板决策 | Dataset Manifest、难度校正、区间、双评委、申诉 |
| Thinking Agent 无限循环和过载 | 宿主不稳定、质量下降 | 多级预算、reservation、背压、无信息增益检测 |
| 军事隐喻被理解为现实伤害/人事机制 | 伦理、采用和品牌风险 | 中性术语、明确排除范围、Agent-only Freeze/Evaluation |
| RC.2 外部版本被误判兼容 | 运行时隐性破坏 | release+commit 精确 probe；其他版本不声明支持 |
| 安装/升级覆盖已有 preset 配置 | 用户会话无法启动 | profile revision CAS、完整 config 重述、备份与原子回滚 |
