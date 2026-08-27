import type {
  DataClassification,
  IsoDateTime,
  MissionId,
  Revision,
  Sha256,
  TaskId,
  TaskVersion,
} from './domain.js'

export type VerificationTier = 'V0' | 'V1' | 'V2' | 'V3' | 'V4'
export type ExecutionParadigm = 'direct' | 'react' | 'plan-execute' | 'reflection' | 'multi-agent'

export interface MissionCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly schemaVersion: '1.0.0'
  readonly commandId: string
  readonly idempotencyKey: string
  readonly tenantId: string
  readonly missionId: MissionId
  readonly expectedRevision: Revision
  readonly actorAuthorityRef: string
  readonly actor: import('./domain.js').AgentIdentity
  readonly taskId?: TaskId
  readonly taskVersion?: TaskVersion
  readonly activationId?: string
  readonly type: string
  readonly payload: TPayload
  readonly payloadSha256: Sha256
  readonly deadlineAt?: IsoDateTime
  readonly createdAt: IsoDateTime
}

export interface MissionCommandReceipt {
  readonly commandId: string
  readonly missionId: MissionId
  readonly previousRevision: Revision
  readonly revision: Revision
  readonly eventIds: readonly string[]
  readonly activityIds: readonly string[]
  readonly duplicate: boolean
}

export interface ContextManifestSection {
  readonly kind: 'CONSTITUTION' | 'STATE' | 'EVIDENCE' | 'WORKING'
  readonly contentRef: string
  readonly sha256: Sha256
  readonly tokenEstimate: number
  readonly sourceEventIds?: readonly string[]
  readonly summaryCoverageRefs?: readonly string[]
}

export interface ContextManifest {
  readonly schemaVersion: '1.0.0'
  readonly manifestId: string
  readonly missionId: MissionId
  readonly missionRevision: Revision
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly sections: readonly ContextManifestSection[]
  readonly omittedEvidenceRefs: readonly string[]
  readonly tokenAllocation: {
    readonly constitution: number
    readonly state: number
    readonly evidence: number
    readonly working: number
    readonly reasoningPassbackReserve: number
    readonly imageReserve: number
  }
  readonly contentSha256: Sha256
  readonly createdAt: IsoDateTime
}

export interface AcceptanceClaim {
  readonly claimId: string
  readonly statement: string
  readonly type: 'implementation' | 'behavior' | 'security' | 'compatibility' | 'performance' | 'documentation'
  readonly required: boolean
  readonly minimumTier: VerificationTier
}

export interface ClaimEvidenceLink {
  readonly claimId: string
  readonly evidenceRef: string
  readonly supports: boolean
  readonly tier: VerificationTier
  readonly validityScope?: string
  readonly producedAtRevision: Revision
  readonly expiresAt?: IsoDateTime
}

export interface ClaimEvidenceGraph {
  readonly schemaVersion: '1.0.0'
  readonly graphId: string
  readonly candidateId: string
  readonly claims: readonly AcceptanceClaim[]
  readonly links: readonly ClaimEvidenceLink[]
  readonly createdAt: IsoDateTime
}

export interface TaskCapabilityProfile {
  readonly schemaVersion: '1.0.0'
  readonly profileId: string
  readonly semanticCapabilities: readonly string[]
  readonly toolCapabilities: readonly string[]
  readonly minimumReasoning: 'low' | 'high' | 'max'
  readonly minimumContextTokens: number
  readonly inputModalities: readonly ('text' | 'image')[]
  readonly riskClass: 'low' | 'medium' | 'high' | 'critical'
  readonly requiredVerificationTier: VerificationTier
  readonly parallelismInputs: {
    readonly independentSubproblems: number
    readonly independentEvidenceSources: number
    readonly sharedContext: number
    readonly writeConflict: number
    readonly temporalDependency: number
    readonly joinCost: number
    readonly integrationRisk: number
  }
}

export interface ExecutionStrategy {
  readonly schemaVersion: '1.0.0'
  readonly strategyId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'low' | 'high' | 'max'
  readonly paradigm: ExecutionParadigm
  readonly maximumSteps: number
  readonly verificationTier: VerificationTier
  readonly parallelism: number
  readonly rationale: readonly string[]
}

export interface CapabilityGrant {
  readonly schemaVersion: '1.0.0'
  readonly grantId: string
  readonly principalId: string
  readonly activationId: string
  readonly missionId: MissionId
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly allowedTools: readonly string[]
  readonly resourcePatterns: readonly string[]
  readonly dataClassificationCeiling: DataClassification
  readonly maximumUses: number
  readonly uses: number
  readonly issuedAt: IsoDateTime
  readonly expiresAt: IsoDateTime
  readonly nonce: string
  readonly state: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED'
}

export interface HumanAttentionBudget {
  readonly missionId: MissionId
  readonly maximumRounds: number
  readonly maximumQuestions: number
  readonly reservedHighRiskQuestions: number
  readonly askedRounds: number
  readonly askedQuestions: number
  readonly timeoutSeconds: number
  readonly state: 'ACTIVE' | 'EXHAUSTED' | 'CLOSED'
}
