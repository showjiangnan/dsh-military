import type { DataClassification, IsoDateTime } from './domain.js'

export type ProductionProviderKind =
  | 'LEDGER'
  | 'OBJECT_STORE'
  | 'QUEUE'
  | 'KEY_MANAGEMENT'
  | 'CAPACITY'
  | 'TELEMETRY'
  | 'BACKUP'
  | 'ASSET_SIGNING'
  | 'RESIDENCY'

/**
 * Truthful declaration of one installed production seam. A provider being
 * selectable is not the same as it being distributed or externally managed.
 */
export interface ProductionProviderDescriptor {
  readonly schemaVersion: '1.0.0'
  readonly providerId: string
  readonly kind: ProductionProviderKind
  readonly implementation: string
  readonly deployment: 'EMBEDDED' | 'EXTERNAL'
  readonly status: 'READY' | 'DEGRADED' | 'UNCONFIGURED'
  readonly durability:
    | 'PROCESS'
    | 'LOCAL_DISK'
    | 'REGIONAL'
    | 'MULTI_REGION'
  readonly tenantIsolation:
    | 'APPLICATION_ROW'
    | 'DATABASE'
    | 'SCHEMA'
    | 'BUCKET_PREFIX'
    | 'EXTERNAL_POLICY'
    | 'NONE'
  readonly capabilities: readonly string[]
  readonly limitations: readonly string[]
}

export interface MilitaryCorrelationContext {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly tenantId: string
  readonly requestId?: string
  readonly missionId?: string
  readonly taskId?: string
  readonly attemptId?: string
  readonly activationId?: string
  readonly dispatchId?: string
  readonly operationId?: string
}

export interface MilitarySpanRecord {
  readonly schemaVersion: '1.0.0'
  readonly name: string
  readonly context: MilitaryCorrelationContext
  readonly status: 'OK' | 'ERROR' | 'CANCELLED'
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
  readonly durationMs: number
  readonly errorCode?: string
}

export interface MilitaryMetricPoint {
  readonly schemaVersion: '1.0.0'
  readonly name: string
  readonly kind: 'COUNTER' | 'GAUGE' | 'HISTOGRAM'
  readonly value: number
  readonly unit: string
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly context?: MilitaryCorrelationContext
  readonly recordedAt: IsoDateTime
}

export interface MilitaryLogRecord {
  readonly schemaVersion: '1.0.0'
  readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  readonly message: string
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly context?: MilitaryCorrelationContext
  readonly recordedAt: IsoDateTime
}

export interface MilitaryTelemetrySnapshot {
  readonly schemaVersion: '1.0.0'
  readonly exporter:
    | 'LOCAL_BOUNDED'
    | 'OTEL_CONFIGURED'
    | 'OTEL_DEGRADED'
  readonly spans: readonly MilitarySpanRecord[]
  readonly metrics: readonly MilitaryMetricPoint[]
  readonly logs: readonly MilitaryLogRecord[]
  readonly droppedRecords: number
  readonly generatedAt: IsoDateTime
}

/**
 * Vendor-neutral OpenTelemetry seam. Production may bind an OTLP exporter;
 * local mode retains only a bounded diagnostic ring.
 */
export interface MilitaryTelemetry {
  currentContext(): MilitaryCorrelationContext | null
  withSpan<T>(
    input: {
      readonly name: string
      readonly tenantId: string
      readonly parent?: MilitaryCorrelationContext
      readonly requestId?: string
      readonly missionId?: string
      readonly taskId?: string
      readonly attemptId?: string
      readonly activationId?: string
      readonly dispatchId?: string
      readonly operationId?: string
      readonly attributes?: Readonly<
        Record<string, string | number | boolean>
      >
    },
    operation: () => Promise<T>,
  ): Promise<T>
  recordMetric(input: {
    readonly name: string
    readonly kind: MilitaryMetricPoint['kind']
    readonly value: number
    readonly unit: string
    readonly attributes?: MilitaryMetricPoint['attributes']
    readonly context?: MilitaryCorrelationContext
  }): void
  log(input: {
    readonly level: MilitaryLogRecord['level']
    readonly message: string
    readonly attributes?: MilitaryLogRecord['attributes']
    readonly context?: MilitaryCorrelationContext
  }): void
  snapshot(): MilitaryTelemetrySnapshot
}

export interface CapacityVector {
  readonly activeTasks: number
  readonly activeAgents: number
  readonly modelConcurrency: number
  readonly pendingOutbox: number
  readonly storageBytes: number
}

export interface TenantCapacityLimits extends CapacityVector {
  readonly tenantId: string
  readonly revision: number
}

export interface CapacityAdmissionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly reservationId: string
  readonly tenantId: string
  readonly payloadHash: string
  readonly requested: CapacityVector
  readonly limits: TenantCapacityLimits
  readonly usageAfterAdmission: CapacityVector
  readonly state: 'ACTIVE' | 'RELEASED'
  readonly admittedAt: IsoDateTime
  readonly releasedAt?: IsoDateTime
}

export interface CapacitySnapshot {
  readonly schemaVersion: '1.0.0'
  readonly tenantId: string
  readonly limits: TenantCapacityLimits
  readonly usage: CapacityVector
  readonly activeReservations: number
  readonly saturation: Readonly<Record<keyof CapacityVector, number>>
  readonly generatedAt: IsoDateTime
}

export interface MilitaryCapacityControl {
  configure(limits: TenantCapacityLimits): Promise<TenantCapacityLimits>
  admit(input: {
    readonly reservationId: string
    readonly tenantId: string
    readonly payloadHash: string
    readonly requested: CapacityVector
  }): Promise<CapacityAdmissionReceipt>
  release(
    reservationId: string,
    tenantId: string,
  ): Promise<CapacityAdmissionReceipt>
  snapshot(tenantId: string): Promise<CapacitySnapshot>
}

export interface DurableQueueMessage {
  readonly queueMessageId: string
  readonly tenantId: string
  readonly topic: string
  readonly partitionKey: string
  readonly eventId: string
  readonly payload: unknown
  readonly attempts: number
}

export type DurableQueueHandler = (
  message: DurableQueueMessage,
) => Promise<void>

export interface DurableQueueDispatchResult {
  readonly delivered: number
  readonly failed: number
  readonly deadLettered: number
  readonly remaining: number
}

/**
 * Durable-effect queue seam shared by the SQLite outbox and external broker
 * adapters. Enqueue is idempotent by tenant/topic/eventId, dispatch preserves
 * partition order, and handler success must precede the durable offset.
 */
export interface MilitaryDurableQueue {
  register(topic: string, handler: DurableQueueHandler): void
  enqueue(input: {
    readonly topic: string
    readonly partitionKey: string
    readonly eventId: string
    readonly payload: unknown
    readonly availableAt?: string
  }): void
  dispatchAvailable(input?: {
    readonly workerId?: string
    readonly limit?: number
    readonly leaseMs?: number
    readonly maximumAttempts?: number
  }): Promise<DurableQueueDispatchResult>
}

export interface BackupManifest {
  readonly schemaVersion: '1.0.0'
  readonly backupId: string
  readonly tenantId: string
  readonly providerId: string
  readonly sourceRevision: string
  readonly byteLength: number
  readonly sha256: string
  readonly status: 'CREATED' | 'VERIFIED' | 'DRILL_PASSED' | 'DRILL_FAILED'
  readonly createdAt: IsoDateTime
  readonly verifiedAt?: IsoDateTime
  readonly lastDrillAt?: IsoDateTime
  readonly evidence: readonly string[]
  readonly signature?: AssetSignatureReceipt
  readonly error?: string
}

export interface MilitaryBackupControl {
  create(input: {
    readonly operationId: string
    readonly tenantId: string
  }): Promise<BackupManifest>
  verify(backupId: string, tenantId: string): Promise<BackupManifest>
  /**
   * Restores into an isolated disposable target, verifies it and removes it.
   * This never overwrites the live database.
   */
  restoreDrill(
    backupId: string,
    tenantId: string,
  ): Promise<BackupManifest>
  list(tenantId: string): Promise<readonly BackupManifest[]>
}

export interface AssetSignatureReceipt {
  readonly schemaVersion: '1.0.0'
  readonly keyId: string
  readonly algorithm: 'Ed25519'
  readonly payloadSha256: string
  readonly signature: string
  readonly signedAt: IsoDateTime
}

export interface MilitaryAssetSigner {
  sign(payload: Uint8Array): Promise<AssetSignatureReceipt>
  verify(
    payload: Uint8Array,
    receipt: AssetSignatureReceipt,
  ): Promise<boolean>
  publicKey(keyId: string): Promise<string>
}

export interface ResidencyDecisionReceipt {
  readonly schemaVersion: '1.0.0'
  readonly decisionId: string
  readonly tenantId: string
  readonly providerId: string
  readonly classification: DataClassification
  readonly requiredRegions: readonly string[]
  readonly observedRegions: readonly string[]
  readonly disposition: 'ALLOWED' | 'DENIED'
  readonly policyRevision: string
  readonly decidedAt: IsoDateTime
  readonly reason: string
}

export interface MilitaryResidencyControl {
  authorize(input: {
    readonly tenantId: string
    readonly providerId: string
    readonly classification: DataClassification
    readonly requiredRegions: readonly string[]
    readonly observedRegions: readonly string[]
    readonly policyRevision: string
  }): Promise<ResidencyDecisionReceipt>
}

export interface ProductionPlaneSnapshot {
  readonly schemaVersion: '1.0.0'
  readonly providers: readonly ProductionProviderDescriptor[]
  readonly telemetry: MilitaryTelemetrySnapshot
  readonly capacity: CapacitySnapshot
  readonly backups: readonly BackupManifest[]
  readonly generatedAt: IsoDateTime
}

/**
 * Explicit production-plane composition. PostgreSQL ledgers, remote object
 * stores, queues and KMS-backed signers plug in behind the same application
 * contracts; the embedded SQLite/filesystem composition reports its limits.
 */
export interface MilitaryProductionPlane {
  readonly providers: readonly ProductionProviderDescriptor[]
  readonly telemetry: MilitaryTelemetry
  readonly capacity: MilitaryCapacityControl
  readonly queue: MilitaryDurableQueue
  readonly backups: MilitaryBackupControl
  readonly signer: MilitaryAssetSigner
  readonly residency: MilitaryResidencyControl
  snapshot(tenantId: string): Promise<ProductionPlaneSnapshot>
}

export type ProductionDeploymentTarget =
  | 'LOCAL_SINGLE_HOST'
  | 'DISTRIBUTED_REGIONAL'
  | 'DISTRIBUTED_MULTI_REGION'

export interface ProductionReadinessReport {
  readonly schemaVersion: '1.0.0'
  readonly target: ProductionDeploymentTarget
  readonly ready: boolean
  readonly providerIds: readonly string[]
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}
