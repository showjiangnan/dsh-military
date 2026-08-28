# API、数据契约与错误语义

## 1. 契约分层

### Command

表达请求改变状态，必须有授权、幂等键和 expected revision。

### Event

表达已经发生的不可变事实，只能追加。Mission 内事实使用 Mission Ledger；Tag、Template、Ingestion 和 Performance Evaluation 等跨 Session 管理事实使用独立 Administrative Ledger，二者不能混写。

### Query

读取投影，不改变状态。

### Artifact

承载大体积、不可安全放进事件的内容。

### Model Message

是从 Command/Event/Artifact 投影出的模型可见内容，不是真源。

## 2. 领域标识

所有标识均为不透明字符串：

```text
MissionId
DirectionId
WaveId
TaskId
TaskVersion
AttemptId
WorkflowObligationId
ActivationId
DispatchId
AgentId / SessionId
AdvisorId
TacticalRequestId
TacticalGuidanceId
TacticalSkillId + SemVer
AcceptanceContractId + Version
ArtifactId (content hash)
CompactionId
PromotionOrderId
AgentTemplateId + Revision
TacticalTagId + Revision
TacticalIngestionRequestId
TacticalExtractionCandidateId
BrainstormOrderId
DecisionSetId
ChiefAdviceId
EvaluationRequestId
PerformanceReportId
WorkspaceSnapshotId / WorkspaceLeaseId
CandidateSubmissionId / CandidatePatchId
VerificationReceiptId / IntegrationReceiptId
OperationId / OutboxRecordId
PrincipalId / TenantId
ArtifactContentId / ArtifactReferenceId
```

不得把数组索引、显示名或 Agent 标签作为稳定身份。

## 3. 关键命令

```ts
startMission(input, authority)
createWorkflowObligation(input, authority)
ratifyDirection(command, expectedMissionRevision)
openWave(command, expectedDirectionRevision)
leaseTask(taskId, workerIdentity, expectedTaskVersion)
startAttempt(command, expectedTaskVersion)
activateAgent(command, expectedAttemptFence)
recordDispatch(command, expectedActivationFence)
submitCandidate(candidate, expectedTaskVersion)
submitBlocker(blocker, expectedTaskVersion)
requestTacticalGuidance(request)
issueGuidance(guidance, expectedTaskVersion)
freezeAgent(command, expectedAgentRevision)
releaseAgent(command, expectedAgentRevision)
acceptCandidate(decision, expectedTaskVersion)
issueSpecsMaintenance(order)
commitSpecs(receipt)
createPromotionOrder(order, userAuthorization)
publishTacticVersion(command)
bindMilitarySession(binding)
createAgentTemplateRevision(command)
changeTacticalTag(command)
requestTacticalIngestion(request)
reviewTacticalExtractionCandidate(command)
startBrainstorm(command)
recordBrainstormDecision(command)
requestChiefOfStaffAdvice(command)
requestPerformanceEvaluation(request)
cancelPerformanceEvaluation(command)
```

## 4. 关键查询

```ts
getMissionSnapshot(missionId)
getWorkflowObligation(obligationId)
getDirection(directionId)
getWave(waveId)
getTask(taskId)
listReadyTasks(waveId)
getAgentIdentity(agentId)
getEvidenceGraph(candidateId)
getAdvisorEligibility(context)
retrieveTactics(query)
getRadioQueue(filter)
getTacticalMemory(missionId, boundary)
getSpecsStatus(missionId)
getMilitarySessionBinding(sessionId)
listAgentTemplates(filter)
listTacticalTags(filter)
getTacticalIngestionJob(requestId)
getBrainstormOrder(orderId)
listPendingDecisionQuestionSets(rootSessionId)
getChiefOfStaffAdvice(adviceId)
getPerformanceEvaluation(evaluationRequestId)
getMilitaryPerformanceReport(reportId)
getRuntimeProjection(requestId)
getCommandOperation(operationId)
getArtifactReference(referenceId, principal)
```

## 5. 错误码

### 通用

| Code | 含义 |
|---|---|
| `INVALID_ARGUMENT` | Schema 或领域约束错误 |
| `UNAUTHORIZED` | 调用者无该动作权限 |
| `FORBIDDEN_SCOPE` | 路径、工具、API、技能或数据范围越界 |
| `REVISION_CONFLICT` | CAS revision 不匹配 |
| `STALE_TASK_VERSION` | Task 已被修订 |
| `IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 |
| `NOT_FOUND` | 稳定标识不存在 |
| `CAPACITY_EXHAUSTED` | 当前无 Worker/Verifier/Advisor 容量 |
| `DEPENDENCY_NOT_READY` | 任务前置条件未满足 |
| `RESOURCE_LOCKED` | 写集合或环境被占用 |
| `POLICY_DENIED` | 确定性策略拒绝 |
| `PERSISTENCE_FAILED` | 事实未能持久化，状态不可声称已改变 |
| `RECOVERY_REQUIRED` | Snapshot 存在但没有新鲜 start/heartbeat/settlement receipt |
| `OPERATION_IN_PROGRESS` | 稳定 operationId 已被有 fence 的执行者租赁 |
| `OPERATION_OUTCOME_UNKNOWN` | 外部副作用需先查询 postcondition/receipt |

### 验收

| Code | 含义 |
|---|---|
| `MISSING_EVIDENCE` | 验收条款无对应证据 |
| `UNVERIFIED_TOOL_CLAIM` | 模型声称的工具使用不存在 |
| `ARTIFACT_MISMATCH` | Artifact hash/版本与声明不一致 |
| `REGRESSION_FAILED` | 回归检查失败 |
| `ACCEPTANCE_INCOMPLETE` | 覆盖不足 |
| `CANDIDATE_STALE` | Candidate 对应旧环境/任务 |
| `SELF_VERIFICATION_ONLY` | 仅有执行 Agent 自评 |
| `HUMAN_REVIEW_REQUIRED` | 无法安全自动判定 |

### Radio

```text
REQUEST_NOT_ADMISSIBLE
DUPLICATE_BLOCKER
CHEAP_RETRY_AVAILABLE
MISSING_REPRODUCTION
GUIDANCE_STALE
GUIDANCE_EXPIRED
ADVISOR_UNAVAILABLE
DEAD_LETTERED
```

### Preset、交互、提炼与评估

```text
MILITARY_PRESET_REQUIRED
MILITARY_BINDING_MISMATCH
MILITARY_PRESET_GENERATION_MISMATCH
AGENT_TEMPLATE_INACTIVE
AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED
CONTEXT_POLICY_INVALID
COMPACTION_ATTEMPT_FAILED
TACTICAL_TAG_INACTIVE
TACTICAL_TAG_DELETED
TACTICAL_SOURCE_NOT_AUTHORIZED
TACTICAL_SOURCE_REDACTION_REQUIRED
TACTICAL_CANDIDATE_STALE
TACTICAL_REVIEW_REQUIRED
BRAINSTORM_ALREADY_ACTIVE
BRAINSTORM_NOT_ACTIVE
DECISION_SET_DUPLICATE
DECISION_SET_STALE
CHIEF_FALLBACK_NOT_ADMISSIBLE
EVALUATION_DATASET_INCOMPLETE
EVALUATION_INSUFFICIENT_DATA
EVALUATION_REPORT_MISMATCH
```

### Git

```text
GIT_NETWORK_FORBIDDEN
GIT_REMOTE_WRITE_FORBIDDEN
GIT_NON_MAIN_FORBIDDEN
GIT_HISTORY_REWRITE_FORBIDDEN
GIT_WORKTREE_DIRTY
GIT_COMMIT_FAILED
PROMOTION_ORDER_REQUIRED
```

## 6. 幂等性

- Command 必须携带 `idempotencyKey`；
- 相同键和相同规范化 payload 返回原 receipt；
- 相同键和不同 payload 返回 `IDEMPOTENCY_CONFLICT`；
- Candidate 以 `(taskId, taskVersion, attemptId)` 唯一；
- Evaluation 以 `compactionId` 唯一；
- Guidance 以 `requestId + advisorGeneration` 唯一；
- Git commit 以 specs change-set hash 唯一；
- Tactical Ingestion 以规范化来源快照 + 目标 + policy hash 唯一；
- Brainstorm 一个 root Session 同时最多一个 ACTIVE Order；
- Performance Evaluation 以时间区间、筛选、rubric 和 template revision 集合的 dataset hash 唯一。

## 7. 版本与并发

所有改变聚合状态的命令携带 `expectedRevision`。Ledger 使用 compare-and-swap：

```text
expectedRevision == currentRevision
  → append event, revision + 1
else
  → REVISION_CONFLICT
```

Task 的 `taskVersion` 与聚合 revision 分开：

- revision 表示记录变化；
- taskVersion 表示执行合同变化；
- 注释、观察或指标可增加 revision 而不使 Candidate stale；
- Objective、scope、acceptance、environment 或依赖变化必须增加 taskVersion。

## 8. Artifact Contract

```ts
interface ArtifactDescriptor {
  id: string
  mediaType: string
  byteLength: number
  sha256: string
  classification: 'public' | 'internal' | 'confidential' | 'restricted'
  producer: AgentIdentity | 'harness'
  createdAt: string
  taskId?: string
  taskVersion?: number
  retentionPolicy: string
  redaction?: {
    applied: boolean
    rules: string[]
    sourceArtifactId?: string
  }
}
```

事件只保存 descriptor/ref，不内嵌大日志、密钥或二进制。

## 9. 数据兼容性

每个顶层 payload 包含：

```json
{
  "schemaVersion": "1.0.0"
}
```

兼容规则：

- 新增可选字段：向后兼容；
- 收紧 enum、改变语义或删除字段：新主版本；
- Reader 应拒绝未知主版本；
- Event migration 不重写历史，通过 projection upgrader 读取；
- Tactical Skill 版本使用自身 SemVer，与 schemaVersion 分开。

## 0.2.0 新增契约族

### Preset/Session

- `MilitarySessionBinding`；
- `MILITARY_PRESET_REQUIRED`、`MILITARY_BINDING_MISMATCH`；
- child composition receipt。

### Tactical Ingestion

- `TacticalTag`；
- `TacticalIngestionRequest`；
- `TacticalExtractionCandidate`；
- Source Snapshot、Review Receipt、Draft Version Receipt。

### Agent Templates/Context

- `AgentTemplateProfile`；
- `CompactionAttempt`；
- effective model/context resolution receipt。

### Interaction/Staff

- `BrainstormOrder`；
- `DecisionQuestionSet`；
- `ChiefOfStaffAdvice`。

### Evaluation

- `PerformanceEvaluationRequest`；
- `EvaluationAttemptRecord`；
- `FrozenEvaluationDataset`；
- `AgentTemplatePerformance`；
- `EvaluationConfigurationComparison`；
- `MilitaryPerformanceReport`；
- `EvaluationCenterSnapshot`；
- immutable Evaluation Dataset/Report Artifact 与 Appeal lineage。

## 0.3.0：契约真源

### Event

`contracts/event-catalog.json` 是 Mission 与 Administrative Event type/payload 的唯一维护源。生成器产生：

```text
schemas/mission-event.schema.json
schemas/administrative-event.schema.json
reference/types/generated-event-catalog.ts
examples/events/*.jsonl
contracts/EVENT-CATALOG.md
```

Event Envelope `schemaVersion=2.0.0`，每个 `type` 对应精确 Payload，不再允许开放 `payload: object`。

### 跨进程对象

新增一级契约族：

- generation、migration、compatibility；
- Authority、Authorization、Tool/Permission/API/Residency/Redaction/Verifier/Model Profile；
- General Policy 与 Model Selection Receipt；
- Workspace、Lease、Patch、Integration；
- Evaluation Dataset；
- Tactical Source/Revocation；
- Decision Broker、Compaction Attempt、Change Order、Budget、Bundle Lifecycle。

每个写 Command 产生 Event 或 Receipt；Query 不改变权威状态。外部副作用先有 intent/idempotency，后有 receipt/compensation。

### Schema 与 TypeScript

`contracts/parity-map.json` 对关键共享对象校验字段和 requiredness。实现代码应从 Schema/IDL 生成类型，手写类型只用于服务行为和 branded IDs。

### 错误

错误必须稳定分类：

```text
AUTHORIZATION_DENIED
REVISION_CONFLICT
PRESET_GENERATION_MISSING
RC2_INCOMPATIBLE
MODEL_CAPABILITY_REJECTED
BUDGET_EXHAUSTED
WORKSPACE_DRIFT
INTEGRATION_CONFLICT
DECISION_STALE
SOURCE_RIGHTS_DENIED
INSUFFICIENT_EVALUATION_DATA
```

错误不得通过自由文本决定恢复动作；结构化 code、subject、revision、retryability 和 recovery options 进入 API/UI。

## 10. 0.3.0 治理命令与回执

新增权威命令：

```text
bindAgentExecution(binding, expectedMissionRevision)
resumePresetGeneration(sessionId, requestedGeneration)
reserveResourceBudget(reservation)
settleResourceUsage(receipt)
submitPerformanceEvaluationAppeal(appeal)
resolvePerformanceEvaluationAppeal(command)
```

新增查询：

```text
getAgentExecutionBinding(bindingId)
getPresetResumeReceipt(receiptId)
getBudgetReservation(reservationId)
listResourceUsage(scopeType, scopeId)
getPerformanceEvaluationAppeal(appealId)
listPerformanceEvaluationAppeals(reportId)
```

新增错误码：

```text
AGENT_EXECUTION_BINDING_MISMATCH
AGENT_EXECUTION_BINDING_MISSING
PRESET_RESUME_RECEIPT_FAILED
BUDGET_RESERVATION_REQUIRED
BUDGET_RESERVATION_EXPIRED
BUDGET_SETTLEMENT_CONFLICT
EVALUATION_APPEAL_UNAUTHORIZED
EVALUATION_APPEAL_STALE_REPORT
EVALUATION_APPEAL_EVIDENCE_REQUIRED
```

所有回执必须在声明状态改变前持久化。模型不能构造 Authorization、Binding、Resume、Integration、Budget 或 Appeal resolution 的权威 Receipt；模型最多提出经过 Schema 校验的建议内容。

## 11. 0.9.0-alpha.27 Web 控制面契约

Web Client 只通过六个窄 Typert Remote 访问 Host；每个 Remote 只有只读
`snapshot` 和一个带判别字段的 `execute`，不暴露数据库、文件系统或 Git 对象。

### `militaryControlPlane`

读取 `RoleWorkbenchSnapshot`，包含角色配置、DSH live 模型目录、六层有效
Prompt、Flash readiness、不可变 history、运行指标和模拟记录。动作：

```text
PREVIEW_ROLE
SAVE_ROLE
RESTORE_ROLE_PROMPT
RESTORE_ROLE_DEFAULTS
ROLLBACK_ROLE
UNDO_ROLE
SIMULATE_ROLE
RUN_LIVE_CANARY
EXPORT_PORTABLE
IMPORT_PREVIEW
IMPORT_COMMIT
```

`SimplifiedChineseReviewInput` 只表达源文本、用户确认的位置和是否接受剩余问题；
Host 重新 lint、转换和计算 `SimplifiedChineseReviewReceipt`。Client 不能提供
receipt hash 或转换后权威结果。

### `militaryOperations`

`snapshot` 返回诊断 Session 目录和恢复健康状态。动作：

```text
SESSION_TIMELINE
PREVIEW_RECOVERY
EXECUTE_RECOVERY
```

恢复预览生成 `operationId`、scope、影响和精确确认短语；执行时重新计算预览。
`operationId` 与不同 payload 复用返回幂等冲突。

### `militaryWorkspace`

`snapshot` 从当前租户已绑定 Session 产生 `MilitaryWorkspaceCatalogEntry[]`。
唯一动作 `INSPECT_WORKSPACE` 只接受不透明 `workspaceId`，返回
`MilitaryWorkspaceStatus`。绝对路径没有输入字段；canonical root 只在 Host
验证后作为只读事实返回。

### `militaryBenchmark`

`snapshot` 返回固定 dataset、deterministic run、Provider sample、稳定性分组和
eligible Session。动作：

```text
RUN_DETERMINISTIC
ASSESS_PROVIDER_SESSION
```

每个 run/sample 固定 dataset hash、Bundle/Preset、角色 revision、exact route、
reasoning、ToolProfile 和预算。Provider 稳定性按 dataset + Session + scenario
去重。观察趋势标签在 exact-route 独立 Session 少于 10 或 Wilson 区间宽度大于
0.35 时只能是 `INSUFFICIENT_SAMPLE`；发布 acceptance 是独立且更严格的合同，
每个 exact configuration × scenario 少于 50 个独立 Session 时同样必须是
`INSUFFICIENT_SAMPLE`，并且还要满足首次工具/E2E Wilson 门和四项零安全失败。

### `militaryPrivateSkills`

读取 `MilitaryKnowledgeCenterProjection`：operation 状态、sanitized pipeline、
lineage 和 recall simulation。除既有来源/提炼/审批/晋升/撤回动作外，
`SIMULATE_RECALL` 接收任务文本与 state token budget；返回 exact Skill、rank、
入选/排除原因和 delivery block。服务不创建 Task、不调用模型，并只持久化
输入 hash 与字符数。

### `militaryEvaluationCenter`

`snapshot` 返回 durable Job、immutable Report revision、Appeal、最新完整报告以及
Host Workspace/Mission 目录。动作：

```text
GET_REPORT
GET_DATASET
CANCEL_RUN
RETRY_RUN
SUBMIT_APPEAL
WITHDRAW_APPEAL
DENY_APPEAL
RECOMPUTE_AND_SUPERSEDE
```

创建新评估仍由 Settings 的结构化 `PerformanceEvaluationRequest` 触发。
`GET_DATASET` 在返回前重新验证 frozen manifest；`RETRY_RUN` 只接受 `FAILED`
Job 并复用已完成 exact-configuration shard；申诉重算只接受 Host 验证的
excluded Attempt，产生新 Dataset/Report 和 superseding link，不修改旧 Artifact。

### 共同安全规则

- 所有 action 在 Host 重新解析、限长和校验判别字段；
- `AbortSignal` 在昂贵读取和执行边界传播；
- 读取 projection 不能推进 Mission/Task/Skill lifecycle；
- Client 传入的 actor、tenant、authority、绝对路径、receipt、hash 和时间不
  具有权威性；
- 敏感正文、Secret、Raw Vault reference 和任意 SQLite row 不属于 wire 类型。
