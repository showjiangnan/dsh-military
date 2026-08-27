import type {
  AgentIdentity,
  AgentTemplateId,
  AgentTemplatePerformance,
  AgentTemplateProfile,
  ArtifactId,
  ArtifactRef,
  BrainstormOrder,
  BrainstormOrderId,
  CandidateSubmission,
  ChiefAdviceId,
  ChiefOfStaffAdvice,
  DecisionQuestionSet,
  EvaluationRequestId,
  EventId,
  IsoDateTime,
  MilitaryPerformanceReport,
  MilitarySessionBinding,
  MissionId,
  PerformanceEvaluationRequest,
  PrivateSkillBundleSnapshot,
  PrivateSkillExtractionStartInput,
  PrivateSkillIngestionJob,
  PrivateSkillOperationSnapshot,
  PrivateSkillPromotionReceipt,
  PrivateSkillReviewReceipt,
  PrivateSkillSourceCreateInput,
  PrivateSkillSourceHandle,
  PrivateSkillSourceRecord,
  PrivateSkillUsageRecord,
  Revision,
  SemVer,
  SessionId,
  TacticalExtractionCandidate,
  TacticalExtractionCandidateId,
  TacticalGuidance,
  TacticalIngestionRequest,
  TacticalIngestionRequestId,
  TacticalIngestionSnapshot,
  TacticalRequest,
  TacticalRequestId,
  TacticalTag,
  TacticalTagId,
  TaskId,
  TaskOrder,
  TaskVersion,
  WaveId,
} from './domain.js'
import type { MilitaryAdministrativeEvent, MissionEvent, MissionEventPayloadMap, MissionEventType } from './events.js'
import type {
  BrainstormState,
  EvaluationRunState,
  IngestionState,
  TaskState,
} from './state-machines.js'
import type { MissionCommand, MissionCommandReceipt } from './kernel.js'

export interface AppendReceipt {
  readonly eventId: EventId
  readonly seq: number
  readonly revision: Revision
}

export interface MissionSnapshot {
  readonly missionId: MissionId
  readonly revision: Revision
  readonly activeWaveIds: readonly WaveId[]
  readonly tasks: ReadonlyMap<TaskId, {
    readonly taskVersion: TaskVersion
    readonly state: TaskState
    readonly assignedAgent?: AgentIdentity
  }>
}

export interface MilitaryLedger {
  append(event: MissionEvent, expectedRevision?: Revision): Promise<AppendReceipt>
  /**
   * Atomically admit one command, run its authoritative domain operation, and
   * durably commit its receipt/outbox record. A duplicate returns the stored
   * receipt and never reruns `operation`.
   */
  transactCommand<T>(
    command: MissionCommand,
    admissionEvent: MissionEvent,
    operation: () => Promise<T>,
  ): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }>
  readMission(missionId: MissionId): Promise<MissionSnapshot>
  readEvents(missionId: MissionId, afterSeq?: number): Promise<readonly MissionEvent[]>
  /** Resolve a Mission root without consulting DSH Session plugin events. */
  findMissionByRootSession(rootSessionId: SessionId): Promise<{ readonly missionId: MissionId; readonly general: AgentIdentity } | null>
  subscribe(missionId: MissionId, listener: (event: MissionEvent) => void): () => void
}

export interface MilitaryAdministrativeLedger {
  append(event: MilitaryAdministrativeEvent, expectedRevision?: Revision): Promise<AppendReceipt>
  read(afterSeq?: number): Promise<readonly MilitaryAdministrativeEvent[]>
  subscribe(listener: (event: MilitaryAdministrativeEvent) => void): () => void
}

export interface MilitaryArtifacts {
  put(input: {
    readonly bytes: Uint8Array
    readonly mediaType: string
    readonly classification: 'public' | 'internal' | 'confidential' | 'restricted'
    readonly description?: string
    readonly tenantId?: string
    readonly missionId?: string
    readonly taskId?: string
    readonly ownerPrincipalId?: string
    readonly audiencePrincipalIds?: readonly string[]
    readonly audienceScopes?: readonly string[]
    readonly grantId?: string
    readonly residencyPolicyRef?: string
    readonly retentionUntil?: import('./domain.js').IsoDateTime
    readonly expiresAt?: import('./domain.js').IsoDateTime
    readonly legalHoldIds?: readonly string[]
    readonly lineageReferenceIds?: readonly string[]
    /** Stable Host operation key; reuse with different content/authority fails. */
    readonly idempotencyKey?: string
  }): Promise<ArtifactRef>
  get(id: ArtifactId): Promise<Uint8Array>
  verify(ref: ArtifactRef): Promise<boolean>
  reference(referenceId: string): Promise<import('./artifact-control.js').ArtifactAccessReference>
  read(
    referenceId: string,
    context: import('./artifact-control.js').ArtifactAccessContext,
  ): Promise<Uint8Array>
  deleteReference(input: {
    readonly referenceId: string
    readonly context: import('./artifact-control.js').ArtifactAccessContext
    readonly reason: string
  }): Promise<import('./artifact-control.js').ArtifactDeletionReceipt>
  setLegalHold(input: {
    readonly referenceId: string
    readonly holdId: string
    readonly active: boolean
    readonly context: import('./artifact-control.js').ArtifactAccessContext
  }): Promise<import('./artifact-control.js').ArtifactAccessReference>
  garbageCollect(operationId: string): Promise<import('./artifact-control.js').ArtifactGarbageCollectionReceipt>
  rotateEncryptionKey(operationId: string): Promise<import('./artifact-control.js').ArtifactKeyRotationReceipt>
}

/** Filesystem materializer for immutable, versioned private Skill snapshots. */
export interface MilitaryPrivateSkillBundles {
  write(input: {
    readonly skill: import('./domain.js').TacticalSkillRef
    readonly name: string
    readonly description: string
    readonly lifecycle: PrivateSkillBundleSnapshot['lifecycle']
    readonly sourceSnapshotIds: readonly string[]
    readonly files: readonly {
      readonly path: PrivateSkillBundleSnapshot['files'][number]['path']
      readonly content: string
      readonly executable?: boolean
    }[]
    readonly createdAt: import('./domain.js').IsoDateTime
  }): Promise<PrivateSkillBundleSnapshot>
}

export interface MilitarySessionGate {
  /** Resolve the actual session preset and refuse every non-Military session. */
  requireMilitarySession(sessionId: SessionId): Promise<MilitarySessionBinding>
  /** Register one immutable root-session binding after the preset setup commits. */
  bind(binding: MilitarySessionBinding): Promise<void>
  /** Confirm that a child inherited the exact parent standing-preset generation. */
  verifyChild(parentSessionId: SessionId, childSessionId: SessionId): Promise<void>
}

export type VerificationDisposition =
  | 'ACCEPTED'
  | 'REWORK'
  | 'BLOCKED'
  | 'FROZEN'
  | 'STRATEGIC'
  | 'HUMAN_REVIEW_REQUIRED'

export interface VerificationReceipt {
  readonly receiptId: string
  readonly candidateId: string
  readonly disposition: VerificationDisposition
  readonly clauseResults: readonly {
    readonly clauseId: string
    readonly passed: boolean
    readonly evidenceRefs: readonly string[]
    readonly message: string
  }[]
  readonly deterministicFailures: readonly string[]
  readonly claimEvidenceGraph: import('./kernel.js').ClaimEvidenceGraph
}

export interface MilitaryVerification {
  prepare(candidate: CandidateSubmission, task: TaskOrder, submittedByVerifierRole: boolean): Promise<void> | void
  verify(candidate: CandidateSubmission, signal: AbortSignal): Promise<VerificationReceipt>
}

export interface MilitaryObservedEvidence {
  recordToolCall(receipt: import('./governance.js').ObservedToolCallReceipt): Promise<void>
  toolCalls(callIds: readonly string[]): Promise<readonly import('./governance.js').ObservedToolCallReceipt[]>
}

export interface MilitaryRadio {
  request(request: TacticalRequest): Promise<{
    readonly requestId: TacticalRequestId
    readonly state: 'QUEUED' | 'REJECTED'
  }>
  lease(advisor: AgentIdentity, signal: AbortSignal): Promise<TacticalRequest | null>
  /** Resolve only the exact live request leased by this advisor identity. */
  leased(requestId: TacticalRequestId, advisor: AgentIdentity): Promise<TacticalRequest>
  issue(guidance: TacticalGuidance): Promise<void>
  acknowledge(
    guidanceId: string,
    worker: AgentIdentity,
    task?: { readonly taskId: TaskId; readonly taskVersion: TaskVersion },
  ): Promise<void>
  guidance(guidanceId: string): Promise<TacticalGuidance>
  /** Terminally dead-letter one exact Task request during cancellation/recovery. */
  expire(requestId: TacticalRequestId, reason: string): Promise<void>
  /** Advance TTL/lease retry policy and return only newly dead-lettered requests. */
  reconcileDeadLetters(): Promise<readonly TacticalRequest[]>
}

export interface MilitaryAgentTemplates {
  list(options?: {
    readonly department?: string
    readonly role?: string
    readonly includeInactive?: boolean
  }): Promise<readonly AgentTemplateProfile[]>
  get(templateId: AgentTemplateId, revision?: Revision): Promise<AgentTemplateProfile>
  create(profile: AgentTemplateProfile): Promise<void>
  revise(profile: AgentTemplateProfile, expectedRevision: Revision): Promise<void>
  /** Validate every revision first, then publish the complete set atomically. */
  reviseBatch(
    revisions: readonly {
      readonly profile: AgentTemplateProfile
      readonly expectedRevision: Revision
    }[],
  ): Promise<void>
  setStatus(templateId: AgentTemplateId, status: 'DRAFT' | 'CANARY' | 'ACTIVE' | 'PAUSED' | 'RETIRED'): Promise<void>
  /** Freeze the effective profile used to construct one child Agent. */
  resolveForInstantiation(templateId: AgentTemplateId): Promise<AgentTemplateProfile>
}

export interface MilitaryTags {
  list(options?: { readonly status?: 'ACTIVE' | 'PAUSED' | 'DELETED' }): Promise<readonly TacticalTag[]>
  get(tagId: TacticalTagId): Promise<TacticalTag>
  create(tag: TacticalTag): Promise<void>
  rename(tagId: TacticalTagId, displayName: string, expectedRevision: Revision): Promise<TacticalTag>
  pause(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag>
  resume(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag>
  delete(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag>
}

export interface MilitaryIngestion {
  /** Import source bytes into the isolated raw vault through a shallow Host contract. */
  createSource(input: {
    readonly requestedBy: string
    readonly source: PrivateSkillSourceCreateInput
  }): Promise<PrivateSkillSourceRecord>
  source(sourceHandle: PrivateSkillSourceHandle): Promise<PrivateSkillSourceRecord>
  revokeSource(input: {
    readonly sourceHandle: PrivateSkillSourceHandle
    readonly requestedBy: string
    readonly reason: 'OWNER_REQUEST' | 'LICENSE_CHANGE' | 'SECURITY_INCIDENT' | 'PROVEN_INCORRECT' | 'RETENTION_EXPIRY'
  }): Promise<{ readonly affectedTacticVersions: readonly string[] }>
  /** Create a durable extraction job; canonical request metadata is Host-derived. */
  startExtraction(input: {
    readonly requestedBy: string
    readonly value: PrivateSkillExtractionStartInput
  }): Promise<PrivateSkillIngestionJob>
  /** Resume the job from its last committed stage until it needs review or user action. */
  process(requestId: TacticalIngestionRequestId, signal?: AbortSignal): Promise<PrivateSkillIngestionJob>
  job(requestId: TacticalIngestionRequestId): Promise<PrivateSkillIngestionJob>
  acknowledgeInjection(input: {
    readonly requestId: TacticalIngestionRequestId
    readonly actor: { readonly kind: 'USER'; readonly id: string }
  }): Promise<PrivateSkillIngestionJob>
  editCandidate(input: {
    readonly candidateId: TacticalExtractionCandidateId
    readonly expectedCandidateHash: string
    readonly actor: { readonly kind: 'USER'; readonly id: string }
    readonly title: string
    readonly claims: readonly string[]
    readonly risks: readonly string[]
    readonly validationPlan: readonly string[]
  }): Promise<TacticalExtractionCandidate>
  reviewCandidate(input: {
    readonly candidateId: TacticalExtractionCandidateId
    readonly expectedCandidateHash: string
    readonly expectedDiffHash: string
    readonly action: 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT'
    readonly actor: { readonly kind: 'USER'; readonly id: string }
    readonly instructions?: string
  }): Promise<PrivateSkillReviewReceipt>
  promote(input: {
    readonly skillId: string
    readonly version: SemVer
    readonly to: 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED'
    readonly requestedBy: string
    readonly reason: string
    readonly evidenceRefs: readonly string[]
  }): Promise<PrivateSkillPromotionReceipt>
  bundle(skillId: string, version: SemVer): Promise<PrivateSkillBundleSnapshot>
  /** Re-evaluate source rights and temporal validity before any new delivery. */
  deliveryEligibility(skillId: string, version: SemVer): Promise<{
    readonly eligible: boolean
    readonly reasons: readonly string[]
  }>
  recordUsage(input: Omit<PrivateSkillUsageRecord, 'schemaVersion' | 'usageId' | 'createdAt'>): Promise<PrivateSkillUsageRecord>
  operationSnapshot(): Promise<PrivateSkillOperationSnapshot>
  request(input: TacticalIngestionRequest): Promise<{
    readonly requestId: TacticalIngestionRequestId
    readonly state: IngestionState
  }>
  snapshot(requestId: TacticalIngestionRequestId): Promise<TacticalIngestionSnapshot>
  candidate(requestId: TacticalIngestionRequestId): Promise<TacticalExtractionCandidate | null>
  candidateById(candidateId: TacticalExtractionCandidateId): Promise<TacticalExtractionCandidate>
  returnCandidate(candidateId: TacticalExtractionCandidateId, instructions: string): Promise<void>
  rejectCandidate(candidateId: TacticalExtractionCandidateId, reason: string): Promise<void>
  /** Invalidate DSH Skill provider caches after durable lifecycle changes. */
  subscribe(listener: () => void): () => void
}

export interface MilitaryDecisionBroker {
  submit(questionSet: DecisionQuestionSet, context?: {
    readonly missionId: MissionId
    readonly taskId?: TaskId
    readonly taskVersion?: TaskVersion
    readonly attemptId?: string
  }): Promise<void>
  pending(rootSessionId: SessionId): Promise<readonly DecisionQuestionSet[]>
  recordAnswers(input: {
    readonly rootSessionId: SessionId
    readonly decisionSetId: string
    readonly answerReceiptRef: string
  }): Promise<void>
}

export interface MilitaryBrainstorm {
  start(rootSessionId: SessionId, missionId: MissionId): Promise<BrainstormOrder>
  /** Return the one non-terminal Brainstorm Order bound to a root Session. */
  active(rootSessionId: SessionId): Promise<BrainstormOrder | null>
  get(orderId: BrainstormOrderId): Promise<BrainstormOrder>
  state(orderId: BrainstormOrderId): Promise<BrainstormState>
  complete(orderId: BrainstormOrderId, specsMaintenanceOrderRef?: string): Promise<void>
  cancel(orderId: BrainstormOrderId, reason: string): Promise<void>
}

export interface MilitaryChiefOfStaff {
  advise(input: {
    readonly contextPacket: ArtifactRef
    readonly sufficiency: 'PARTIAL' | 'INSUFFICIENT' | 'CONFLICTED' | 'UNKNOWN'
    readonly signal: AbortSignal
  }): Promise<ChiefOfStaffAdvice>
  get(adviceId: ChiefAdviceId): Promise<ChiefOfStaffAdvice>
}

export interface PerformanceEvaluationRun {
  readonly evaluationRequestId: EvaluationRequestId
  readonly state: EvaluationRunState
  readonly templatesCompleted: number
  readonly templatesTotal: number
  readonly datasetHash?: string
  readonly reportId?: string
  readonly failure?: {
    readonly code: string
    readonly message: string
    readonly failedAt: IsoDateTime
    readonly retryable: boolean
  }
}

export interface MilitaryEvaluation {
  request(input: PerformanceEvaluationRequest): Promise<PerformanceEvaluationRun>
  /** Execute the immutable request and publish the final report. Implementations must be idempotent once completed. */
  execute(evaluationRequestId: EvaluationRequestId, signal: AbortSignal): Promise<MilitaryPerformanceReport>
  get(evaluationRequestId: EvaluationRequestId): Promise<PerformanceEvaluationRun>
  listTemplateResults(evaluationRequestId: EvaluationRequestId): Promise<readonly AgentTemplatePerformance[]>
  report(evaluationRequestId: EvaluationRequestId): Promise<MilitaryPerformanceReport | null>
  cancel(evaluationRequestId: EvaluationRequestId): Promise<void>
}

export interface MilitaryRuntime {
  registerMission(input: {
    readonly missionId: MissionId
    readonly rootSessionId: SessionId
    readonly general: AgentIdentity
    readonly title: string
    readonly authorityContextRef: string
  }): Promise<void>
  registerTask(order: TaskOrder, actor: AgentIdentity): Promise<void>
  completeMission(missionId: MissionId, actor: AgentIdentity): Promise<void>
  cancelMission(input: {
    readonly missionId: MissionId
    readonly actor: AgentIdentity
    readonly reason: string
    readonly cancellationReceiptRef: string
  }): Promise<void>
  missionForSession(rootSessionId: SessionId): Promise<MissionId | null>
  recordEvent<T extends MissionEventType>(input: {
    readonly missionId: MissionId
    readonly actor: AgentIdentity
    readonly type: T
    readonly payload: MissionEventPayloadMap[T]
    readonly idempotencyKey: string
  }): Promise<void>
  submitBlocker(input: {
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly actor: AgentIdentity
    readonly blockerId: string
    readonly evidenceRefs: readonly string[]
    readonly requestId?: string
  }): Promise<void>
  applyGuidance(input: {
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly guidance: TacticalGuidance
    readonly actor: AgentIdentity
  }): Promise<void>
  pendingGuidance(taskId: TaskId): Promise<TacticalGuidance | null>
  acknowledgeGuidance(
    taskId: TaskId,
    guidanceId: string,
    worker: AgentIdentity,
  ): Promise<void>
  waitForDecision(input: {
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly decisionSetId: string
    readonly actor: AgentIdentity
  }): Promise<void>
  resolveDecision(input: {
    readonly decisionSetId: string
    readonly answerReceiptRef: string
    readonly actor: AgentIdentity
  }): Promise<TaskId | null>
  pendingDecisionAnswer(taskId: TaskId): Promise<{
    readonly decisionSetId: string
    readonly answerReceiptRef: string
    readonly resolvedAt: import('./domain.js').IsoDateTime
  } | null>
  acknowledgeDecisionAnswer(
    taskId: TaskId,
    decisionSetId: string,
    worker: AgentIdentity,
  ): Promise<void>
  expireDecisionWait(input: {
    readonly decisionSetId: string
    readonly reason: 'TTL' | 'TASK_VERSION_CHANGED' | 'MISSION_CANCELLED'
      | 'SUPERSEDED' | 'ORIGIN_AGENT_GONE'
    readonly actor: AgentIdentity
  }): Promise<TaskId | null>
  deadLetterGuidanceWait(input: {
    readonly requestId: string
    readonly reason: 'REQUEST_EXPIRED' | 'LEASE_ATTEMPTS_EXHAUSTED'
    readonly actor: AgentIdentity
  }): Promise<TaskId | null>
  getTask(taskId: TaskId): Promise<TaskOrder>
  leaseTask(taskId: TaskId, worker: AgentIdentity, workspaceLeaseId: string): Promise<void>
  /**
   * Settle one Agent Activation and release its lease without assuming that
   * child teardown means Task rework or readiness.
   */
  releaseTaskLease(taskId: TaskId, worker: AgentIdentity, reason: string): Promise<TaskState>
  /** Converge one leased Task to a terminal state after user or policy cancellation. */
  cancelTask(taskId: TaskId, worker: AgentIdentity, reason: string): Promise<void>
  submitCandidate(candidate: CandidateSubmission): Promise<void>
  recordCandidateVerification(
    candidate: CandidateSubmission,
    verification: VerificationReceipt,
  ): Promise<{ readonly acceptedForVerification: boolean; readonly verification: VerificationReceipt }>
  recordCandidateVerificationFailure(
    candidate: CandidateSubmission,
    failureCode: string,
  ): Promise<void>
  candidateProgress(taskId: TaskId): Promise<{
    readonly state: TaskState
    readonly candidateId?: string
    readonly verification?: VerificationReceipt
    readonly integration?: IntegrationReceipt
  }>
  proposeCandidate(candidate: CandidateSubmission): Promise<{ readonly acceptedForVerification: boolean; readonly verification: VerificationReceipt }>
  recordIntegration(taskId: TaskId, receipt: IntegrationReceipt): Promise<void>
  recordSpecsCommit(taskId: TaskId, receipt: { readonly commit: string; readonly treeHash: string; readonly changedPaths: readonly string[] }): Promise<void>
  freezeAgent(agent: AgentIdentity, reasonCodes: readonly string[]): Promise<void>
  releaseAgent(agent: AgentIdentity, correctionOrderRef: string): Promise<void>
  startBrainstorm(rootSessionId: SessionId): Promise<BrainstormOrder>
}

// ── 0.3.0 governance and execution seams ──────────────────────────────────

import type {
  AgentExecutionBinding,
  BundleLifecycleReceipt,
  CandidatePatch,
  CompatibilityReport,
  CompactionAttempt,
  DecisionBrokerRecord,
  EvaluationDatasetManifest,
  FrozenEvaluationDataset,
  GeneralExecutionPolicy,
  IntegrationOrder,
  IntegrationReceipt,
  KnowledgeRevocationOrder,
  MilitaryAuthorityContext,
  ModelCapabilityProfile,
  ModelSelectionReceipt,
  PerformanceEvaluationAppeal,
  PermissionProfile,
  PresetGenerationManifest,
  PresetMigrationOrder,
  PresetResumeReceipt,
  ResourceBudgetPolicy,
  ResourceBudgetReservation,
  ResourceUsageReceipt,
  TacticalSourceSnapshot,
  ToolProfile,
  UserAuthorizationReceipt,
  VerifierProfile,
  WorkspaceLease,
  WorkspaceSnapshot,
} from './governance.js'

export interface MilitaryPresetGenerations {
  current(): Promise<PresetGenerationManifest>
  get(generation: string): Promise<PresetGenerationManifest>
  install(manifest: PresetGenerationManifest): Promise<void>
  resume(input: {
    readonly sessionId: SessionId
    readonly requestedGeneration: string
    readonly signal: AbortSignal
  }): Promise<PresetResumeReceipt>
  migrate(order: PresetMigrationOrder): Promise<void>
}

export interface MilitaryCompatibility {
  probe(signal: AbortSignal): Promise<CompatibilityReport>
  lastReport(): Promise<CompatibilityReport | null>
  requireReady(): Promise<CompatibilityReport>
}

export interface MilitaryAuthorization {
  registerContext(context: MilitaryAuthorityContext): Promise<void>
  resolve(principalId: string, tenantId: string): Promise<MilitaryAuthorityContext>
  grant(receipt: UserAuthorizationReceipt): Promise<void>
  revoke(authorizationId: string, reason: string): Promise<void>
  authorize(input: {
    readonly context: MilitaryAuthorityContext
    readonly action: string
    readonly resource: string
    readonly classification: 'public' | 'internal' | 'confidential' | 'restricted'
  }): Promise<{ readonly allowed: boolean; readonly receiptRef?: string; readonly reason?: string }>
}

export interface MilitaryPolicyRegistry {
  toolProfile(id: string, revision?: number): Promise<ToolProfile>
  permissionProfile(id: string, revision?: number): Promise<PermissionProfile>
  modelCapability(
    provider: string,
    model: string,
    revision?: number,
  ): Promise<ModelCapabilityProfile>
  verifierProfile(id: string, revision?: number): Promise<VerifierProfile>
  resourceBudgetPolicy(id: string, revision?: number): Promise<ResourceBudgetPolicy>
}

export interface MilitaryGeneralRouting {
  policy(): Promise<GeneralExecutionPolicy>
  updatePresetDefault(
    input: GeneralExecutionPolicy['defaultModel'] & {
      readonly contextBudgetTokens?: number
    },
  ): Promise<void>
  applyPresetDefault(sessionId: SessionId): Promise<ModelSelectionReceipt>
  current(sessionId: SessionId): ModelSelectionReceipt | undefined
  validateUserSelection(input: {
    readonly sessionId: SessionId
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: 'high' | 'max'
    readonly selectedBy: string
  }): Promise<ModelSelectionReceipt>
}

export interface MilitaryWorkspaces {
  snapshot(input: {
    readonly tenantId: string
    readonly workspaceKey: string
    readonly signal: AbortSignal
  }): Promise<WorkspaceSnapshot>
  lease(input: WorkspaceLease): Promise<void>
  /** Resolve the exact filesystem root fenced by one active lease. */
  executionPath(workspaceLeaseId: string): string
  /** Resolve a previously captured immutable snapshot for evidence inspection. */
  snapshotById(workspaceSnapshotId: string): WorkspaceSnapshot
  /** Resolve the authoritative repository root retained with one snapshot. */
  repositoryPath(workspaceSnapshotId: string): string
  /** Capture a verified, path-scoped patch from the lease-owned worktree. */
  createCandidatePatch(input: {
    readonly workspaceLeaseId: string
    readonly candidateId: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly signal: AbortSignal
  }): Promise<CandidatePatch>
  release(workspaceLeaseId: string): Promise<void>
  candidatePatch(candidateId: string): Promise<CandidatePatch>
}

export interface MilitaryIntegration {
  queue(order: IntegrationOrder): Promise<void>
  execute(integrationOrderId: string, signal: AbortSignal): Promise<IntegrationReceipt>
  get(integrationOrderId: string): Promise<IntegrationReceipt | null>
}

export interface MilitaryDecisionBrokerV2 extends MilitaryDecisionBroker {
  record(decisionSetId: string): Promise<DecisionBrokerRecord>
  presentNext(rootSessionId: SessionId): Promise<DecisionBrokerRecord | null>
  expire(decisionSetId: string, reason: string): Promise<void>
  supersede(decisionSetId: string, replacementId: string): Promise<void>
  /** Atomically expire due sets and return only the newly terminal records. */
  reconcileExpired(): Promise<readonly DecisionBrokerRecord[]>
}

export interface MilitaryKnowledgeSupplyChain {
  source(snapshotId: string): Promise<TacticalSourceSnapshot>
  revoke(order: KnowledgeRevocationOrder): Promise<void>
  assessImpact(revocationOrderId: string): Promise<ArtifactRef>
}

export interface MilitaryEvaluationDataset {
  build(request: PerformanceEvaluationRequest, signal: AbortSignal): Promise<{
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  }>
  get(evaluationRequestId: EvaluationRequestId): Promise<{
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  } | null>
  verify(manifest: EvaluationDatasetManifest): Promise<boolean>
}

export interface MilitaryCompactionAttempts {
  require(attempt: CompactionAttempt): Promise<void>
  complete(attempt: CompactionAttempt): Promise<void>
  get(attemptId: string): Promise<CompactionAttempt>
}

export interface MilitaryBundleLifecycle {
  install(signal: AbortSignal): Promise<BundleLifecycleReceipt>
  upgrade(targetVersion: string, signal: AbortSignal): Promise<BundleLifecycleReceipt>
  rollback(targetVersion: string, signal: AbortSignal): Promise<BundleLifecycleReceipt>
  uninstall(dataDisposition: 'RETAINED' | 'EXPORTED_AND_REMOVED' | 'REMOVED', signal: AbortSignal): Promise<BundleLifecycleReceipt>
}

/** Registry of immutable effective bindings used to instantiate department agents. */
export interface MilitaryAgentExecutionBindings {
  create(binding: AgentExecutionBinding): Promise<void>
  /** Remove a binding that never crossed child-publication admission. */
  discard(bindingId: string): Promise<void>
  get(bindingId: string): Promise<AgentExecutionBinding>
  forAgent(agentId: string, generation?: number): Promise<AgentExecutionBinding | null>
  forSession(sessionId: string): Promise<AgentExecutionBinding | null>
  verifyEffectiveRequest(input: {
    readonly bindingId: string
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: 'low' | 'high' | 'max'
    readonly toolProfileId: string
    readonly permissionProfileId: string
  }): Promise<{ readonly valid: boolean; readonly reason?: string }>
}

/** Reservation and settlement service; callers cannot spend unreserved capacity. */
export interface MilitaryResourceBudgets {
  reserve(reservation: ResourceBudgetReservation): Promise<ResourceBudgetReservation>
  settle(receipt: ResourceUsageReceipt): Promise<void>
  getReservation(reservationId: string): Promise<ResourceBudgetReservation>
  usageForScope(scopeType: ResourceBudgetReservation['scopeType'], scopeId: string): Promise<ResourceUsageReceipt[]>
  revoke(reservationId: string, reason: string): Promise<void>
  /** Roll back one pre-admission reservation and its idempotency key. */
  discard(reservationId: string): Promise<void>
}

/** Versioned appeal channel over frozen performance reports. */
export interface MilitaryEvaluationAppeals {
  submit(appeal: PerformanceEvaluationAppeal): Promise<void>
  get(appealId: string): Promise<PerformanceEvaluationAppeal>
  list(reportId: string): Promise<readonly PerformanceEvaluationAppeal[]>
  resolve(input: {
    readonly appealId: string
    readonly expectedState: 'SUBMITTED' | 'UNDER_REVIEW'
    readonly disposition: 'UPHELD' | 'PARTIALLY_UPHELD' | 'DENIED'
    readonly resolutionSummary: string
    readonly supersedingReportId?: string
  }): Promise<PerformanceEvaluationAppeal>
  withdraw(appealId: string, principalId: string): Promise<PerformanceEvaluationAppeal>
}



import type {
  CapabilityGrant,
  ContextManifest,
  ExecutionStrategy,
  TaskCapabilityProfile,
} from './kernel.js'

export interface MilitaryMissionKernel {
  submit(command: MissionCommand): Promise<MissionCommandReceipt>
  /** In-process command boundary: serializes the authoritative operation under the same mission partition. */
  execute<T>(command: MissionCommand, operation: () => Promise<T>): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }>
}

export interface MilitaryContextCompiler {
  compile(input: {
    readonly missionId: MissionId
    readonly missionRevision: Revision
    readonly task: TaskOrder
    readonly constitutionRefs: readonly string[]
    readonly stateRefs: readonly string[]
    readonly evidenceRefs: readonly string[]
    readonly workingRefs: readonly string[]
    readonly tokenBudget: number
    readonly reasoningPassbackReserve: number
    readonly imageReserve: number
  }): Promise<ContextManifest>
}

export interface MilitaryExecutionRouter {
  route(input: {
    readonly task: TaskOrder
    readonly capability: TaskCapabilityProfile
    readonly candidateModels: readonly ModelCapabilityProfile[]
    readonly allowCanary?: boolean
  }): Promise<ExecutionStrategy>
}

export interface MilitaryCapabilityGrants {
  issue(grant: CapabilityGrant): Promise<void>
  consume(grantId: string, input: {
    readonly tool: string
    readonly resource?: string
    readonly at: string
    readonly idempotencyKey?: string
  }): Promise<CapabilityGrant>
  revoke(grantId: string, reason: string): Promise<void>
  /** Roll back one unused grant whose child was never published. */
  discard(grantId: string): Promise<void>
  get(grantId: string): Promise<CapabilityGrant>
}
