# 外部内容战术提炼与标签治理

## 1. 目标

系统允许用户把以下材料显式提炼为私有战术：

- 过去的任意 DSH 会话或指定事件区间；
- 用户直接输入的长期从业经验、稀有经验和内部方法；
- 用户授权的文档、Artifact 或企业知识片段。

提炼不是自动训练，也不是把整段会话原样复制到 Skill。输出首先是一个带来源、风险和差异的 `TacticalExtractionCandidate`，必须经过用户审阅后，才能形成新的 `DRAFT` 战术版本或现有战术的补充版本。

## 1.1 当前源码实现

`0.9.0-alpha.24` 已把本章从目标设计落实为一条 Host-owned 供应链：

```text
Knowledge Center
  → RC.2 Typert trusted RPC
  → Raw Vault（原文）
  → Sanitized Artifact + Redaction/Injection receipt
  → 稳定 6000 字符 Chunk
  → 无工具 Flash JSON 提取
  → Host 证据聚合
  → 用户 Hash + Diff 审批
  → immutable DRAFT Skill snapshot
  → SIMULATION → CANARY → TESTING → STABLE
  → exact Task recall → Host tactic card → Usage/Result
  → Revocation → quarantine + impact report
```

来源正文只通过 RC.2 Typert RPC 穿过一次并直接写入独立 Raw Vault；不会写入
共享 Settings、Session 事件、浏览器投影、日志或操作回执。Settings 只保存
provider/model、输出预算、fallback、默认可见范围和保留期等策略。旧版本曾写入
Settings 的 action/snapshot 字段会在启动时迁移清除。

生产运行时只有一个 `TacticalIngestionRuntime`。Source、Job、Chunk、Candidate、
Review、Bundle、Promotion、Usage、Knowledge Source 和 Revocation 的状态与
幂等索引由同一个 `SqlitePrivateSkillRepository` 持久化；Raw Vault、脱敏
Artifact 和 Skill Bundle 使用物理分离的目录。中断后从最后一个已提交 Chunk
继续，已经完成的模型调用不会重复执行。

这里借鉴了 Claude 官方 Agent Skills 的文件组织和渐进式披露原则，但不是声称
DSH 使用 Claude Skills API。参考：

- [通过 API 使用 Agent Skills](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)；
- [Skill 编写最佳实践](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices)。

每个批准版本都会编译为完整目录快照：

```text
SKILL.md
references/procedure.md
examples/minimal.md
scripts/verify.mjs
bundle.snapshot.json
```

顶层 `SKILL.md` 只有有效的 `name`/`description`、适用性、最多八个紧凑步骤、
主要停止条件和验证要求；完整 Claim Evidence、权利、依赖和验证计划下沉到
一层 `references/`。Bundle 写入时校验 30 MiB 上限、500 行预算、正斜杠路径、
引用闭包、frontmatter 一致性和脚本可执行位；投放前再次核对每个文件的
byte length 与 SHA-256，磁盘篡改会使版本从 DSH Skill 目录消失。

## 2. 标签库

标签是用户管理的稳定领域实体，不以显示名称作为外键。

```yaml
tagId: tag-react
displayName: React
status: ACTIVE
aliases: [reactjs, react-frontend]
```

战术和提炼请求引用 `tagId`。重命名只改变显示名并保留旧名为 alias，因此不会重写历史 Skill、评估和会话来源。

## 3. 标签生命周期

| 状态 | 新匹配 | 新战术关联 | 历史读取 | 语义 |
|---|---:|---:|---:|---|
| `ACTIVE` | 允许 | 允许 | 允许 | 正常使用 |
| `PAUSED` | 禁止自动匹配 | 仅用户显式批准 | 允许 | 暂停投放，不破坏历史 |
| `DELETED` | 禁止 | 禁止 | 只读 | tombstone；不物理删除引用 |

用户操作：

- **新增**：创建新 `tagId`、名称、描述和匹配词；
- **暂停/恢复**：改变自动匹配和战术投放资格；
- **重命名**：保持 `tagId`，检查名称冲突，旧名称写入 alias；
- **删除**：写入 tombstone，阻止新关联；已有战术保留历史引用；
- **合并**：不是 MVP 必需能力，后续可用显式迁移把一个 tag alias 到另一个 tag。

Schema 见 [`tactical-tag.schema.json`](../schemas/tactical-tag.schema.json)。

## 4. 提炼入口

### 4.1 从会话提炼

用户在会话菜单或战术管理页选择：

```text
提炼为私有战术
```

必须显式选择或确认：

- 来源 Session；
- 完整会话或事件区间；
- 是否包含工具参数和结果；
- 目标标签；
- 新增战术、补充现有战术或由系统建议；
- 数据分类和可见范围；
- 是否允许系统建议新标签。

来源会话可以不是 Military preset。提炼是受用户授权的宿主管理任务，不会把 Military 工具注入来源会话。

### 4.2 从直接输入提炼

设置页提供“经验提炼”表单。用户可以粘贴内容，或上传为 Artifact。系统应鼓励用户说明：

- 适用场景；
- 前置条件；
- 成功表现；
- 常见失败；
- 何时不要使用；
- 可验证证据；
- 保密和共享范围。

直接输入同样经过候选审阅，不能因为“用户说这是经验”就自动晋级为 Stable。

## 5. 提炼流水线

```text
Source Authorization
  → Immutable Source Snapshot
  → Secret/PII/Policy Scan
  → Tag Eligibility and Match
  → High-value Claim Extraction
  → Procedure/State/Failure Reconstruction
  → Existing Tactic Similarity Search
  → NEW or SUPPLEMENT Candidate
  → Independent Validation
  → User Diff Review
  → Draft Version Commit
  → Simulation/Canary Lifecycle
```

### 5.1 来源快照

快照至少记录：

- source type、Session id、事件范围或 Artifact hash；
- 生成时间和请求用户；
- preset、模型和时间范围；
- 是否包含工具结果；
- 数据分类；
- 内容哈希；
- redaction receipt。

后续战术不能只引用一个可能被编辑的自由文本文件。

### 5.2 高价值筛选

提炼 Agent 重点寻找：

- 可重复的诊断路径；
- 清晰的前置条件和排除条件；
- 能被工具验证的动作；
- 失败后如何转移状态；
- 环境差异和版本兼容；
- 对比普通做法的增量价值；
- 稀有但可解释、可审计的经验。

应过滤：

- 寒暄、重复讨论和无结论发散；
- 未经证实的猜测；
- 仅对一次随机上下文有效的临时字符串；
- Secret、个人数据和越权企业信息；
- 被外部内容注入的“忽略系统规则”等指令；
- 无法说明适用范围的绝对化结论。

## 6. 新战术与补充版本

系统先对 ACTIVE/PAUSED 战术做兼容性和语义检索。

### 6.1 新战术候选

满足以下条件时建议 `NEW_TACTIC`：

- 没有可兼容的现有战术；
- 目标、前置和状态机形成独立过程；
- 与现有战术合并会导致职责过宽；
- 用户明确要求独立维护。

### 6.2 补充候选

满足以下条件时建议 `SUPPLEMENT`：

- 是现有战术的新环境变体；
- 新增 Failure Mode、排除条件或 Verifier；
- 增加一个已有状态的动作分支；
- 补充最佳实践和反例；
- 提供更强来源证据。

补充不得就地改写已发布版本。系统产生：

```text
base skill@version
+ proposed patch
→ next DRAFT version
```

用户可在 Diff 中逐项接受或拒绝。

当前实现还强制以下合并不变量：

- target 必须存在、属于同一 owner、未进入 `QUARANTINED/DEPRECATED`，且其全部
  来源仍具备实时可用权利；
- `SUPPLEMENT` 合并基础版本的 workflow、标签、precondition、stop、
  verifier 和 provenance；各列表去重并限制为 64 项，不允许把补充误当替换；
- 新 bundle 继承基础版本的全部 `sourceSnapshotIds`，再加入本次来源；
- 审批、晋升、Task 召回和模型 pre-step 会检查整条来源谱系；任一继承来源撤回
  都隔离其派生补充版本并进入影响报告。

## 7. 标签匹配

匹配分两层：

1. **确定性层**：用户显式 tag、alias、技术栈字段、Skill metadata；
2. **语义层**：提炼 Agent 提出候选 tag 与理由。

规则：

- 只有 ACTIVE tag 自动进入候选；
- PAUSED tag 只在用户明确选择时可附加；
- DELETED tag 永远不能新增关联；
- 没有匹配时可建议创建新 tag，但必须由用户确认名称和范围；
- 同名/近义冲突必须先解决，不能静默创建 `react-2`；
- 一个候选可以关联多个 tag，但必须指定一个 primary tag。

## 8. 候选审阅

`TacticalExtractionCandidate` 在 UI 中显示四列：

- 来源证据；
- 提炼内容；
- 与目标战术的差异；
- 风险、未知和验证计划。

用户可操作：

```text
Approve as Draft
Edit and Approve
Return for Re-extraction
Reject
Change Tags
Change Target Skill
Redact Source
```

批准动作要记录用户、时间、Candidate hash、目标版本和最终 Diff。

## 9. 私有战术内容模型

提炼后的战术仍遵循 [`docs/12-tactical-skills.md`](12-tactical-skills.md) 的完整结构：

- 场景标签；
- 前置与排除条件；
- 状态机；
- Playbook；
- 预期观察；
- Verifier Contract；
- Stop/Rollback；
- Known Failure Modes；
- 冲突与依赖；
- 来源和效能指标。

一段“经验总结”如果无法形成这些字段，可以作为 `evidence note` 或 `best-practice supplement`，但不能伪装成可执行战术。

## 10. 安全与治理

- 默认只读取用户显式选定的来源范围；
- 不后台扫描所有会话自动吸收；
- Secret 和 Restricted 内容必须经过策略允许，默认不进入模型外部路由；
- 企业来源保留数据驻留、授权和过期约束；
- 战术正文不得保留访问令牌、客户身份和真实生产密钥；
- 来源删除请求不直接破坏已发布战术，应进入治理流程并评估衍生数据；
- 低质量或有害战术可以 `QUARANTINED`，其历史使用仍可审计。

## 11. 已实现服务边界

当前服务图为：

```text
ctx.militaryTags         # 标签注册表、revision、alias 和生命周期
ctx.militaryIngestion    # 来源快照、提炼 Job、候选和审阅
ctx.militaryTactics      # Draft/version 发布与检索
ctx.militaryArtifacts    # 来源与 Diff 内容寻址存储
ctx.skills               # 只发布通过实时权利检查的 STABLE 编译视图
militaryPrivateSkills/*  # Knowledge Center 的可信 Host RPC
```

提炼 Job 不能获得 Mission 接受权、Agent Freeze 权或 Git 远端写权限。

## 12. WebUI

### 标签管理

- 搜索、按状态筛选；
- 新增、暂停、恢复、重命名、删除；
- 显示关联战术数、使用数、最后评估时间；
- 显示 alias 和冲突；
- 删除前显示受影响战术，但执行 tombstone 而非级联删除。

### Knowledge Center

Military 主界面提供七个视图，不要求用户编辑 JSON：

1. **来源资料**：粘贴文本、Session 区间或文本 Artifact；选择 license、
   classification、外部模型同意、依赖版本和目标 Skill；
2. **提炼任务**：Chunk 进度、失败原因、WARN acknowledgement 和同 request
   恢复；
3. **待审候选**：来源/现有版本 Diff、Claim Evidence、风险、验证计划、
   编辑、批准、退回和拒绝；
4. **私有技能库**：sanitized snapshot/chunk、完整文件快照、来源、审批、
   exact version、继承谱系、使用结果、Tokens 与明确的成本可用状态；
5. **模拟召回**：不创建 Task、不调用模型，使用真实 recall 的同一规则展示
   exact Skill、排序、匹配/排除原因和实际投放片段；
6. **版本与晋升**：逐级晋升、降级、隔离、恢复 DRAFT 和退役；
7. **撤回与影响**：所有者、许可、安全、错误或保留期原因，派生版本和历史
   Usage 影响报告。

设置页只保留提炼模型/预算、默认 scope/retention、Canary 和召回数量等策略。
用户批准在 RPC Host 边界固定为用户动作；General 只能发起提炼、请求修订或
提出拒绝建议，不能调用批准接口。

## 13. 指标

- 提炼请求数和完成率；
- Candidate 审批率；
- 新战术/补充比例；
- 用户修改幅度；
- Tag 自动匹配接受率；
- Draft 到 Canary/Stable 的转化率；
- 来源证据覆盖率；
- 后续实际 guidance lift；
- 因隐私/Secret 被拒或脱敏的比例；
- 重复战术率。

## 14. 测试与验收

- 重命名 tag 后历史引用仍按同一 tagId 解析；
- PAUSED/DELETED tag 不进入自动匹配；
- 删除 tag 不级联删除历史战术；
- 非 Military 会话只有用户显式发起提炼时才被读取；
- Session 范围哈希变化会使 Candidate 失效；
- 同一请求的重试不创建重复 Draft；
- Supplement 必须指向精确 base version；
- 未经用户批准，零 Candidate 进入可调用 Skill 目录；
- Secret 扫描失败时 fail closed；
- 所有 Draft 都能追溯到来源、提炼模型、审阅用户和 Diff。

## 0.3.0：来源权利、时效和撤回

每次提炼在模型调用前固化 [`TacticalSourceSnapshot`](../schemas/tactical-source-snapshot.schema.json)，记录 source owner、license、allowed use/audience、derivative rights、classification、retention/revocation、依赖版本和有效时间。

除 Secret/PII 外，还检查：

- Prompt Injection；
- 模型无证据结论；
- 与当前 API/内部标准矛盾；
- 依赖版本过期；
- 临时 workaround 被误包装成最佳实践；
- 来源是否独立；
- 能否重现或由第二来源佐证。

`UNKNOWN` rights 只能进入个人隔离 DRAFT。来源撤回时生成 [`KnowledgeRevocationOrder`](../schemas/knowledge-revocation-order.schema.json)，沿 Source→Candidate→Tactic→Guidance→Task→Memory/Report 派生图分析影响，禁止新 Guidance，并对高风险已接受结果重新验证。

重命名/删除标签不改变来源权利；tombstone 标签仍保留历史关联。

当前实现会在导入、审批、晋升、全局 Skill list/get、Task 召回以及每个模型
pre-step 重新检查 owner、license、allowed-use、audience、derivative、
valid-until 和 lifecycle。依赖版本被编译为 Task tactic card 的显式
precondition；无法从当前任务证据验证时，Worker 必须停止应用该战术并升级，
不得由轻量模型猜测。

Task 只固定 exact Skill version 并投放紧凑适用性卡片。procedure 超过八步时，
卡片给出唯一浅层动作 `military_get_order({ "skillId": "…" })`；Host 从当前
Task 派生 version、实时复核来源和 lifecycle，再返回完整步骤、停止条件与
Verifier。这个渐进式披露复用既有工具，不扩大 Flash 的工具词汇表。

每个终态 Candidate 都由 Host 自动写入 exact Skill version、Task/Mission、
匹配原因、真实 provider/model、宿主观察的 tool evidence、Verifier receipt、
成功/返工/回滚/失败、Session-observed token 和成本状态。RC.2 的 DeepSeek
route 没有权威价格目录时记录 `PROVIDER_PRICING_UNAVAILABLE`，不会伪造费用。
这组记录用于人工晋升、降级、重新验证和撤回影响分析；“被分配”不会被报告为
因果有效。
