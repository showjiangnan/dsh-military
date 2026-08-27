# 安全、权限与企业数据

## 1. 权限维度

权限不能用一个 `role=advisor` 概括，至少分为：

- 模型 Provider 与数据驻留；
- Tool；
- 文件 read/write/forbidden paths；
- Workspace/Sandbox；
- Enterprise API grant；
- Credential reference；
- Tactical Skill scope；
- Data classification ceiling；
- Agent creation；
- Accept/Freeze；
- Specs/Git；
- 用户授权动作。

## 2. 最小权限

- 每个 Task/Advisor 只获得完成职责所需权限；
- 描述、Prompt、Skill 不能授予权限；
- 权限不可由 Agent 转授给兄弟 Agent；
- Broker 在每次投递/调用时重新授权；
- Tool Guard 是服务端强制，不只是 Tool filter。

## 3. Enterprise API Gateway

参谋访问内部 API 必须经 Gateway：

```text
Advisor Identity
→ API Grant
→ method/resource/classification/rate check
→ credential resolution
→ request
→ response size/type validation
→ redaction
→ untrusted-data framing
→ Artifact/Event
→ model-visible projection
```

原始 secret 不进入模型、Session、Ledger 或 UI。

## 4. Prompt Injection

仓库、网页、API 和 Artifact 中的文本均视为数据。控制：

- 标记来源和信任等级；
- 系统命令与数据分段；
- 不执行数据中的工具/权限指令；
- 高权限动作必须是领域 Command；
- 对代码注释/网页中的“忽略规则”不赋予权威；
- 关键事实交叉验证；
- 输出和日志扫描。

## 5. Confused Deputy

Worker 不可通过 Radio 让 Advisor 执行自己无权执行的副作用。Advisor 可读取授权企业数据并给出指导，但不能把 credential、原始敏感数据或新权限传给 Worker。

## 6. Git 安全

- 工兵 local-only main；
- 任意 remote write 默认 deny；
- Promotion Order 限定 source commit、目标、action、expiry；
- 网络 Git 工具仅 General Scope 可见且仍需授权；
- 禁止 history rewrite；
- Git receipt 进入 Ledger；
- commit 前 secret scan 和 allowlisted path 校验。

## 7. Agent/Tool 隔离

- Worker 无 subagent creation；
- Inspector read-only；
- Research 只读 accepted projection；
- Advisor 不直接写项目；
- Engineer 不使用任意 Git shell；
- Frozen Agent 的 `pre-step` 和 write guards fail closed；
- 外部工具支持 cancellation、timeout 和副作用对账。

## 8. 数据分类

```text
public < internal < confidential < restricted
```

Agent/Model/API/Artifact 各有 classification ceiling。路由到外部模型前检查数据驻留和允许分类；禁止静默 fallback 导致敏感数据出境。

## 9. Tactical Supply Chain

- 战术有来源、作者、版本和不可变内容；
- 进入 Registry 前 schema、安全和注入检查；
- Canary 最小权限；
- 异常版本可快速 QUARANTINED；
- 找出所有使用任务并回归；
- 不从不可信 Mission 自动复制为 STABLE。

## 10. 审计

记录：

- 谁/哪个 Agent 发起；
- 有效权限和模型；
- 请求、事件和 Artifact ID；
- 用户授权；
- API/Git/Tool receipt；
- Freeze/Release；
- Tactical version；
- 数据分类和脱敏政策。

## 11. 紧急控制

- 停止新 lease；
- 冻结所有写 Agent；
- 取消模型请求；
- 撤销 API/credential grants；
- 隔离战术；
- 禁止 remote action；
- flush durable state；
- 向用户呈现已确认影响和未知副作用。

## 0.2.0 安全扩展

- `military` preset 是模型能力边界；Host admin RPC 另行授权；
- 标签和模板写入使用 revision fencing；
- 历史会话提炼需要明确来源范围、用途、分类和 redaction；
- Evaluation 跨会话读取需要独立权限并只纳入 actual Military Session；
- Chief/Examiner/Extraction Agent 无 Mission 接受、Freeze、Git 或任意 Session 浏览权；
- 普通会话外部修改同一工作区时，Military 只能检测 drift，不能取消或冻结它；
- 报告和战术不得泄漏原始 Secret、用户身份或 Restricted Tool Result。

## 0.3.0：Authority Context 与版本化 Policy

所有管理面和跨会话操作必须解析 [`AuthorityContext`](../schemas/authority-context.schema.json)，至少包含 principal、tenant、role/scope、Workspace membership、Session ownership、数据分类上限和授权 receipt。`sessionId`、`cwd` 或 Agent 自报身份不能授予权限。

以下一级对象必须版本化并可撤销：

- [`ToolProfile`](../schemas/tool-profile.schema.json)；
- [`PermissionProfile`](../schemas/permission-profile.schema.json)；
- [`EnterpriseApiGrant`](../schemas/enterprise-api-grant.schema.json)；
- [`DataResidencyPolicy`](../schemas/data-residency-policy.schema.json)；
- [`RedactionPolicy`](../schemas/redaction-policy.schema.json)；
- [`VerifierProfile`](../schemas/verifier-profile.schema.json)；
- [`ModelCapabilityProfile`](../schemas/model-capability-profile.schema.json)。

有效权限是 Agent Template、Task Order、Authority Context、Sandbox、数据分类和当前 revoke generation 的交集，deny 优先。Profile revision 改变不热改运行中的 Attempt；新 Attempt 使用新 revision，紧急撤权可立即冻结相关工具。

跨会话战术提炼和绩效评估必须证明源 Session 的 tenant、所有权、授权范围和数据分类。来源删除或授权撤回触发派生影响分析，而不是只从 UI 隐藏。

Workspace 路径授权必须处理绝对路径、符号链接、大小写、Git worktree 和临时文件。普通 Session 与 Military Session 同 cwd 不代表互相获得会话控制权。

## 0.9.0-alpha.25 Web 控制面安全

- Client 只提交角色草稿、用户选择的 lint 位置、不透明 workspace ID、已有
  Session ID 和受限 operation intent；
- Remote 每次从 DSH connection/Host authority 解析 principal 与 tenant；本地
  单用户 Profile 使用明确 local principal boundary，不使用硬编码 `web-user`
  冒充企业身份；
- actor、tenant、authority、revision、hash、时间、absolute path、receipt 和
  capability 状态均由 Host 解析或生成；
- 在线 Canary 固定为显式确认的只读工具面，不获得 Workspace 写权限；
- Workspace root 可以作为已验证只读事实显示，但没有可提交路径字段；
- Session 诊断在 Host 脱敏 credential、绝对路径和超长参数；
- Knowledge projection 不包含 Raw Vault reference 或未清洗原文；
- recall simulation 不创建 Task、不调用模型、不授予工具，只保存输入 hash；
- benchmark assessment 只读既有 Session/receipt，不自动发起付费 Provider 请求
  或晋升模型；
- benchmark evidence export 只包含脱敏评估字段；真实 Flash acceptance 对每个
  exact configuration/scenario 执行 N≥50、Wilson 和零安全失败门；
- Evaluation Client 只能提交结构化筛选、报告/Job id、申诉文本和已有 Evidence id，
  不能提交权威 actor、dataset hash、configuration、指标、decision 或 receipt；
- Dataset Builder 只读取 actual preset=`military` 且通过 Host
  tenant/ownership/classification 检查的 materialized Session；
- `militaryEvaluationCenter` 返回前验证 Report/Dataset Artifact digest；Web
  Client 不获得 SQLite handle、任意 Session 扫描、绝对路径或原始对话正文；
- `COMMITTEE_MODEL` 是显式 opt-in，只接收脱敏聚合指标，无工具、temperature 0、
  限长且严格 JSON；失败回退确定性叙述，永远不能修改指标或晋升状态；
- Appeal exclusions 必须属于目标 immutable Dataset；重算生成 superseding
  Report，不能原地改写旧 Artifact 或跨报告注入 Attempt；
- RC.2 本地 Profile 的当前实现是单用户 Host/确认边界，不声称具备企业多租户
  RBAC、独立 Examiner 身份隔离或双人审批；
- 恢复操作必须预览、精确确认、幂等并写 receipt，UI 不提供原始 SQLite/Git
  控制。

### Artifact Reference 授权

Content Blob 与 Artifact Reference 是两个对象。Blob hash 只用于完整性和去重；
Reference 另绑定 tenant、workflow/Mission/Task、classification、owner、
audience/grant、scope、expiry、retention 和 lineage。知道 hash 不等于读取授权。
相同内容被不同分类引用时按最高分类传播，低分类 Reference 不能降级内容。

restricted/raw Artifact 支持加密、密钥轮换、legal hold、retention cleanup、
deletion receipt 和 orphan GC。每次模型 Dispatch 记录实际 provider/model、
classification、residency、redaction policy 与 policy revision；不得在通用路径
硬编码 `internal`。

读取 Blob 时必须同时存在 metadata，并在解密后重新验证 SHA-256 与
`byteLength`；密文认证失败、内容漂移和 metadata 漂移统一 fail closed。
GC 以 metadata 重新构造 Reference Index，修复“metadata 已提交但索引未提交”
的崩溃窗口；无 metadata 的 Blob 作为不可达孤儿删除。若仍有 active/retention/
legal-hold authority 的 metadata 丢失 Blob，GC 必须报
`PERSISTENCE_FAILED`，不得把数据丢失伪装成正常清理。
