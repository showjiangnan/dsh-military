export const MILITARY_OPERATIONS_SCHEMA_VERSION = '1.0.0' as const

export type DiagnosticSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'

export interface MilitaryDiagnosticSession {
  readonly sessionId: string
  readonly rootSessionId: string
  readonly parentSessionId?: string
  /** Exact Mission from an immutable execution binding, when one exists. */
  readonly missionId?: string
  readonly roleId: string
  readonly displayName: string
  readonly templateRevision: number
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly live: boolean
  readonly eventCount: number
  readonly errorCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly startedAt?: string
  readonly updatedAt?: string
}

export interface MilitaryOperationMission {
  readonly missionId: string
  readonly title: string
  readonly state: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  readonly revision: number
  readonly updatedAt: string
}

export type DiagnosticCategory =
  | 'LIFECYCLE'
  | 'MODEL'
  | 'TOOL'
  | 'AUTHORITY'
  | 'WORKSPACE'
  | 'RECEIPT'
  | 'PARENT_DELIVERY'

/**
 * A Host-redacted projection of immutable DSH Session events and Military
 * receipts. The browser never receives credentials, absolute paths, raw
 * provider headers, or mutable database handles.
 */
export interface MilitaryDiagnosticEvent {
  readonly id: string
  readonly sessionId: string
  readonly seq: number
  readonly occurredAt: string
  readonly turn?: number
  readonly step?: number
  readonly category: DiagnosticCategory
  readonly severity: DiagnosticSeverity
  readonly title: string
  readonly detail: string
  readonly roleId: string
  readonly taskId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly rawSelection?: {
    readonly name: string
    /** Secret- and path-redacted raw JSON text, bounded by the Host. */
    readonly arguments: string
  }
  readonly schema?: {
    readonly accepted: boolean
    readonly errorCode?: string
  }
  readonly hostCompletion?: {
    readonly bindingId?: string
    readonly missionId?: string
    readonly taskId?: string
    readonly taskVersion?: number
    readonly capabilityGrantId?: string
    readonly argumentsHash?: string
    readonly outcomeHash?: string
  }
  readonly receiptRef?: string
}

export interface MilitaryDiagnosticReport {
  readonly schemaVersion: typeof MILITARY_OPERATIONS_SCHEMA_VERSION
  readonly session: MilitaryDiagnosticSession
  readonly visibleTools: readonly string[]
  readonly events: readonly MilitaryDiagnosticEvent[]
  readonly summary: {
    readonly toolCalls: number
    readonly successfulToolCalls: number
    readonly failedToolCalls: number
    readonly correctedCalls: number
    readonly terminalCalls: number
    readonly parentWakeups: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly estimatedCostStatus: 'PROVIDER_PRICING_UNAVAILABLE'
    readonly latencyMs: number
  }
  readonly generatedAt: string
}

export type RecoveryHealthStatus = 'HEALTHY' | 'ATTENTION' | 'BLOCKED' | 'UNKNOWN'

export interface RecoveryHealthItem {
  readonly id:
    | 'SQLITE'
    | 'WAL'
    | 'BACKUPS'
    | 'PRESET'
    | 'MISSIONS'
    | 'TASKS'
    | 'CHILD_AGENTS'
    | 'WORKTREES'
    | 'RECEIPTS'
    | 'GRANTS'
    | 'OUTBOX'
    | 'COMMAND_SAGA'
    | 'RADIO'
    | 'LEASES'
    | 'RECOVERY_DRIFT'
    | 'CAPACITY'
    | 'TELEMETRY'
    | 'PROVIDERS'
    | 'SLO'
  readonly label: string
  readonly status: RecoveryHealthStatus
  readonly summary: string
  readonly count?: number
  readonly details: readonly string[]
}

export type RecoveryOperationKind =
  | 'VERIFY_DATABASE'
  | 'CREATE_BACKUP'
  | 'VERIFY_BACKUP'
  | 'DRILL_BACKUP_RESTORE'
  | 'RECONCILE'
  | 'REQUEUE_STALE_OUTBOX'
  | 'RELEASE_EXPIRED_RESOURCES'
  | 'WAKE_PARENT'
  | 'CANCEL_MISSION'

export interface RecoveryOperationPreview {
  readonly schemaVersion: typeof MILITARY_OPERATIONS_SCHEMA_VERSION
  readonly operation: RecoveryOperationKind
  readonly operationId: string
  readonly scope: string
  /** Present only for an explicit Mission cancellation preview. */
  readonly reason?: string
  /** Hash of the exact preview body and expected canonical state. */
  readonly previewHash: string
  /** CAS fence over the Host state that the proposed changes were computed from. */
  readonly expectedStateHash: string
  readonly expiresAt: string
  readonly confirmationPhrase: string
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH'
  readonly changes: readonly string[]
  readonly refusedChanges: readonly string[]
  readonly idempotent: true
  readonly generatedAt: string
}

export interface RecoveryOperationReceipt {
  readonly schemaVersion: typeof MILITARY_OPERATIONS_SCHEMA_VERSION
  readonly operation: RecoveryOperationKind
  readonly operationId: string
  readonly scope: string
  readonly reason?: string
  readonly status: 'COMPLETED' | 'FAILED'
  readonly changes: readonly string[]
  readonly evidence: readonly string[]
  readonly startedAt: string
  readonly completedAt: string
  readonly error?: string
}

export interface MilitaryOperationsSnapshot {
  readonly schemaVersion: typeof MILITARY_OPERATIONS_SCHEMA_VERSION
  readonly sessions: readonly MilitaryDiagnosticSession[]
  readonly missions: readonly MilitaryOperationMission[]
  readonly recovery: {
    readonly databasePathLabel: string
    readonly dataRootLabel: string
    readonly bundleVersion: string
    readonly dshRelease: '0.1.1-rc.2'
    readonly dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
    readonly items: readonly RecoveryHealthItem[]
    readonly production: ProductionPlaneSnapshot
    readonly recentReceipts: readonly RecoveryOperationReceipt[]
  }
  readonly generatedAt: string
}
import type { ProductionPlaneSnapshot } from './production-control.js'
