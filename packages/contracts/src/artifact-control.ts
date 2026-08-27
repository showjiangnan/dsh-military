import type {
  ArtifactId,
  DataClassification,
  IsoDateTime,
  Sha256,
} from './domain.js'

export interface ArtifactAccessReference {
  readonly schemaVersion: '1.0.0'
  readonly referenceId: string
  readonly artifactId: ArtifactId
  readonly contentHash: Sha256
  readonly tenantId: string
  readonly missionId?: string
  readonly taskId?: string
  readonly classification: DataClassification
  readonly ownerPrincipalId: string
  readonly audiencePrincipalIds: readonly string[]
  readonly audienceScopes: readonly string[]
  readonly grantId?: string
  readonly residencyPolicyRef: string
  readonly retentionUntil?: IsoDateTime
  readonly expiresAt?: IsoDateTime
  readonly legalHoldIds: readonly string[]
  readonly lineageReferenceIds: readonly string[]
  readonly createdAt: IsoDateTime
  readonly deletedAt?: IsoDateTime
}

export interface ArtifactAccessContext {
  readonly tenantId: string
  /** Exact workflow scope; required when the reference is Mission-bound. */
  readonly missionId?: string
  /** Exact Task scope; required when the reference is Task-bound. */
  readonly taskId?: string
  readonly principalId: string
  readonly scopes: readonly string[]
  readonly grantIds: readonly string[]
  readonly classificationCeiling: DataClassification
  readonly now?: IsoDateTime
}

export interface ArtifactDeletionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly deletionReceiptId: string
  readonly referenceId: string
  readonly artifactId: ArtifactId
  readonly tenantId: string
  readonly disposition:
    | 'REFERENCE_DELETED'
    | 'CONTENT_GARBAGE_COLLECTED'
    | 'LEGAL_HOLD_BLOCKED'
    | 'RETENTION_BLOCKED'
  readonly contentDeleted: boolean
  readonly reason: string
  readonly completedAt: IsoDateTime
}

export interface ArtifactGarbageCollectionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly operationId: string
  readonly scannedContent: number
  readonly deletedContent: number
  readonly retainedContent: number
  readonly deletionReceiptIds: readonly string[]
  readonly completedAt: IsoDateTime
}

export interface ArtifactKeyRotationReceipt {
  readonly schemaVersion: '1.0.0'
  readonly operationId: string
  readonly fromKeyId: string
  readonly toKeyId: string
  readonly rotatedContent: number
  readonly completedAt: IsoDateTime
}

export interface ArtifactDispatchPolicyReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: string
  readonly referenceIds: readonly string[]
  readonly tenantId: string
  readonly missionId: string
  readonly taskId?: string
  readonly provider: string
  readonly model: string
  readonly dispatch: {
    readonly agentId: string
    readonly agentGeneration: number
    readonly turn: number
    readonly step: number
  }
  /**
   * Immutable price observation captured before the provider request.  Cost
   * accounting may only use this snapshot; a later catalog price is never
   * retroactively applied to historical usage.
   */
  readonly pricingSnapshot: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE'
    readonly currency: 'USD'
    readonly version: string
    readonly observedAt: IsoDateTime
    readonly inputPerMillionTokens?: number
    readonly outputPerMillionTokens?: number
  }
  readonly classification: DataClassification
  readonly residencyPolicyRef: string
  readonly redactionPolicyRef: string
  readonly policyRevision: number
  readonly disposition: 'ALLOWED' | 'DENIED'
  readonly evidenceRefs: readonly string[]
  readonly createdAt: IsoDateTime
}
