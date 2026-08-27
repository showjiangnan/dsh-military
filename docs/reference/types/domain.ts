/** Reference-only domain types. Keep production contracts in dedicated packages. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type MissionId = Brand<string, 'MissionId'>
export type DirectionId = Brand<string, 'DirectionId'>
export type WaveId = Brand<string, 'WaveId'>
export type TaskId = Brand<string, 'TaskId'>
export type AttemptId = Brand<string, 'AttemptId'>
export type AgentId = Brand<string, 'AgentId'>
export type SessionId = Brand<string, 'SessionId'>
export type AdvisorId = Brand<string, 'AdvisorId'>
export type AgentTemplateId = Brand<string, 'AgentTemplateId'>
export type CandidateId = Brand<string, 'CandidateId'>
export type ArtifactId = Brand<string, 'ArtifactId'>
export type EventId = Brand<string, 'EventId'>
export type TacticalRequestId = Brand<string, 'TacticalRequestId'>
export type TacticalGuidanceId = Brand<string, 'TacticalGuidanceId'>
export type TacticalSkillId = Brand<string, 'TacticalSkillId'>
export type TacticalTagId = Brand<string, 'TacticalTagId'>
export type TacticalIngestionRequestId = Brand<string, 'TacticalIngestionRequestId'>
export type TacticalExtractionCandidateId = Brand<string, 'TacticalExtractionCandidateId'>
export type PrivateSkillSourceHandle = Brand<string, 'PrivateSkillSourceHandle'>
export type PrivateSkillReviewReceiptId = Brand<string, 'PrivateSkillReviewReceiptId'>
export type PrivateSkillPromotionReceiptId = Brand<string, 'PrivateSkillPromotionReceiptId'>
export type PrivateSkillUsageId = Brand<string, 'PrivateSkillUsageId'>
export type AcceptanceContractId = Brand<string, 'AcceptanceContractId'>
export type PromotionOrderId = Brand<string, 'PromotionOrderId'>
export type CompactionId = Brand<string, 'CompactionId'>
export type BrainstormOrderId = Brand<string, 'BrainstormOrderId'>
export type DecisionSetId = Brand<string, 'DecisionSetId'>
export type ChiefAdviceId = Brand<string, 'ChiefAdviceId'>
export type EvaluationRequestId = Brand<string, 'EvaluationRequestId'>
export type PerformanceId = Brand<string, 'PerformanceId'>
export type PerformanceReportId = Brand<string, 'PerformanceReportId'>
export type WorkspaceLeaseId = Brand<string, 'WorkspaceLeaseId'>
export type WorkspaceSnapshotId = Brand<string, 'WorkspaceSnapshotId'>
export type CandidatePatchId = Brand<string, 'CandidatePatchId'>
export type IntegrationOrderId = Brand<string, 'IntegrationOrderId'>
export type IntegrationReceiptId = Brand<string, 'IntegrationReceiptId'>
export type PresetMigrationOrderId = Brand<string, 'PresetMigrationOrderId'>
export type AuthorityContextId = Brand<string, 'AuthorityContextId'>
export type AuthorizationId = Brand<string, 'AuthorizationId'>

export type IsoDateTime = Brand<string, 'IsoDateTime'>
export type Sha256 = Brand<string, 'Sha256'>
export type SemVer = Brand<string, 'SemVer'>
export type TaskVersion = Brand<number, 'TaskVersion'>
export type Revision = Brand<number, 'Revision'>

export type MilitaryRole =
  | 'general'
  | 'advisor'
  | 'chief-of-staff'
  | 'worker'
  | 'engineer'
  | 'inspector'
  | 'trajectory'
  | 'effectiveness'
  | 'museum'
  | 'evaluation-examiner'
  | 'evaluation-chair'
  | 'harness'

export type ConfigurableDepartmentRole = Exclude<MilitaryRole, 'general' | 'harness'>
export type MilitaryDepartmentId =
  | 'staff'
  | 'worker-forces'
  | 'engineer-corps'
  | 'oversight'
  | 'logistics-research'
  | 'evaluation-committee'
export type ReasoningEffort = 'low' | 'high' | 'max'
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'

export interface AgentIdentity {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly role: MilitaryRole
  readonly displayName: string
  readonly generation: number
  readonly advisorId?: AdvisorId
  readonly templateId?: AgentTemplateId
  readonly templateRevision?: Revision
}

export interface ArtifactRef {
  readonly artifactId: ArtifactId
  /** Opaque authorization-bearing reference; the content hash is never one. */
  readonly referenceId?: string
  readonly sha256: Sha256
  readonly mediaType: string
  readonly byteLength: number
  readonly classification: DataClassification
  readonly tenantId?: string
  readonly missionId?: string
  readonly taskId?: string
  readonly description?: string
  readonly sourceEventId?: EventId
}

export interface EvidenceRef {
  readonly kind:
    | 'artifact'
    | 'event'
    | 'tool-call'
    | 'git-commit'
    | 'api-receipt'
    | 'human-authorization'
  readonly ref: string
  readonly claim: string
  readonly clauseIds?: readonly string[]
}

export interface TacticalSkillRef {
  readonly skillId: TacticalSkillId
  readonly version: SemVer
  readonly guidanceId?: TacticalGuidanceId
  readonly usageStage?:
    | 'assigned'
    | 'acknowledged'
    | 'attempted'
    | 'completed'
    | 'accepted'
    | 'contributed'
    | 'causal'
}

export interface PathScope {
  readonly readPaths: readonly string[]
  readonly writePaths: readonly string[]
  readonly forbiddenPaths: readonly string[]
}

export interface ExecutionBudget {
  readonly modelSteps?: number
  readonly toolCalls?: number
  readonly guidanceRequests?: number
  readonly wallClockSeconds?: number
  readonly maxOutputTokens?: number
}

export interface TaskLocation {
  readonly missionId: MissionId
  readonly directionId: DirectionId
  readonly waveId: WaveId
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly attemptId: AttemptId
}

export interface TaskComplexityVector {
  readonly semanticDecisions: 0 | 1 | 2 | 3 | 4 | 5
  readonly unknownDependencies: 0 | 1 | 2 | 3 | 4 | 5
  readonly writeDomains: 0 | 1 | 2 | 3 | 4 | 5
  readonly toolFamilies: 0 | 1 | 2 | 3 | 4 | 5
  readonly acceptanceAmbiguity: 0 | 1 | 2 | 3 | 4 | 5
  readonly integrationFanOut: 0 | 1 | 2 | 3 | 4 | 5
  readonly contextFootprint: 'small' | 'medium' | 'large'
}

export type DependencyType =
  | 'requires'
  | 'consumes'
  | 'locks'
  | 'validates'
  | 'speculativeWith'
  | 'joinsAt'
  | 'supersedes'

export interface TaskDependency {
  readonly type: DependencyType
  readonly targetTaskId: TaskId
  readonly artifactId?: ArtifactId
  readonly resource?: string
}

export interface AcceptanceContractRef {
  readonly contractId: AcceptanceContractId
  readonly version: number
}

export interface TaskOrder {
  readonly schemaVersion: '1.0.0'
  readonly missionId: MissionId
  readonly directionId: DirectionId
  readonly waveId: WaveId
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly objective: string
  readonly whyItMatters: string
  readonly taskType: string
  readonly assignedRole: 'worker' | 'engineer'
  /** Actual Task content classification, distinct from any permission ceiling. */
  readonly dataClassification?: DataClassification
  readonly complexity: TaskComplexityVector
  readonly scope: PathScope
  readonly allowedTools: readonly string[]
  readonly requiredEvidence: readonly string[]
  readonly acceptance: AcceptanceContractRef
  readonly dependencies: readonly TaskDependency[]
  readonly tactics: readonly TacticalSkillRef[]
  readonly environmentSnapshotRef: string
  readonly stopConditions: readonly string[]
  readonly escalationConditions: readonly string[]
  readonly budget: ExecutionBudget
}

export interface CandidateSubmission {
  readonly schemaVersion: '1.0.0'
  readonly candidateId: CandidateId
  readonly identity: AgentIdentity
  readonly location: TaskLocation
  readonly summary: string
  readonly outputs: readonly ArtifactRef[]
  readonly evidence: readonly EvidenceRef[]
  readonly declaredToolCallIds: readonly string[]
  readonly acceptanceMapping: Readonly<Record<string, readonly EvidenceRef[]>>
  readonly skillUsage: readonly TacticalSkillRef[]
  readonly environmentSnapshotRef: string
  readonly changedPaths: readonly string[]
  readonly knownLimitations: readonly string[]
  readonly submittedAt: IsoDateTime
  readonly idempotencyKey: string
}

export interface TacticalRequest {
  readonly schemaVersion: '1.0.0'
  readonly requestId: TacticalRequestId
  readonly identity: AgentIdentity
  readonly location: TaskLocation
  readonly environmentSnapshotRef: string
  readonly currentSkills: readonly TacticalSkillRef[]
  readonly blocker: {
    readonly type: string
    readonly statement: string
    readonly reproducible: boolean
    readonly minimalReproduction?: string
  }
  readonly attempts: readonly {
    readonly action: string
    readonly observation: string
    readonly reasonRejected?: string
    readonly toolCallIds: readonly string[]
  }[]
  readonly evidence: readonly EvidenceRef[]
  readonly requestedDecision: string
  readonly budget: ExecutionBudget
  readonly idempotencyKey: string
  readonly createdAt: IsoDateTime
  readonly expiresAt?: IsoDateTime
}

export interface TacticalDirectiveStep {
  readonly stepId: string
  readonly action: string
  readonly when?: string
  readonly tool?: string
  readonly expectedOutput?: string
}

export interface TacticalGuidance {
  readonly schemaVersion: '1.0.0'
  readonly guidanceId: TacticalGuidanceId
  readonly requestId: TacticalRequestId
  readonly expectedTaskVersion: TaskVersion
  readonly advisorIdentity: AgentIdentity
  readonly candidateSkills: readonly TacticalSkillRef[]
  readonly selectedSkills: readonly TacticalSkillRef[]
  readonly diagnosis: string
  readonly directive: readonly TacticalDirectiveStep[]
  readonly expectedObservations: readonly string[]
  readonly requiredEvidence: readonly string[]
  readonly stopConditions: readonly string[]
  readonly fallback: string
  readonly issuedAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

/** Durable proof that one root session actually joined the fixed Military preset. */
export interface MilitarySessionBinding {
  readonly schemaVersion: '1.0.0'
  readonly sessionId: SessionId
  readonly presetId: 'military'
  readonly presetGeneration: string
  readonly rootAgentId: AgentId
  readonly activatedAt: IsoDateTime
  readonly workspaceKey: string
  readonly selectionSource?: 'new-session-selection' | 'blank-session-selection' | 'resume'
  readonly capabilityFingerprint: Sha256
  readonly parentSessionId?: SessionId
  readonly tenantId: string
  readonly generationManifestRef: string
  readonly dshBaselineCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  readonly resumeDisposition?: 'NEW' | 'MATCHED' | 'ARCHIVE_REBOUND' | 'QUARANTINED'
}

export interface AgentContextPolicy {
  /** Maximum model-visible context controlled by this template. */
  readonly contextBudgetTokens: number
  /** Integer percentage in [50, 99]; reaching it requires a compaction attempt. */
  readonly compactionTriggerPercent: number
  readonly retainedTailTokens: number
  readonly minimumRearmDeltaPercent: number
  readonly maxCompactionAttemptsPerTurn: number
  readonly onCompactionFailure: 'PAUSE_AND_ESCALATE' | 'HANDOFF_GENERATION' | 'FAIL_TASK'
  readonly preserveEventKinds?: readonly string[]
}

export interface AgentTemplateProfile {
  readonly schemaVersion: '1.0.0'
  readonly templateId: AgentTemplateId
  readonly revision: Revision
  readonly displayName: string
  readonly department: MilitaryDepartmentId
  readonly role: ConfigurableDepartmentRole
  readonly status: 'DRAFT' | 'CANARY' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly description?: string
  /**
   * User-authored Simplified Chinese role guidance. When absent, the bundled
   * prompt for this template id is used. Host authority text is never editable.
   */
  readonly rolePromptOverride?: string
  readonly modelPolicy: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: ReasoningEffort
    readonly maxOutputTokens: number
    readonly fallbackTemplateIds: readonly AgentTemplateId[]
    readonly dataResidency: 'local' | 'enterprise' | 'external-allowed'
    readonly modelCapabilityProfileId: string
    readonly modelCapabilityProfileRevision?: Revision
    readonly dataResidencyPolicyRef: string
    readonly allowFallback?: boolean
    /** Explicitly permits a CANARY capability profile for this template. */
    readonly allowCanaryModel?: boolean
  }
  readonly contextPolicy: AgentContextPolicy
  readonly capabilities: {
    readonly toolProfileId: string
    readonly toolProfileRevision: Revision
    readonly permissionProfileId: string
    readonly permissionProfileRevision: Revision
    readonly tacticalSkillPatterns: readonly string[]
    readonly apiGrantIds: readonly string[]
    readonly verifierProfileIds?: readonly string[]
  }
  readonly domainTagIds: readonly TacticalTagId[]
  readonly taskTypes: readonly string[]
  readonly concurrencyLimit: number
  readonly supersedesRevision?: Revision
  readonly createdAt: IsoDateTime
  readonly updatedAt?: IsoDateTime
}

export type TacticalTagStatus = 'ACTIVE' | 'PAUSED' | 'DELETED'

export interface TacticalTag {
  readonly schemaVersion: '1.0.0'
  readonly tagId: TacticalTagId
  readonly revision: Revision
  readonly displayName: string
  readonly description?: string
  readonly status: TacticalTagStatus
  readonly aliases: readonly string[]
  readonly matchTerms: readonly string[]
  readonly parentTagIds: readonly TacticalTagId[]
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly deletedAt?: IsoDateTime
  readonly createdBy?: string
  readonly renamedFrom?: string
}

export type TacticalIngestionSource =
  | {
      readonly sourceType: 'source-handle'
      readonly sourceHandle: PrivateSkillSourceHandle
    }
  | {
      readonly sourceType: 'session'
      readonly sessionId: SessionId
      readonly startSeq?: number
      readonly endSeq?: number
      readonly includeToolResults: boolean
      readonly includeReasoning?: false
    }
  | {
      readonly sourceType: 'direct-text'
      readonly content: string
      readonly title?: string
    }
  | {
      readonly sourceType: 'artifact'
      readonly artifact: ArtifactRef
      readonly title?: string
    }

export interface TacticalIngestionRequest {
  readonly schemaVersion: '1.0.0'
  readonly requestId: TacticalIngestionRequestId
  readonly requestedBy: string
  readonly source: TacticalIngestionSource
  readonly tagSelection: {
    readonly primaryTagId: TacticalTagId
    readonly additionalTagIds: readonly TacticalTagId[]
    readonly allowProposeNewTags: boolean
  }
  readonly desiredOutcome: 'AUTO' | 'NEW_TACTIC' | 'SUPPLEMENT'
  readonly targetSkill?: TacticalSkillRef
  readonly extractionGoal?: string
  readonly extractionPolicy: {
    readonly classification: DataClassification
    readonly visibility: 'user-private' | 'workspace-private' | 'organization-private'
    readonly redactSecrets: true
    readonly requireUserReview: true
    readonly allowExternalModel?: boolean
  }
  readonly consent: {
    readonly confirmed: true
    readonly purpose: string
    readonly confirmedAt: IsoDateTime
  }
  readonly createdAt: IsoDateTime
  readonly idempotencyKey?: string
}

export interface TacticalExtractionCandidate {
  readonly schemaVersion: '1.0.0'
  readonly candidateId: TacticalExtractionCandidateId
  readonly requestId: TacticalIngestionRequestId
  readonly sourceSnapshot: ArtifactRef
  readonly disposition: 'NEW_TACTIC' | 'SUPPLEMENT' | 'EVIDENCE_NOTE' | 'REJECT'
  readonly primaryTagId: TacticalTagId
  readonly additionalTagIds: readonly TacticalTagId[]
  readonly targetSkill?: TacticalSkillRef
  readonly proposedTitle: string
  readonly highValueClaims: readonly {
    readonly claim: string
    readonly evidence: readonly EvidenceRef[]
    readonly confidence: number
  }[]
  readonly proposedContent: ArtifactRef
  readonly diffArtifact?: ArtifactRef
  readonly risks: readonly string[]
  readonly validationPlan: readonly string[]
  readonly status: 'PENDING_REVIEW' | 'APPROVED_AS_DRAFT' | 'REJECTED' | 'RETURNED'
  readonly createdAt: IsoDateTime
}

/**
 * Host-owned rights envelope retained with one imported source.  Defaults are
 * intentionally restrictive: an unknown licence can only yield a user-private
 * draft and can never be promoted to a shared or production lifecycle.
 */
export interface PrivateSkillSourceRights {
  readonly ownerId: string
  readonly license: 'USER_OWNED' | 'ENTERPRISE_INTERNAL' | 'LICENSED' | 'UNKNOWN'
  readonly allowedUse: readonly ('PRIVATE_TACTIC' | 'WORKSPACE_TACTIC' | 'ORGANIZATION_TACTIC' | 'EVALUATION')[]
  readonly allowedAudience: readonly string[]
  readonly derivativeWorkAllowed: boolean
  /** Explicit consent required before confidential/restricted sanitized chunks leave the Host. */
  readonly externalModelProcessingAllowed: boolean
  readonly retentionPolicyRef: string
  readonly revocationPolicyRef: string
  readonly validUntil?: IsoDateTime
  readonly dependencyVersions: readonly string[]
}

/** Shallow, user-facing import contract. Canonical IDs, hashes and timestamps are Host-derived. */
export type PrivateSkillSourceCreateInput =
  | {
      readonly kind: 'DIRECT_TEXT'
      readonly title: string
      readonly content: string
      readonly classification?: DataClassification
      readonly visibility?: 'user-private' | 'workspace-private' | 'organization-private'
      readonly rights?: Partial<PrivateSkillSourceRights>
    }
  | {
      readonly kind: 'SESSION_RANGE'
      readonly title: string
      readonly sessionId: SessionId
      readonly startSeq?: number
      readonly endSeq?: number
      readonly includeToolResults?: boolean
      readonly classification?: DataClassification
      readonly visibility?: 'user-private' | 'workspace-private' | 'organization-private'
      readonly rights?: Partial<PrivateSkillSourceRights>
    }
  | {
      readonly kind: 'ARTIFACT'
      readonly title: string
      readonly artifact: ArtifactRef
      readonly classification?: DataClassification
      readonly visibility?: 'user-private' | 'workspace-private' | 'organization-private'
      readonly rights?: Partial<PrivateSkillSourceRights>
    }

/** Durable source metadata. Raw bytes stay behind rawVaultRef and are never projected to model/UI. */
export interface PrivateSkillSourceRecord {
  readonly schemaVersion: '1.0.0'
  readonly sourceHandle: PrivateSkillSourceHandle
  readonly sourceKind: 'SESSION_RANGE' | 'DIRECT_TEXT' | 'ARTIFACT'
  readonly title: string
  readonly requestedBy: string
  readonly classification: DataClassification
  readonly visibility: 'user-private' | 'workspace-private' | 'organization-private'
  readonly rights: PrivateSkillSourceRights
  readonly rawVaultRef: string
  readonly sourceHash: Sha256
  readonly status: 'IMPORTED' | 'SANITIZED' | 'QUARANTINED' | 'REVOKED'
  readonly sanitizedArtifact?: ArtifactRef
  readonly redactionReceipt?: ArtifactRef
  readonly promptInjectionScan?: {
    readonly status: 'PASS' | 'WARN' | 'FAIL'
    readonly findings: readonly string[]
    readonly acknowledgedBy?: string
    readonly acknowledgedAt?: IsoDateTime
  }
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

/** One deterministic chunk fed to an extractor; offsets address sanitized UTF-16 text. */
export interface PrivateSkillChunkRecord {
  readonly schemaVersion: '1.0.0'
  readonly requestId: TacticalIngestionRequestId
  readonly chunkId: string
  readonly ordinal: number
  readonly startOffset: number
  readonly endOffset: number
  readonly contentHash: Sha256
  readonly artifact: ArtifactRef
  readonly extractionState: 'PENDING' | 'EXTRACTING' | 'COMPLETED' | 'FAILED'
  readonly attempts: number
  readonly extractorRoute?: {
    readonly mode: 'FLASH' | 'DETERMINISTIC_FALLBACK'
    readonly provider?: string
    readonly model?: string
  }
  readonly extractionArtifact?: ArtifactRef
  readonly lastError?: string
}

/** Durable state projection used by tools and the visual operation centre. */
export interface PrivateSkillIngestionJob {
  readonly schemaVersion: '1.0.0'
  readonly requestId: TacticalIngestionRequestId
  readonly sourceHandle: PrivateSkillSourceHandle
  readonly state:
    | 'REQUESTED'
    | 'SNAPSHOTTING'
    | 'SCANNING'
    | 'AWAITING_INJECTION_ACK'
    | 'EXTRACTING'
    | 'VALIDATING'
    | 'PENDING_REVIEW'
    | 'APPROVED_AS_DRAFT'
    | 'RETURNED'
    | 'REJECTED'
    | 'FAILED'
    | 'CANCELLED'
  readonly extractionGoal: string
  readonly primaryTagId: TacticalTagId
  readonly additionalTagIds: readonly TacticalTagId[]
  readonly targetSkill?: TacticalSkillRef
  readonly extractorRoute: {
    readonly mode: 'FLASH' | 'DETERMINISTIC_FALLBACK'
    readonly provider?: string
    readonly model?: string
  }
  readonly deterministicFallbackAllowed: boolean
  readonly candidateId?: TacticalExtractionCandidateId
  readonly chunkCount: number
  readonly completedChunkCount: number
  readonly failureCode?: string
  readonly failureMessage?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface TacticalIngestionSnapshot {
  readonly requestId: TacticalIngestionRequestId
  readonly sourceArtifact: ArtifactRef
  readonly contentHash: string
  readonly redactionReceipt: ArtifactRef
  readonly sourcePresetId?: string
}

/** Shallow General contract: the Host derives every authority/hash/state field. */
export interface PrivateSkillExtractionStartInput {
  readonly sourceHandle: PrivateSkillSourceHandle
  readonly extractionGoal: string
  readonly primaryTagId: TacticalTagId
  readonly additionalTagIds?: readonly TacticalTagId[]
  readonly targetSkill?: TacticalSkillRef
  readonly desiredOutcome?: 'AUTO' | 'NEW_TACTIC' | 'SUPPLEMENT'
  readonly allowDeterministicFallback?: boolean
}

export interface PrivateSkillReviewReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: PrivateSkillReviewReceiptId
  readonly candidateId: TacticalExtractionCandidateId
  readonly candidateHash: Sha256
  readonly diffHash: Sha256
  readonly action: 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT'
  readonly actor: {
    readonly kind: 'USER'
    readonly id: string
  }
  readonly scope: 'user-private' | 'workspace-private' | 'organization-private'
  readonly instructions?: string
  readonly committedSkill?: TacticalSkillRef
  readonly createdAt: IsoDateTime
}

export interface PrivateSkillPromotionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: PrivateSkillPromotionReceiptId
  readonly skill: TacticalSkillRef
  readonly from: 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED'
  readonly to: 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED'
  readonly requestedBy: string
  readonly evidenceRefs: readonly string[]
  readonly reason: string
  readonly createdAt: IsoDateTime
}

export interface PrivateSkillUsageRecord {
  readonly schemaVersion: '1.0.0'
  readonly usageId: PrivateSkillUsageId
  readonly skill: TacticalSkillRef
  readonly missionId?: MissionId
  readonly taskId?: TaskId
  readonly matchReasons: readonly string[]
  readonly provider: string
  readonly model: string
  readonly toolEvidenceRefs: readonly string[]
  readonly verifierReceiptRefs: readonly string[]
  readonly outcome: 'SUCCEEDED' | 'REWORK' | 'ROLLED_BACK' | 'FAILED' | 'UNKNOWN'
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly estimatedCostUsd?: number
  /** How token counts were attributed to this exact Task/Skill usage. */
  readonly tokenBasis?: 'SESSION_OBSERVED' | 'UNAVAILABLE'
  /** Never infer money from tokens when the active provider exposes no price. */
  readonly costStatus?: 'OBSERVED' | 'PROVIDER_PRICING_UNAVAILABLE'
  readonly createdAt: IsoDateTime
}

/** Immutable full-snapshot package compiled from one approved procedure version. */
export interface PrivateSkillBundleSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly skill: TacticalSkillRef
  readonly name: string
  readonly description: string
  readonly lifecycle: 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED'
  readonly rootPath: string
  readonly files: readonly {
    readonly path: 'SKILL.md' | `references/${string}` | `examples/${string}` | `scripts/${string}`
    readonly artifact: ArtifactRef
    readonly executable: boolean
  }[]
  readonly contentHash: Sha256
  readonly sourceSnapshotIds: readonly string[]
  readonly createdAt: IsoDateTime
}

export interface PrivateSkillOperationSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly sources: readonly Omit<PrivateSkillSourceRecord, 'rawVaultRef'>[]
  /** Sanitized artifact/chunk metadata only; rawVaultRef is never included. */
  readonly pipelines: readonly {
    readonly requestId: TacticalIngestionRequestId
    readonly sourceHandle: PrivateSkillSourceHandle
    readonly returnedInstructions: readonly string[]
    readonly snapshot?: TacticalIngestionSnapshot
    readonly chunks: readonly PrivateSkillChunkRecord[]
    readonly candidateId?: TacticalExtractionCandidateId
  }[]
  readonly jobs: readonly PrivateSkillIngestionJob[]
  readonly candidates: readonly TacticalExtractionCandidate[]
  readonly reviews: readonly PrivateSkillReviewReceipt[]
  readonly promotions: readonly PrivateSkillPromotionReceipt[]
  readonly bundles: readonly PrivateSkillBundleSnapshot[]
  readonly usages: readonly PrivateSkillUsageRecord[]
  readonly revocations: readonly import('./governance.js').KnowledgeRevocationOrder[]
  readonly generatedAt: IsoDateTime
}

export interface DecisionQuestion {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options: readonly {
    readonly label: string
    readonly description: string
  }[]
  readonly multiSelect: boolean
  readonly decisionOwner?: 'user' | 'general'
}

export interface DecisionQuestionSet {
  readonly schemaVersion: '1.0.0'
  readonly decisionSetId: DecisionSetId
  readonly producer: AgentIdentity
  readonly targetRootSessionId: SessionId
  readonly contextVersion: number
  readonly purpose: string
  readonly deliveryAuthority: 'general'
  readonly questions: readonly DecisionQuestion[]
  readonly dedupeKey?: string
  readonly createdAt: IsoDateTime
  readonly expiresAt?: IsoDateTime
}

export interface BrainstormOrder {
  readonly schemaVersion: '1.0.0'
  readonly orderId: BrainstormOrderId
  readonly sessionId: SessionId
  readonly missionId: MissionId
  readonly canonicalCommand: '/brainstorm'
  readonly displayName: '头脑风暴'
  readonly revision: Revision
  readonly status: 'OPEN' | 'QUESTIONING' | 'STAFF_REVIEW' | 'SPECS_HANDOFF' | 'COMPLETED' | 'CANCELLED'
  readonly projectStage: 'IDEATION' | 'SPECS_ONLY' | 'ACTIVE' | 'LEGACY'
  readonly questionPolicy: {
    readonly maxRounds: number
    readonly maxQuestionsPerRound: number
    readonly askOnlyUserOwnedDecisions: true
  }
  readonly phases: readonly string[]
  readonly knownFacts: readonly string[]
  readonly constraints: readonly string[]
  readonly unknowns: readonly string[]
  readonly answeredQuestionIds: readonly string[]
  readonly pendingDecisionSetRefs: readonly DecisionSetId[]
  readonly specsHandoff: {
    readonly required: boolean
    readonly maintenanceOrderRef?: string
  }
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface ChiefOfStaffAdvice {
  readonly schemaVersion: '1.0.0'
  readonly adviceId: ChiefAdviceId
  readonly generatedBy: AgentIdentity
  readonly contextPacketRef: string
  readonly status: 'GENERATED_REFERENCE'
  readonly tacticalSufficiency: {
    readonly disposition: 'PARTIAL' | 'INSUFFICIENT' | 'CONFLICTED' | 'UNKNOWN'
    readonly coverageScore: number
    readonly reasons: readonly string[]
  }
  readonly problem: string
  readonly facts: readonly string[]
  readonly assumptions: readonly string[]
  readonly options: readonly {
    readonly optionId: string
    readonly title: string
    readonly approach: string
    readonly benefits: readonly string[]
    readonly risks: readonly string[]
    readonly evidenceRefs?: readonly EvidenceRef[]
  }[]
  readonly recommendedOptionId: string
  readonly recommendationRationale: string
  readonly risks?: readonly string[]
  readonly nextStep: string
  readonly verifierRequirements: readonly string[]
  readonly needsUserDecision: boolean
  readonly decisionQuestionSet?: DecisionQuestionSet
  readonly confidence: number
  readonly createdAt: IsoDateTime
  readonly expiresAt?: IsoDateTime
}

/** User-selectable comparison reference; unsupported historical baselines fail visibly. */
export type EvaluationComparisonBaseline =
  | 'same-role-same-difficulty'
  | 'previous-period'
  | 'previous-revision'
  | 'organization-baseline'
  | 'none'

export interface PerformanceEvaluationRequest {
  readonly schemaVersion: '1.0.0'
  readonly evaluationRequestId: EvaluationRequestId
  readonly requestedBy: string
  readonly period: { readonly from: IsoDateTime; readonly to: IsoDateTime }
  readonly filters: {
    readonly templateIds: readonly AgentTemplateId[]
    readonly departments: readonly MilitaryDepartmentId[]
    readonly workspaceKeys: readonly string[]
    readonly missionIds: readonly MissionId[]
    readonly includeIncompleteSessions: boolean
    /** Explicit appeal-authorized exclusions; omitted for ordinary runs. */
    readonly excludedAttemptIds?: readonly string[]
  }
  readonly minimumSamples: number
  /** Production evaluation never combines immutable template revisions. */
  readonly splitByRevision: true
  readonly comparisonBaseline: EvaluationComparisonBaseline
  readonly confidenceLevel?: 0.9 | 0.95 | 0.99
  readonly nonInferiorityMargin?: number
  /**
   * Wall-clock budget for one resumable execution attempt. A timeout marks
   * the durable Job FAILED/retryable; already frozen data and completed
   * configuration shards remain available to the next execution.
   */
  readonly timeoutSeconds?: number
  /** Optional model prose can explain but never alter deterministic metrics. */
  readonly narrativeMode?: 'DETERMINISTIC' | 'COMMITTEE_MODEL'
  readonly reportClassification: DataClassification
  readonly examinerTemplateId: AgentTemplateId
  readonly chairTemplateId: AgentTemplateId
  readonly createdAt: IsoDateTime
  readonly idempotencyKey?: string
}

export type EvaluationFailureStage =
  | 'NONE'
  | 'TASK_ORDER_AMBIGUITY'
  | 'MODEL_TOOL_SELECTION'
  | 'MODEL_ARGUMENT_SCHEMA'
  | 'HOST_VALIDATION'
  | 'PERMISSION_DENIED'
  | 'PATH_SCOPE_REJECTION'
  | 'TOOL_RUNTIME'
  | 'WORKSPACE_STATE'
  | 'VERIFICATION_FAILURE'
  | 'INTEGRATION_FAILURE'
  | 'PARENT_WAKEUP_FAILURE'
  | 'PROVIDER_FAILURE'
  | 'EXTERNAL_DEPENDENCY'
  | 'USER_CANCELLATION'
  | 'SYSTEM_CRASH'
  | 'MISSION_SCOPE_CHANGE'
  | 'UNKNOWN'

export type EvaluationMissingReason =
  | 'USER_CANCELLED'
  | 'SYSTEM_CRASH'
  | 'PROVIDER_UNAVAILABLE'
  | 'EXTERNAL_DEPENDENCY'
  | 'AGENT_FAILURE'
  | 'MISSION_SCOPE_CHANGE'
  | 'EVENT_GAP'
  | 'SESSION_NOT_MATERIALIZED'
  | 'UNKNOWN'

export type EvaluationRouteStatus =
  | 'EXACT_ROUTE_OBSERVED'
  | 'FALLBACK_CHAIN_OBSERVED'
  | 'ALIAS_UNPROVEN'

export interface EvaluationAttemptRecord {
  readonly schemaVersion: '1.0.0'
  readonly attemptId: string
  readonly identity: {
    readonly rootSessionId: string
    readonly sessionId: string
    readonly missionId: string
    readonly workspaceKey: string
    readonly taskId: string
    readonly taskVersion: number
    readonly agentId: string
    readonly agentGeneration: number
    readonly leaseSeq: number
  }
  readonly configuration: {
    readonly templateId: AgentTemplateId
    readonly templateRevision: Revision
    readonly role: ConfigurableDepartmentRole
    readonly department: MilitaryDepartmentId
    readonly promptRevision: number
    readonly configurationHash: Sha256
    readonly provider: string
    readonly model: string
    readonly aliasStatus: EvaluationRouteStatus
    readonly reasoningEffort: ReasoningEffort
    readonly toolProfile: { readonly id: string; readonly revision: Revision }
    readonly permissionProfile: { readonly id: string; readonly revision: Revision }
    readonly presetGeneration: string
    readonly bundleVersion: string
    readonly dshRelease: '0.1.1-rc.2'
    readonly dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  }
  readonly task: {
    readonly taskType: string
    readonly preExecutionDifficulty: number
    readonly difficultyModelVersion: string
    readonly complexity?: TaskComplexityVector
    readonly riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN'
    readonly acceptanceClauseCount: number
    readonly dependencyCount: number
    readonly allowedToolCount: number
    readonly verifierStrength: number
    readonly workspaceDrift: boolean
    readonly tacticalCoverage: boolean
  }
  readonly outcome: {
    readonly firstPassAccepted: boolean
    readonly finalAccepted: boolean
    readonly completed: boolean
    readonly missionCompleted: boolean
    readonly declaredCompleteWithoutEvidence: boolean
    /** More than one successful terminal call in the same lease window. */
    readonly terminalDuplicate?: boolean
    readonly frozen: boolean
    readonly permissionViolation: boolean
    readonly staleSubmission: boolean
    readonly regressionEscape: boolean
    readonly handoffComplete: boolean
    readonly parentWakeup: boolean
    readonly recoveryAttempted: boolean
    readonly recoverySucceeded: boolean
    /** Resume crossed a stale identity/version/workspace fence. */
    readonly recoveryDrift?: boolean
    readonly verifierObserved: boolean
    readonly reworkCount: number
    readonly blockerCount: number
    readonly radioCount: number
    readonly userInterventionCount: number
    /**
     * Completeness of the authoritative event chain used to derive outcome
     * fields.  A false value means the corresponding boolean above is only an
     * observed absence and MUST NOT be interpreted as a negative outcome.
     */
    readonly authority?: {
      readonly taskSettlementObserved: boolean
      readonly missionSettlementObserved: boolean
      readonly specsOutcomeObserved: boolean
      readonly integrationOutcomeObserved: boolean
      readonly parentWakeupObserved: boolean
    }
  }
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly reasoningTokens: number
    readonly modelSteps: number
    readonly toolCalls: number
    readonly correctionCount: number
    readonly queueLatencyMs: number
    readonly modelLatencyMs: number
    readonly toolLatencyMs: number
    readonly verificationLatencyMs: number
    readonly totalLatencyMs: number
    readonly fallbackCount: number
    readonly retryCount: number
    readonly compactionAttempts: number
    readonly compactionSuccesses: number
    readonly costStatus: 'OBSERVED' | 'ESTIMATED' | 'PROVIDER_PRICING_UNAVAILABLE'
    readonly pricingVersion?: string
    readonly estimatedCostUsd?: number
  }
  readonly failure: {
    readonly stage: EvaluationFailureStage
    readonly code?: string
    readonly missingReason?: EvaluationMissingReason
  }
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly startedAt: IsoDateTime
  readonly completedAt?: IsoDateTime
}

export type EvaluationMetricStatus =
  | 'AVAILABLE'
  | 'NOT_APPLICABLE'
  | 'INCOMPLETE_EVIDENCE'

/**
 * Lossless representation of a ratio.  `value` is intentionally absent when
 * the denominator is zero or the authoritative event chain is incomplete.
 */
export interface EvaluationRatio {
  readonly status: EvaluationMetricStatus
  readonly numerator: number
  readonly denominator: number
  /** Population that should have supplied an authoritative observation. */
  readonly eligiblePopulation?: number
  readonly value?: number
  readonly missingReasons?: readonly string[]
}

export interface EvaluationRateInterval {
  readonly status: EvaluationMetricStatus
  readonly estimate: number
  readonly low: number
  readonly high: number
  readonly confidenceLevel: number
  readonly numerator: number
  readonly denominator: number
}

/** Uncertainty for a non-binary metric, clustered by independent Mission. */
export interface EvaluationNumericInterval {
  readonly estimate: number
  readonly confidenceLevel: 0.9 | 0.95 | 0.99
  readonly clusterCount: number
  readonly method: 'MISSION_CLUSTER_BOOTSTRAP'
  readonly status: 'AVAILABLE' | 'INSUFFICIENT_CLUSTERS' | 'NO_DATA'
  readonly low?: number
  readonly high?: number
}

export interface EvaluationConfigurationSnapshot {
  readonly configurationKey: string
  readonly templateId: AgentTemplateId
  readonly revision: Revision
  readonly role: ConfigurableDepartmentRole
  readonly department: MilitaryDepartmentId
  readonly promptRevision: number
  readonly configurationHash: Sha256
  readonly provider: string
  readonly model: string
  readonly aliasStatus: EvaluationRouteStatus
  readonly reasoningEffort: ReasoningEffort
  readonly toolProfile: { readonly id: string; readonly revision: Revision }
  readonly permissionProfile: { readonly id: string; readonly revision: Revision }
  readonly presetGeneration: string
  readonly bundleVersion: string
  readonly dshRelease: '0.1.1-rc.2'
  readonly dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
}

export interface AgentTemplatePerformance {
  readonly schemaVersion: '1.0.0'
  readonly performanceId: PerformanceId
  readonly evaluationRequestId: EvaluationRequestId
  readonly template: EvaluationConfigurationSnapshot
  readonly period: { readonly from: IsoDateTime; readonly to: IsoDateTime }
  readonly sample: {
    readonly missions: number
    readonly eligibleTasks: number
    readonly assignedAttempts: number
    readonly completedAttempts: number
    readonly acceptedContributions: number
    readonly consultations?: number
    readonly sessions: number
  }
  readonly participation: {
    readonly rate: number
    readonly coverageByTaskType: Readonly<Record<string, number>>
  }
  readonly accuracy: {
    readonly firstPassAcceptanceRate: number
    readonly finalAcceptanceRate: number
    readonly claimEvidenceSupportRate: number
    readonly toolClaimAccuracy: number
    readonly falseCompletionRate: number
    readonly regressionEscapeRate: number
    readonly intervals: {
      readonly firstPassAcceptance: EvaluationRateInterval
      readonly finalAcceptance: EvaluationRateInterval
      readonly falseCompletion: EvaluationRateInterval
    }
  }
  readonly completion: {
    readonly completionRate: number
    readonly meanReworkCount: number
    readonly blockerResolutionRate: number
    readonly handoffCompletenessRate: number
    readonly parentWakeupRate: number
  }
  readonly capability: {
    readonly index: number
    readonly rubricVersion: string
    readonly difficultyAdjustment: string
    readonly confidenceInterval: { readonly low: number; readonly high: number }
  }
  readonly reliability: {
    readonly freezeIncidentRate: number
    readonly permissionViolationRate: number
    readonly staleSubmissionRate: number
    readonly recoverySuccessRate: number
    readonly terminalDuplicateRate: number
    readonly recoveryDriftRate: number
  }
  /**
   * Canonical truth for every ratio exposed above.  Legacy scalar fields are
   * retained for report compatibility; consumers MUST use this map to
   * distinguish a measured zero from N/A or incomplete evidence.
   */
  readonly metricTruth: Readonly<Record<string, EvaluationRatio>>
  readonly efficiency: {
    readonly acceptedOutcomeCount: number
    readonly meanTokensPerAcceptedOutcome: number
    readonly meanLatencySeconds: number
    readonly p50LatencySeconds: number
    readonly p95LatencySeconds: number
    readonly meanModelSteps: number
    readonly meanCorrections: number
    readonly compactionAttemptCount: number
    readonly compactionSuccessRate: number
    readonly costStatus: 'OBSERVED' | 'ESTIMATED' | 'PROVIDER_PRICING_UNAVAILABLE'
    readonly meanCostPerAcceptedOutcomeUsd?: number
    readonly pricingVersion?: string
    readonly intervals: {
      readonly tokensPerAcceptedOutcome: EvaluationNumericInterval
      readonly latencyPerAcceptedOutcomeSeconds: EvaluationNumericInterval
      readonly costPerAcceptedOutcomeUsd?: EvaluationNumericInterval
    }
  }
  readonly dataQuality: {
    readonly missingEventRate: number
    readonly verifierCoverageRate: number
    readonly sampleSufficient: boolean
    readonly uniqueAttemptCount: number
    readonly uniqueMissionCount: number
    readonly effectiveIndependentMissionCount: number
    readonly primaryIntervalWidth: number
    readonly sufficiencyCriteria: readonly {
      readonly criterion: string
      readonly passed: boolean
      readonly observed: number
      readonly required: number
    }[]
    readonly selectionBiasNotes: readonly string[]
  }
  readonly failureAttribution: {
    readonly byStage: Readonly<Partial<Record<EvaluationFailureStage, number>>>
    readonly byMissingReason: Readonly<Partial<Record<EvaluationMissingReason, number>>>
    readonly modelCausedRate: number
    readonly hostOrInfrastructureRate: number
    readonly externalOrCancelledRate: number
    readonly unknownRate: number
  }
  readonly analyses: readonly string[]
  readonly recommendations: readonly {
    readonly area:
      | 'task-design'
      | 'prompt'
      | 'permissions'
      | 'tactics'
      | 'model'
      | 'reasoning'
      | 'context-budget'
      | 'compaction'
      | 'verification'
    readonly action: string
    readonly priority: 'low' | 'medium' | 'high' | 'critical'
  }[]
  readonly limitations: readonly string[]
  readonly confidence: number
  readonly status: 'VALID' | 'INSUFFICIENT_DATA' | 'INVALID'
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly createdAt: IsoDateTime
}

export interface EvaluationConfigurationComparison {
  readonly comparisonId: string
  readonly role: ConfigurableDepartmentRole
  readonly candidateConfigurationKey: string
  readonly baselineConfigurationKey: string
  readonly design: 'OBSERVATIONAL' | 'PAIRED_MISSION' | 'RANDOMIZED'
  readonly observational: boolean
  readonly sample: {
    readonly candidateAttempts: number
    readonly baselineAttempts: number
    readonly candidateMissions: number
    readonly baselineMissions: number
  }
  readonly quality: {
    readonly candidateFinalAcceptance: EvaluationRateInterval
    readonly baselineFinalAcceptance: EvaluationRateInterval
    readonly difference: { readonly estimate: number; readonly low: number; readonly high: number }
    readonly nonInferiorityMargin: number
    readonly nonInferior: boolean
    readonly intervalMethod: 'MISSION_CLUSTER_BOOTSTRAP'
  }
  readonly covariateBalance: {
    readonly taskTypeOverlapRate: number
    readonly candidateMeanDifficulty: number
    readonly baselineMeanDifficulty: number
    readonly standardizedDifficultyDifference: number
    readonly balanced: boolean
    readonly notes: readonly string[]
  }
  readonly safety: {
    readonly candidateIncidents: number
    readonly baselineIncidents: number
    readonly hardGatePassed: boolean
    readonly reasons: readonly string[]
  }
  readonly efficiency: {
    readonly candidateTokensPerAcceptedOutcome: number
    readonly baselineTokensPerAcceptedOutcome: number
    readonly tokenImprovementRate?: number
    readonly candidateCostStatus: 'OBSERVED' | 'ESTIMATED' | 'PROVIDER_PRICING_UNAVAILABLE'
    readonly baselineCostStatus: 'OBSERVED' | 'ESTIMATED' | 'PROVIDER_PRICING_UNAVAILABLE'
    readonly candidateCostPerAcceptedOutcomeUsd?: number
    readonly baselineCostPerAcceptedOutcomeUsd?: number
    readonly candidateLatencyPerAcceptedOutcomeSeconds: number
    readonly baselineLatencyPerAcceptedOutcomeSeconds: number
    readonly latencyImprovementRate?: number
  }
  readonly decision:
    | 'NO_DATA'
    | 'EARLY_SIGNAL'
    | 'EXPLORATORY'
    | 'DECISION_ELIGIBLE'
    | 'REGRESSION_ALERT'
  readonly blockers: readonly string[]
}

export interface MilitaryPerformanceReport {
  readonly schemaVersion: '1.0.0'
  readonly reportId: PerformanceReportId
  readonly reportRevision: Revision
  readonly evaluationRequestId: EvaluationRequestId
  readonly requestHash: Sha256
  readonly datasetHash: Sha256
  readonly datasetArtifact: ArtifactRef
  readonly period: { readonly from: IsoDateTime; readonly to: IsoDateTime }
  readonly dataQuality: {
    readonly militarySessions: number
    readonly templateRevisions: number
    readonly uniqueAttempts: number
    readonly uniqueMissions: number
    readonly missingEventRate: number
    readonly notes: readonly string[]
  }
  readonly individualPerformance: readonly AgentTemplatePerformance[]
  readonly overallPerformance: {
    readonly missionCompletionRate: number
    readonly taskFinalAcceptanceRate: number
    readonly crossDepartmentHandoffRate: number
    readonly radioResolutionRate: number
    readonly freezeRecoveryRate: number
    readonly specsCommitCoverageRate: number
    readonly analysisPoints: readonly string[]
  }
  readonly comparisons: readonly EvaluationConfigurationComparison[]
  readonly decision: {
    readonly status:
      | 'NO_DATA'
      | 'EARLY_SIGNAL'
      | 'EXPLORATORY'
      | 'DECISION_ELIGIBLE'
      | 'REGRESSION_ALERT'
    readonly promotionAllowed: false
    readonly blockers: readonly string[]
    readonly recommendation: string
  }
  readonly priorityRecommendations: readonly {
    readonly priority: number
    readonly owner: string
    readonly action: string
    readonly successMetric: string
  }[]
  readonly unsupportedConclusions: readonly string[]
  readonly classification: DataClassification
  readonly sourceArtifactRefs: readonly ArtifactRef[]
  readonly createdAt: IsoDateTime
}

/** One immutable entry in the user-visible evaluation report lineage. */
export interface EvaluationReportRevisionSummary {
  readonly reportId: PerformanceReportId
  readonly reportRevision: Revision
  readonly evaluationRequestId: EvaluationRequestId
  readonly datasetHash: Sha256
  readonly state: 'CURRENT' | 'SUPERSEDED' | 'WITHDRAWN'
  readonly supersedesReportId?: PerformanceReportId
  readonly supersededByReportId?: PerformanceReportId
  readonly decisionStatus: MilitaryPerformanceReport['decision']['status']
  readonly uniqueAttempts: number
  readonly uniqueMissions: number
  readonly artifact: ArtifactRef
  readonly createdAt: IsoDateTime
}

export interface EvaluationRunSummary {
  readonly evaluationRequestId: EvaluationRequestId
  readonly state: import('./state-machines.js').EvaluationRunState
  readonly requestedBy: string
  readonly period: { readonly from: IsoDateTime; readonly to: IsoDateTime }
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
  readonly updatedAt: IsoDateTime
}

export interface EvaluationCenterSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly runs: readonly EvaluationRunSummary[]
  readonly reports: readonly EvaluationReportRevisionSummary[]
  readonly appeals: readonly import('./governance.js').PerformanceEvaluationAppeal[]
  readonly latestReport: MilitaryPerformanceReport | null
  readonly catalog: {
    readonly workspaces: readonly {
      readonly workspaceKey: string
      readonly label: string
      readonly sessionCount: number
    }[]
    readonly missions: readonly {
      readonly missionId: string
      readonly label: string
      readonly updatedAt: IsoDateTime
    }[]
  }
  readonly generatedAt: IsoDateTime
}
