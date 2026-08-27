export const MILITARY_RUNTIME_CONTROL_SCHEMA_VERSION = '1.0.0' as const

export type MilitaryRuntimeProjectionHealth =
  | 'FRESH'
  | 'STALE'
  | 'DEGRADED'
  | 'BLOCKED'

export type MilitaryRuntimeNodeKind =
  | 'REQUEST'
  | 'MISSION'
  | 'DIRECTION'
  | 'WAVE'
  | 'TASK'
  | 'ATTEMPT'
  | 'ACTIVATION'
  | 'DISPATCH'
  | 'CANDIDATE'
  | 'VERIFICATION'
  | 'INTEGRATION'

export interface MilitaryRuntimeNode {
  readonly id: string
  readonly kind: MilitaryRuntimeNodeKind
  readonly parentId?: string
  readonly label: string
  readonly state: string
  readonly revision: number
  readonly updatedAt: string
  readonly taskId?: string
  readonly attemptId?: string
  readonly nextTool?: string
  readonly receiptRefs: readonly string[]
}

export interface MilitaryRuntimeQueueItem {
  readonly id: string
  readonly kind: 'RADIO' | 'DECISION'
  readonly missionId: string
  readonly taskId?: string
  readonly attemptId?: string
  readonly state: string
  readonly priority?: string
  readonly updatedAt: string
  readonly expiresAt?: string
}

export interface MilitaryRuntimeBudgetView {
  readonly scope: string
  readonly consumed: Readonly<Record<string, number>>
  readonly reserved: Readonly<Record<string, number>>
  readonly status: 'AVAILABLE' | 'EXHAUSTED' | 'UNKNOWN'
}

export interface MilitaryRuntimeReceiptView {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly updatedAt: string
  readonly correlationId?: string
}

export interface MilitaryRuntimeProjectionMetadata {
  readonly sourceRevision: number
  readonly generatedAt: string
  readonly staleAfter: string
  readonly health: MilitaryRuntimeProjectionHealth
  readonly warnings: readonly string[]
}

/**
 * Read-only projection over canonical production providers. Every item keeps
 * its durable identity; the browser never infers lifecycle transitions.
 */
export interface MilitaryRuntimeCenterSnapshot {
  readonly schemaVersion: typeof MILITARY_RUNTIME_CONTROL_SCHEMA_VERSION
  readonly authority: import('./principal.js').MilitaryWebPrincipal
  readonly projection: MilitaryRuntimeProjectionMetadata
  readonly nodes: readonly MilitaryRuntimeNode[]
  readonly queues: readonly MilitaryRuntimeQueueItem[]
  readonly budgets: readonly MilitaryRuntimeBudgetView[]
  readonly receipts: readonly MilitaryRuntimeReceiptView[]
  readonly outbox: {
    readonly pending: number
    readonly claimed: number
    readonly deadLettered: number
    readonly oldestPendingAt?: string
  }
}
