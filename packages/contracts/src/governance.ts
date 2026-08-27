import type {
  AgentIdentity,
  ArtifactRef,
  DataClassification,
  EvaluationAttemptRecord,
  IsoDateTime,
  MilitaryDepartmentId,
  PerformanceEvaluationRequest,
  ReasoningEffort,
  Revision,
  SessionId,
  Sha256,
} from './domain.js'

/** Immutable generation asset retained for RC.2 resume compatibility. */
export interface PresetGenerationManifest {
  readonly schemaVersion: '1.0.0'
  readonly presetId: 'military'
  readonly generation: string
  readonly assetHash: Sha256
  readonly bundleVersion: string
  readonly dshBaseline: {
    readonly release: '0.1.1-rc.2'
    readonly commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  }
  readonly publicSelectionId: 'military'
  readonly hiddenArchiveId: string
  readonly status: 'CURRENT' | 'ARCHIVED' | 'DEPRECATED'
  readonly files: readonly {
    readonly path: string
    readonly sha256: Sha256
    readonly byteLength: number
  }[]
  readonly createdAt: IsoDateTime
  readonly compatibility: {
    readonly mode: 'EXACT_RC2'
    readonly breaking: boolean
    readonly resumeSupported: boolean
  }
}

export interface PresetMigrationOrder {
  readonly schemaVersion: '1.0.0'
  readonly migrationOrderId: string
  readonly sessionId: SessionId
  readonly fromGeneration: string
  readonly toGeneration: string
  readonly strategy: 'REBIND_ARCHIVE' | 'EXPORT_IMPORT' | 'NEW_PRESET_ID'
  readonly reason: string
  readonly authorizedBy: string
  readonly authorizationReceiptRef: string
  readonly expectedSessionRevision: number
  readonly createdAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

export interface CompatibilityReport {
  readonly schemaVersion: '1.0.0'
  readonly reportId: string
  readonly dsh: {
    readonly release: '0.1.1-rc.2'
    readonly commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  }
  readonly capabilities: {
    readonly agentPresets: {
      readonly available: boolean
      readonly composeFrom: boolean
      readonly exactGenerationAccessible: boolean
    }
    readonly userQuestions: {
      readonly available: boolean
      readonly delegatedChildAllowed: boolean
    }
    readonly compaction: { readonly available: boolean; readonly eventContract: string }
    readonly subagents: {
      readonly continuable: boolean
      readonly report: boolean
      readonly callerReservedChildId: boolean
      readonly reportDeliveries: readonly ('quiet' | 'next-step')[]
      readonly selectiveDirectChildDrain: boolean
    }
    readonly commands: { readonly attachmentAwareInvocation: boolean; readonly imageAdmissionBeforeHandler: boolean }
    readonly deepseekAdapter: { readonly reasoningPassbackAllReasonedTurns: boolean; readonly imageInputByModelCapability: boolean }
    readonly sessionPersistence: { readonly available: boolean }
    readonly sessionEvents: { readonly externalRequiredTypeRegistration: boolean; readonly militaryAuthorityUsesOwnLedger: boolean }
    readonly settingsCards: { readonly available: boolean }
    readonly conversationNodes: { readonly available: boolean }
    readonly webClient: { readonly sharedSettingsDescribeMirror: boolean; readonly manifestDeclaredExternals: boolean; readonly conversationNodes: boolean }
  }
  readonly disposition: 'READY' | 'DEGRADED_READ_ONLY' | 'MIGRATION_REQUIRED' | 'UNSUPPORTED'
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
  readonly generatedAt: IsoDateTime
}

export interface MilitaryAuthorityContext {
  readonly schemaVersion: '1.0.0'
  readonly authorityContextId: string
  readonly principalId: string
  readonly tenantId: string
  readonly roles: readonly string[]
  readonly scopes: readonly string[]
  readonly sessionOwnership: readonly string[]
  readonly workspaceMemberships: readonly string[]
  readonly dataClassificationCeiling: DataClassification
  readonly authorizationReceiptRefs: readonly string[]
  readonly issuedAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

export interface UserAuthorizationReceipt {
  readonly schemaVersion: '1.0.0'
  readonly authorizationId: string
  readonly principalId: string
  readonly tenantId: string
  readonly action: string
  readonly resource: string
  readonly constraints: readonly string[]
  readonly issuedAt: IsoDateTime
  readonly expiresAt: IsoDateTime
  readonly revocable: boolean
  readonly sourceSessionId: string
  readonly sourceMessageId: string
  readonly contentHash: Sha256
}

export interface ToolProfile {
  readonly schemaVersion: '1.0.0'
  readonly toolProfileId: string
  readonly revision: Revision
  readonly status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly allowTools: readonly string[]
  readonly denyTools: readonly string[]
  /** Maximum calls simultaneously executing for one Agent under this profile. */
  readonly maxParallelCalls: number
  /** Exact tool-name deadlines in milliseconds; omitted tools inherit the DSH definition. */
  readonly timeoutOverrides: Readonly<Record<string, number>>
  readonly createdAt: IsoDateTime
}

export interface PermissionProfile {
  readonly schemaVersion: '1.0.0'
  readonly permissionProfileId: string
  readonly revision: Revision
  readonly status: 'DRAFT' | 'ACTIVE' | 'REVOKED' | 'RETIRED'
  readonly defaultDecision: 'DENY'
  readonly filesystem: {
    readonly readPaths: readonly string[]
    readonly writePaths: readonly string[]
    readonly denyPaths: readonly string[]
    readonly followSymlinks: boolean
  }
  readonly git: {
    readonly allowLocalRead: boolean
    readonly allowLocalMainCommit: boolean
    readonly allowBranchCreate: boolean
    readonly allowRemoteWrite: boolean
    readonly allowDestructiveReset: boolean
  }
  readonly network: {
    readonly allowGrantIds: readonly string[]
    readonly denyUnlisted: true
  }
  readonly classificationCeiling: DataClassification
  readonly createdAt: IsoDateTime
}

export interface EnterpriseApiGrant {
  readonly schemaVersion: '1.0.0'
  readonly grantId: string
  readonly revision: Revision
  readonly status: 'DRAFT' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  readonly gateway: string
  readonly methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  readonly resourcePatterns: readonly string[]
  readonly requestSchemaRef: string
  readonly responseSchemaRef: string
  readonly classificationCeiling: DataClassification
  readonly dataResidencyPolicyRef: string
  readonly credentialRef: string
  readonly redactionPolicyRef: string
  readonly rateLimitPerMinute: number
  readonly principalScopes: readonly string[]
  readonly createdAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

export interface DataResidencyPolicy {
  readonly schemaVersion: '1.0.0'
  readonly policyId: string
  readonly revision: Revision
  readonly status: 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly allowedRegions: readonly string[]
  readonly allowedProviders: readonly string[]
  readonly classificationCeiling: DataClassification
  readonly allowCrossBorder: boolean
  readonly retentionDays: number
  readonly createdAt: IsoDateTime
}

export interface RedactionPolicy {
  readonly schemaVersion: '1.0.0'
  readonly policyId: string
  readonly revision: Revision
  readonly status: 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly dropFields: readonly string[]
  readonly maskFields: readonly string[]
  readonly maxResponseBytes: number
  readonly promptInjectionIsolation: true
  readonly secretPatterns: readonly string[]
  readonly createdAt: IsoDateTime
}

export interface VerifierProfile {
  readonly schemaVersion: '1.0.0'
  readonly verifierProfileId: string
  readonly revision: Revision
  readonly status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly taskTypes: readonly string[]
  readonly checks: readonly {
    readonly checkId: string
    readonly kind: 'SCHEMA' | 'COMMAND' | 'TEST' | 'LINT' | 'TYPECHECK' | 'POLICY' | 'ARTIFACT' | 'SEMANTIC_READONLY'
    readonly required: boolean
    readonly timeoutSeconds: number
    readonly commandTemplate?: string
  }[]
  readonly acceptanceRule: 'ALL_REQUIRED' | 'WEIGHTED_WITH_REQUIRED'
  readonly createdAt: IsoDateTime
}

export interface ModelCapabilityProfile {
  readonly schemaVersion: '1.0.0'
  readonly profileId: string
  readonly revision: Revision
  readonly status: 'DRAFT' | 'CANARY' | 'VALIDATED' | 'DEPRECATED'
  readonly provider: string
  readonly model: string
  readonly supportedReasoning: readonly ('off' | 'low' | 'high' | 'max')[]
  readonly contextWindowTokens: number
  readonly maxOutputTokens: number
  readonly toolCalling: boolean
  readonly inputModalities: readonly ('text' | 'image')[]
  readonly reasoningPassback: 'all-reasoning-turns'
  readonly maximumRequestImageBytes?: number
  /** @deprecated migration hint; inputModalities is authoritative. */
  readonly vision?: boolean
  readonly dataResidencyPolicyRefs: readonly string[]
  readonly benchmarks: readonly {
    readonly taskType: string
    readonly reasoning: ReasoningEffort
    readonly sampleCount: number
    readonly finalAcceptanceRate: number
    readonly falseCompletionRate: number
  }[]
  readonly validatedAt: IsoDateTime
}

export interface GeneralExecutionPolicy {
  readonly schemaVersion: '1.0.0'
  readonly presetId: 'military'
  readonly defaultModel: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: 'high' | 'max'
    readonly maxOutputTokens: number
  }
  readonly modelSelection: {
    readonly userSessionSwitchEnabled: true
    readonly explicitSessionSelectionWins: true
    readonly rejectUnsupportedReasoning: true
    readonly recordSelectionEvent: true
    readonly allowGlobalDefaultFallback: boolean
  }
  readonly minimumReasoning: 'high' | 'max'
  /** Hard RC.2 model-loop boundary for the root General. */
  readonly maximumSteps: number
  readonly contextPolicy: {
    readonly contextBudgetTokens: number
    readonly compactionTriggerPercent: number
    readonly retainedTailTokens: number
    readonly minimumRearmDeltaPercent: number
    readonly maxCompactionAttemptsPerTurn: number
    readonly onCompactionFailure: 'PAUSE_AND_ESCALATE' | 'HANDOFF_GENERATION' | 'FAIL_TASK'
  }
  readonly fallback: {
    readonly enabled: boolean
    readonly compatibleProfileIds: readonly string[]
    readonly requireUserApprovalForRestrictedData: boolean
  }
  readonly dshBaseline: {
    readonly release: '0.1.1-rc.2'
    readonly commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  }
}

export interface ModelSelectionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: string
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'high' | 'max'
  readonly source: 'PRESET_DEFAULT' | 'NEW_SESSION_SELECTION' | 'SESSION_MODEL_SELECTOR' | 'RESUME'
  readonly previousProvider?: string
  readonly previousModel?: string
  readonly previousReasoningEffort?: 'high' | 'max'
  readonly capabilityProfileId: string
  readonly selectedBy: string
  readonly selectedAt: IsoDateTime
}

export interface WorkspaceSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly workspaceSnapshotId: string
  readonly tenantId: string
  readonly workspaceKey: string
  readonly rootPathHash: Sha256
  readonly git: {
    readonly repositoryId: string
    readonly head: string
    readonly branch: string
    readonly treeHash: string
    readonly dirtyStateHash: Sha256
  }
  readonly fileManifest: ArtifactRef
  readonly environmentArtifact: ArtifactRef
  readonly createdAt: IsoDateTime
}

export interface WorkspaceLease {
  readonly schemaVersion: '1.0.0'
  readonly workspaceLeaseId: string
  readonly tenantId: string
  readonly missionId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly agent: AgentIdentity
  readonly workspaceSnapshotId: string
  readonly mode: 'READ' | 'WRITE'
  readonly pathScope: {
    readonly readPaths: readonly string[]
    readonly writePaths: readonly string[]
    readonly forbiddenPaths: readonly string[]
  }
  readonly state: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED'
  readonly leaseVersion: number
  readonly acquiredAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

export interface CandidatePatch {
  readonly schemaVersion: '1.0.0'
  readonly candidatePatchId: string
  readonly candidateId: string
  readonly missionId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly baseWorkspaceSnapshotId: string
  readonly patchArtifact: ArtifactRef
  readonly changedPaths: readonly string[]
  readonly applyMode: 'GIT_BINARY_PATCH' | 'UNIFIED_DIFF' | 'CONTENT_MANIFEST'
  readonly preconditions: readonly string[]
  readonly patchHash: Sha256
  readonly createdAt: IsoDateTime
}

export interface IntegrationOrder {
  readonly schemaVersion: '1.0.0'
  readonly integrationOrderId: string
  readonly missionId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly candidatePatchId: string
  readonly targetBranch: 'main'
  readonly expectedHead: string
  readonly expectedTreeHash: string
  readonly conflictPolicy: 'STOP_AND_REPORT' | 'CREATE_REWORK_TASK'
  readonly verifierProfileRefs: readonly string[]
  readonly authorizedBy: string
  readonly createdAt: IsoDateTime
}

export interface IntegrationReceipt {
  readonly schemaVersion: '1.0.0'
  readonly integrationReceiptId: string
  readonly integrationOrderId: string
  readonly disposition: 'APPLIED' | 'CONFLICT' | 'REGRESSION_FAILED' | 'STALE'
  readonly beforeHead: string
  readonly afterHead?: string
  readonly commit?: string
  readonly treeHash?: string
  readonly checkReceiptRefs: readonly string[]
  readonly conflictReportRef?: string
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
}

/** Host-observed proof of a completed DSH tool dispatch. */
export interface ObservedToolCallReceipt {
  readonly schemaVersion: '1.0.0'
  readonly callId: string
  readonly rootCallId: string
  readonly agent: AgentIdentity
  readonly bindingId?: string
  readonly missionId?: string
  readonly taskId?: string
  readonly taskVersion?: number
  readonly toolName: string
  readonly argumentsHash: Sha256
  readonly outcomeHash: Sha256
  readonly isError: boolean
  readonly observedAt: IsoDateTime
}

export interface EvaluationDatasetManifest {
  readonly schemaVersion: '1.0.0'
  readonly evaluationRequestId: string
  readonly requestHash: Sha256
  readonly datasetHash: Sha256
  readonly datasetArtifact: ArtifactRef
  readonly generatorVersion: string
  readonly rubricVersion: string
  readonly timeRange: { readonly from: IsoDateTime; readonly to: IsoDateTime }
  readonly filters: {
    readonly tenantId: string
    readonly templateIds: readonly string[]
    readonly departments: readonly MilitaryDepartmentId[]
    readonly workspaceIds: readonly string[]
    readonly missionIds: readonly string[]
    readonly includeIncomplete: boolean
    readonly excludedAttemptIds: readonly string[]
    readonly actualPreset: 'military'
  }
  readonly includedSessions: readonly {
    readonly sessionId: string
    readonly rootSessionId: string
    readonly templateIds: readonly string[]
    readonly inclusionReason: string
  }[]
  readonly excludedSessions: readonly {
    readonly sessionId: string
    readonly reasonCode: string
    readonly details: string
  }[]
  readonly excludedAttempts: readonly {
    readonly attemptId: string
    readonly reasonCode: 'APPEAL_USER_CHALLENGE'
    readonly details: string
  }[]
  readonly strata: readonly { readonly key: string; readonly sampleCount: number; readonly weight: number }[]
  readonly missingness: readonly { readonly field: string; readonly count: number; readonly mechanism: 'MCAR' | 'MAR' | 'MNAR' | 'UNKNOWN' }[]
  readonly difficultyModelVersion: string
  readonly deidentificationPolicyRef: string
  readonly sampleWeightPolicy: string
  readonly sourceArtifactRefs: readonly string[]
  readonly attemptCount: number
  readonly missionCount: number
  readonly configurationCount: number
  readonly frozenAt: IsoDateTime
}

/** One immutable canonical input consumed by all deterministic evaluation stages. */
export interface FrozenEvaluationDataset {
  readonly schemaVersion: '1.0.0'
  readonly requestHash: Sha256
  readonly datasetHash: Sha256
  readonly request: PerformanceEvaluationRequest
  readonly attempts: readonly EvaluationAttemptRecord[]
  readonly includedSessions: EvaluationDatasetManifest['includedSessions']
  readonly excludedSessions: EvaluationDatasetManifest['excludedSessions']
  readonly excludedAttempts: EvaluationDatasetManifest['excludedAttempts']
  readonly strata: EvaluationDatasetManifest['strata']
  readonly missingness: EvaluationDatasetManifest['missingness']
  readonly sourceArtifactRefs: readonly string[]
}

export interface TacticalSourceSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly snapshotId: string
  readonly requestId: string
  readonly sourceKind: 'SESSION_RANGE' | 'DIRECT_TEXT' | 'ARTIFACT'
  readonly sourceOwnerId: string
  readonly sourceLicense: 'USER_OWNED' | 'ENTERPRISE_INTERNAL' | 'LICENSED' | 'UNKNOWN'
  readonly allowedUse: readonly ('PRIVATE_TACTIC' | 'WORKSPACE_TACTIC' | 'ORGANIZATION_TACTIC' | 'EVALUATION')[]
  readonly allowedAudience: readonly string[]
  readonly derivativeWorkAllowed: boolean
  readonly externalModelProcessingAllowed: boolean
  readonly retentionPolicyRef: string
  readonly revocationPolicyRef: string
  readonly sourceArtifact: ArtifactRef
  readonly sourceHash: Sha256
  readonly classification: DataClassification
  readonly redactionReceipt: ArtifactRef
  readonly promptInjectionScan: { readonly status: 'PASS' | 'WARN' | 'FAIL'; readonly findings: readonly string[] }
  readonly temporalValidity: {
    readonly validFrom: IsoDateTime
    readonly validUntil: IsoDateTime
    readonly dependencyVersions: readonly string[]
  }
  readonly sourcePresetId: string
  readonly createdAt: IsoDateTime
}

export interface KnowledgeRevocationOrder {
  readonly schemaVersion: '1.0.0'
  readonly revocationOrderId: string
  readonly snapshotId: string
  readonly reason: 'OWNER_REQUEST' | 'LICENSE_CHANGE' | 'SECURITY_INCIDENT' | 'PROVEN_INCORRECT' | 'RETENTION_EXPIRY'
  readonly requestedBy: string
  readonly authorizedBy: string
  readonly authorizationReceiptRef: string
  readonly affectedTacticVersions: readonly string[]
  readonly requiredActions: readonly ('QUARANTINE_TACTIC' | 'REVERIFY_TASKS' | 'REDACT_REPORTS' | 'DELETE_DERIVATIVES' | 'NOTIFY_USERS')[]
  readonly createdAt: IsoDateTime
}

export interface DecisionBrokerRecord {
  readonly schemaVersion: '1.0.0'
  readonly decisionSetId: string
  readonly rootSessionId: string
  readonly originAgentId: string
  readonly missionId: string
  readonly taskId?: string
  readonly taskVersion?: number
  readonly state: 'CREATED' | 'QUEUED' | 'PRESENTED' | 'PARTIALLY_ANSWERED' | 'ANSWERED' | 'EXPIRED' | 'CANCELLED' | 'SUPERSEDED' | 'STALE' | 'DELIVERY_FAILED'
  readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
  readonly questionSetRef: string
  readonly presentationId?: string
  readonly answerReceiptRef?: string
  readonly version: number
  readonly createdAt: IsoDateTime
  readonly expiresAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface CompactionAttempt {
  readonly schemaVersion: '1.0.0'
  readonly attemptId: string
  readonly agent: AgentIdentity
  readonly rootSessionId: string
  readonly templateId?: string
  readonly templateRevision?: number
  readonly pressureGeneration: number
  readonly contextBudgetTokens: number
  readonly thresholdTokens: number
  readonly meterTokens: number
  readonly trigger: 'PRESSURE' | 'CONTEXT_OVERFLOW' | 'MANUAL' | 'HANDOFF'
  readonly safeBoundary: {
    readonly toolPairsBalanced: boolean
    readonly candidateTransactionIdle: boolean
    readonly gitTransactionIdle: boolean
    readonly freezeStateStable: boolean
  }
  readonly outcome: 'PENDING' | 'SUCCEEDED' | 'NO_SAFE_RANGE' | 'FAILED' | 'CANCELLED'
  readonly dshCompactionId?: string
  readonly summaryEventSeq?: number
  readonly errorCode?: string
  readonly createdAt: IsoDateTime
  readonly completedAt?: IsoDateTime
}

export interface ChangeOrder {
  readonly schemaVersion: '1.0.0'
  readonly changeOrderId: string
  readonly missionId: string
  readonly expectedMissionRevision: number
  readonly reason: string
  readonly requestedBy: string
  readonly authorizedBy: string
  readonly authorizationReceiptRef: string
  readonly changes: readonly {
    readonly targetType: 'MISSION' | 'DIRECTION' | 'WAVE' | 'TASK' | 'ACCEPTANCE_CONTRACT' | 'BUDGET'
    readonly targetId: string
    readonly operation: 'ADD' | 'REVISE' | 'CANCEL' | 'REPRIORITIZE' | 'REAUTHORIZE'
    readonly summary: string
  }[]
  readonly impact: {
    readonly cancelTaskIds: readonly string[]
    readonly invalidateCandidateIds: readonly string[]
    readonly staleGuidanceIds: readonly string[]
    readonly requiresUserDecision: boolean
  }
  readonly createdAt: IsoDateTime
}

export interface ResourceBudgetPolicy {
  readonly schemaVersion: '1.0.0'
  readonly policyId: string
  readonly revision: Revision
  readonly status: 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly scope: 'DEPLOYMENT' | 'TENANT' | 'MISSION' | 'WAVE' | 'TASK'
  readonly limits: {
    readonly modelRequests: number
    readonly reasoningTokens: number
    readonly wallClockSeconds: number
    readonly toolCalls: number
    readonly apiCalls: number
    readonly concurrentAgents: number
    readonly radioRounds: number
    readonly reworkAttempts: number
    readonly storageBytes: number
  }
  readonly warningPercent: number
  readonly hardStopPercent: 100
  readonly disposition: 'PAUSE_AND_REPORT' | 'REQUIRE_USER_AUTHORIZATION' | 'DEGRADE_NONCRITICAL_RESEARCH' | 'CANCEL_SPECULATIVE_TASKS'
  readonly createdAt: IsoDateTime
}

export interface BundleLifecycleReceipt {
  readonly schemaVersion: '1.0.0'
  readonly operationId: string
  readonly operation: 'INSTALL' | 'UPGRADE' | 'ROLLBACK' | 'DISABLE' | 'UNINSTALL' | 'REINSTALL'
  readonly fromVersion: string
  readonly toVersion: string
  readonly profileRevisionBefore: string
  readonly profileRevisionAfter: string
  readonly presetGenerationRefs: readonly string[]
  readonly dataDisposition: 'RETAINED' | 'EXPORTED_AND_REMOVED' | 'REMOVED' | 'NOT_APPLICABLE'
  readonly validationReportRef: string
  readonly status: 'SUCCEEDED' | 'ROLLED_BACK' | 'FAILED'
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
}

/** Immutable effective configuration used to construct one non-General agent. */
export interface AgentExecutionBinding {
  readonly schemaVersion: '1.0.0'
  readonly bindingId: string
  readonly tenantId: string
  readonly rootSessionId: string
  readonly missionId: string
  readonly agent: AgentIdentity
  readonly departmentId: MilitaryDepartmentId
  readonly templateId: string
  readonly templateRevision: Revision
  readonly presetGeneration: string
  /** Short-lived zero-trust grant consumed at every department tool invocation. */
  readonly capabilityGrantId: string
  /**
   * Durable live-capacity reservation held for the complete child lifecycle.
   * The host releases it only after the exact RC.2 child leaves the Agent
   * registry (or child startup rolls back).
   */
  readonly concurrencyReservationId: string
  readonly executionStrategy: import('./kernel.js').ExecutionStrategy
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: ReasoningEffort
  readonly modelCapabilityProfileId: string
  readonly toolProfile: { readonly id: string; readonly revision: Revision }
  readonly permissionProfile: { readonly id: string; readonly revision: Revision }
  readonly apiGrants: readonly { readonly id: string; readonly revision: Revision }[]
  readonly dataResidencyPolicy: { readonly id: string; readonly revision: Revision }
  readonly redactionPolicy: { readonly id: string; readonly revision: Revision }
  readonly verifierProfiles: readonly { readonly id: string; readonly revision: Revision }[]
  readonly workspace?: {
    readonly leaseId: string
    readonly snapshotId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly executionRootHash: Sha256
  }
  readonly contextPolicy: {
    readonly contextBudgetTokens: number
    readonly compactionTriggerPercent: number
    readonly retainedTailTokens: number
    readonly minimumRearmDeltaPercent: number
    readonly maxCompactionAttemptsPerTurn: number
    readonly onCompactionFailure: 'PAUSE_AND_ESCALATE' | 'HANDOFF_GENERATION' | 'FAIL_TASK'
  }
  readonly resourceBudgetPolicy: { readonly id: string; readonly revision: Revision }
  readonly createdAt: IsoDateTime
}

/** Durable result of resolving one persisted Military Session to an exact RC.2 preset generation. */
export interface PresetResumeReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: string
  readonly sessionId: string
  readonly requestedGeneration: string
  readonly resolvedGeneration?: string
  readonly disposition: 'MATCHED' | 'ARCHIVE_REBOUND' | 'QUARANTINED' | 'MIGRATION_REQUIRED'
  readonly archiveAssetHash?: Sha256
  readonly compatibilityReportId: string
  readonly migrationOrderId?: string
  readonly modelSelectionReceiptId?: string
  readonly dshBaseline: {
    readonly release: '0.1.1-rc.2'
    readonly commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  }
  readonly reason: string
  readonly evidenceRefs: readonly string[]
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
}

export interface ResourceCounters {
  readonly modelRequests: number
  readonly reasoningTokens: number
  readonly wallClockSeconds: number
  readonly toolCalls: number
  readonly apiCalls: number
  readonly concurrentAgents: number
  readonly radioRounds: number
  readonly reworkAttempts: number
  readonly storageBytes: number
}

/** Compare-and-set reservation against one versioned resource budget policy. */
export interface ResourceBudgetReservation {
  readonly schemaVersion: '1.0.0'
  readonly reservationId: string
  readonly tenantId: string
  readonly scopeType: 'DEPLOYMENT' | 'TENANT' | 'MISSION' | 'WAVE' | 'TASK'
  readonly scopeId: string
  readonly policyId: string
  readonly policyRevision: Revision
  readonly ownerAgent: AgentIdentity
  readonly requested: ResourceCounters
  readonly granted: ResourceCounters
  readonly state: 'RESERVED' | 'SETTLED' | 'EXPIRED' | 'REVOKED' | 'REJECTED'
  readonly idempotencyKey: string
  readonly reservedAt: IsoDateTime
  readonly expiresAt: IsoDateTime
}

/** Deterministic settlement of actual resource usage against a reservation. */
export interface ResourceUsageReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: string
  readonly reservationId: string
  readonly scopeType: 'DEPLOYMENT' | 'TENANT' | 'MISSION' | 'WAVE' | 'TASK'
  readonly scopeId: string
  readonly actual: ResourceCounters
  readonly overages: ResourceCounters
  readonly disposition: 'SETTLED' | 'PARTIAL' | 'OVER_BUDGET' | 'CANCELLED'
  readonly sourceEventIds: readonly string[]
  readonly idempotencyKey: string
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
}

/** User-authorized challenge to a frozen performance report revision. */
export interface PerformanceEvaluationAppeal {
  readonly schemaVersion: '1.0.0'
  readonly appealId: string
  readonly reportId: string
  readonly reportRevision: Revision
  readonly tenantId: string
  readonly submittedBy: string
  readonly grounds: 'DATASET_ERROR' | 'RUBRIC_ERROR' | 'ATTRIBUTION_ERROR' | 'MISSING_CONTEXT' | 'OTHER'
  readonly statement: string
  readonly challengedFindings: readonly {
    readonly path: string
    readonly reason: string
    readonly evidenceRefs: readonly string[]
  }[]
  readonly requestedRemedy: 'RECOMPUTE_DATASET' | 'RE_EVALUATE_TEMPLATE' | 'RE_SYNTHESIZE_REPORT' | 'ANNOTATE_REPORT' | 'NO_CHANGE_REVIEW'
  readonly authorizationReceiptRef: string
  readonly state: 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'PARTIALLY_UPHELD' | 'DENIED' | 'WITHDRAWN'
  readonly submittedAt: IsoDateTime
  readonly resolvedAt?: IsoDateTime
  readonly resolutionSummary?: string
  readonly supersedingReportId?: string
}
