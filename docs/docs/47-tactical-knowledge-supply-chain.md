# 私有战术知识供应链

## 1. 目标

从 Session 或用户经验提炼战术不仅是文本摘要，还涉及来源权利、真实性、时效、污染、派生关系和撤回。每个候选必须有 [`TacticalSourceSnapshot`](../schemas/tactical-source-snapshot.schema.json)。

## 2. 来源权利

Snapshot 记录：

- source owner；
- license；
- allowed use；
- allowed audience；
- derivative work；
- retention/revocation policy；
- classification；
- source preset；
- 时间有效性和依赖版本。

`UNKNOWN` license 只允许个人隔离草稿，不允许 Workspace/组织发布。

## 3. 供应链阶段

```text
Authorization
→ Immutable Snapshot
→ Secret/PII scan
→ Prompt-injection isolation
→ Source trust and rights check
→ Extraction
→ Contradiction and temporal validation
→ Reproduction / corroboration
→ User diff review
→ DRAFT
→ Simulation
→ Canary
→ Testing
→ Stable
```

每个阶段都保留 input/output hash、模型、Prompt version、工具和 reviewer。

## 4. 知识投毒防护

不能因为文本来自历史会话就认为正确。检查：

- 是否为模型无证据结论；
- 是否引用真实工具结果；
- 是否仅对旧库版本有效；
- 是否与当前官方 API/内部规范冲突；
- 是否包含恶意“忽略系统指令”；
- 是否把临时 workaround 包装成最佳实践；
- 是否有独立重现；
- 来源是否彼此独立。

模型提取内容与指令通道隔离，来源文本永远是 data，不获得控制权。

## 5. 补充与冲突

新增内容先与已有版本做：

```text
semantic similarity
precondition overlap
contradiction detection
version compatibility
failure-mode comparison
```

结果可能是：

- `NEW_TACTIC`；
- `SUPPLEMENT`；
- `CONFLICTING_VARIANT`；
- `NO_ACTION`；
- `QUARANTINE_EXISTING`。

不能自动覆盖 Stable 版本。

## 6. 撤回

[`KnowledgeRevocationOrder`](../schemas/knowledge-revocation-order.schema.json) 可因：

- owner request；
- license change；
- security incident；
- proven incorrect；
- retention expiry。

执行：

```text
source revoked
→ derive impact graph
→ quarantine affected tactic versions
→ find Guidance and accepted Tasks
→ risk-based revalidation
→ redact reports if necessary
→ notify users
```

历史 Event 不删除；敏感内容通过 Artifact access revoke 和合规 tombstone 处理。

## 7. 派生图

必须支持：

```text
SourceSnapshot
→ ExtractionCandidate
→ TacticVersion
→ Guidance
→ TaskAttempt
→ AcceptedResult
→ TacticalMemory / PerformanceReport
```

任何节点都能反向追踪来源和正向评估影响。

## 8. 发布治理

- 个人 DRAFT：来源 owner 可批准；
- Workspace Canary：Workspace tactical admin；
- 组织 Stable：双人审批 + security/license gate；
- Restricted：指定数据管理员；
- Museum 只能提出版本，不单独发布。

## 9. 时效

战术可配置 `reviewAfter`、dependency range 和 expiry。依赖升级时自动转 `REVIEW_REQUIRED`，不继续以 Stable 自动指导。

## 10. 浏览器透明度

`militaryPrivateSkills/snapshot` 只投影经过 Host 校验和清洗的材料：

- sanitized snapshot 的 hash、media type、长度、截断状态和校验状态；
- redaction/injection receipt；
- 每个 Chunk 的稳定范围、hash、提取状态、尝试次数和 extractor exact route；
- Candidate、review receipt、Skill version、promotion、Usage、继承来源和
  revocation lineage；
- 可投放的公开说明和受限、截断后的预览。

Raw Vault reference、原始 Secret/PII、SQLite 路径和未授权正文不进入浏览器。
Artifact bytes 在投影前重新验证 SHA-256；不匹配时失败关闭。

## 11. 模拟召回

用户可输入一段任务说明和 state token budget 预览召回结果。模拟：

- 不创建 Mission/Task；
- 不调用 Provider；
- 不授予 Tool/Grant；
- 不保存任务原文，只保存 SHA-256 和字符数；
- 与真实 `attachTaskTactics` 使用同一个 tag resolver、lifecycle/rank 规则、
  tenant/source-rights eligibility、候选上限和 applicability-card renderer。

结果包含 exact `skillId@version`、rank、匹配标签、入选原因、被排除版本和原因，
以及真实 Task context 会获得的 exact delivery block。这样可以审计召回而不把
“模拟看起来合理”误当成实际运行证据。

## 12. 验收条件

- 没有来源权利的内容不能组织发布；
- 恶意会话文本不能影响系统指令；
- 错误来源可追踪所有派生使用；
- 撤回后禁止新 Guidance；
- 历史审计仍完整；
- 每个 Stable 战术有重现、Verifier 和 owner；
- 浏览器 projection 不泄漏 Raw Vault 或原始敏感内容；
- 模拟与真实召回对同一 registry/settings/Task 语义产生相同的选中集合、
  排序和 delivery block。
