import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto'
import {
  MilitaryError,
  type AssetSignatureReceipt,
  type BackupManifest,
  type CapacityAdmissionReceipt,
  type CapacitySnapshot,
  type CapacityVector,
  type DurableQueueDispatchResult,
  type DurableQueueHandler,
  type DurableQueueMessage,
  type MilitaryAssetSigner,
  type MilitaryBackupControl,
  type MilitaryCapacityControl,
  type MilitaryDurableQueue,
  type MilitaryCorrelationContext,
  type MilitaryLogRecord,
  type MilitaryMetricPoint,
  type MilitaryProductionPlane,
  type MilitaryResidencyControl,
  type MilitarySpanRecord,
  type MilitaryTelemetry,
  type MilitaryTelemetrySnapshot,
  type ProductionPlaneSnapshot,
  type ProductionDeploymentTarget,
  type ProductionReadinessReport,
  type ProductionProviderDescriptor,
  type ResidencyDecisionReceipt,
  type TenantCapacityLimits,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, sha256, stableJson } from './util.js'

type TelemetryRecord =
  | { readonly kind: 'SPAN'; readonly value: MilitarySpanRecord }
  | { readonly kind: 'METRIC'; readonly value: MilitaryMetricPoint }
  | { readonly kind: 'LOG'; readonly value: MilitaryLogRecord }

export interface MilitaryTelemetryExporter {
  readonly exporterId: string
  export(record: TelemetryRecord): void | Promise<void>
}

/**
 * Bounded trace/metric/log recorder with a vendor-neutral exporter boundary.
 * The exporter can be an OTLP adapter; exporter failure never changes domain
 * outcomes and is surfaced as OTEL_DEGRADED plus droppedRecords.
 */
export class CorrelatedMilitaryTelemetry implements MilitaryTelemetry {
  readonly #context = new AsyncLocalStorage<MilitaryCorrelationContext>()
  readonly #spans: MilitarySpanRecord[] = []
  readonly #metrics: MilitaryMetricPoint[] = []
  readonly #logs: MilitaryLogRecord[] = []
  readonly #maximumRecords: number
  readonly #exporter: MilitaryTelemetryExporter | undefined
  #droppedRecords = 0
  #exporterFailed = false

  constructor(input?: {
    readonly maximumRecords?: number
    readonly exporter?: MilitaryTelemetryExporter
  }) {
    this.#maximumRecords = Math.max(
      32,
      Math.min(100_000, input?.maximumRecords ?? 2_048),
    )
    this.#exporter = input?.exporter
  }

  currentContext(): MilitaryCorrelationContext | null {
    return cloneFrozen(this.#context.getStore() ?? null)
  }

  async withSpan<T>(
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
  ): Promise<T> {
    const parent = input.parent ?? this.#context.getStore()
    const context: MilitaryCorrelationContext = {
      traceId: parent?.traceId ?? randomIdentifier(16),
      spanId: randomIdentifier(8),
      ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
      tenantId: boundedToken(input.tenantId, 'telemetry tenantId'),
      ...(input.requestId === undefined
        ? {}
        : { requestId: boundedToken(input.requestId, 'requestId') }),
      ...(input.missionId === undefined
        ? {}
        : { missionId: boundedToken(input.missionId, 'missionId') }),
      ...(input.taskId === undefined
        ? {}
        : { taskId: boundedToken(input.taskId, 'taskId') }),
      ...(input.attemptId === undefined
        ? {}
        : { attemptId: boundedToken(input.attemptId, 'attemptId') }),
      ...(input.activationId === undefined
        ? {}
        : {
            activationId: boundedToken(
              input.activationId,
              'activationId',
            ),
          }),
      ...(input.dispatchId === undefined
        ? {}
        : { dispatchId: boundedToken(input.dispatchId, 'dispatchId') }),
      ...(input.operationId === undefined
        ? {}
        : { operationId: boundedToken(input.operationId, 'operationId') }),
    }
    const started = new Date()
    let status: MilitarySpanRecord['status'] = 'OK'
    let errorCode: string | undefined
    try {
      return await this.#context.run(context, operation)
    } catch (error) {
      status = isAbort(error) ? 'CANCELLED' : 'ERROR'
      errorCode = error instanceof MilitaryError
        ? error.failure.code
        : error instanceof Error
          ? error.name
          : 'UNKNOWN'
      throw error
    } finally {
      const completed = new Date()
      const record: MilitarySpanRecord = {
        schemaVersion: '1.0.0',
        name: boundedToken(input.name, 'span name'),
        context,
        status,
        attributes: sanitizeAttributes(input.attributes ?? {}),
        startedAt: brand<string, 'IsoDateTime'>(started.toISOString()),
        completedAt: brand<string, 'IsoDateTime'>(completed.toISOString()),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        ...(errorCode === undefined ? {} : { errorCode }),
      }
      this.#append(this.#spans, record)
      this.#export({ kind: 'SPAN', value: record })
    }
  }

  recordMetric(input: {
    readonly name: string
    readonly kind: MilitaryMetricPoint['kind']
    readonly value: number
    readonly unit: string
    readonly attributes?: MilitaryMetricPoint['attributes']
    readonly context?: MilitaryCorrelationContext
  }): void {
    if (!Number.isFinite(input.value)) {
      throw new TypeError('telemetry metric value must be finite')
    }
    const context = input.context ?? this.#context.getStore()
    const point: MilitaryMetricPoint = {
      schemaVersion: '1.0.0',
      name: boundedToken(input.name, 'metric name'),
      kind: input.kind,
      value: input.value,
      unit: boundedToken(input.unit, 'metric unit'),
      attributes: sanitizeAttributes(input.attributes ?? {}),
      ...(context === undefined ? {} : { context: cloneFrozen(context) }),
      recordedAt: timestamp(),
    }
    this.#append(this.#metrics, point)
    this.#export({ kind: 'METRIC', value: point })
  }

  log(input: {
    readonly level: MilitaryLogRecord['level']
    readonly message: string
    readonly attributes?: MilitaryLogRecord['attributes']
    readonly context?: MilitaryCorrelationContext
  }): void {
    const context = input.context ?? this.#context.getStore()
    const record: MilitaryLogRecord = {
      schemaVersion: '1.0.0',
      level: input.level,
      message: boundedMessage(input.message),
      attributes: sanitizeAttributes(input.attributes ?? {}),
      ...(context === undefined ? {} : { context: cloneFrozen(context) }),
      recordedAt: timestamp(),
    }
    this.#append(this.#logs, record)
    this.#export({ kind: 'LOG', value: record })
  }

  snapshot(): MilitaryTelemetrySnapshot {
    return cloneFrozen({
      schemaVersion: '1.0.0',
      exporter: this.#exporter === undefined
        ? 'LOCAL_BOUNDED'
        : this.#exporterFailed
          ? 'OTEL_DEGRADED'
          : 'OTEL_CONFIGURED',
      spans: this.#spans,
      metrics: this.#metrics,
      logs: this.#logs,
      droppedRecords: this.#droppedRecords,
      generatedAt: timestamp(),
    })
  }

  #append<T>(target: T[], record: T): void {
    target.push(cloneFrozen(record))
    while (target.length > this.#maximumRecords) {
      target.shift()
      this.#droppedRecords += 1
    }
  }

  #export(record: TelemetryRecord): void {
    if (this.#exporter === undefined) return
    try {
      void Promise.resolve(this.#exporter.export(cloneFrozen(record)))
        .catch(() => {
          this.#exporterFailed = true
          this.#droppedRecords += 1
        })
    } catch {
      this.#exporterFailed = true
      this.#droppedRecords += 1
    }
  }
}

interface CapacityState {
  limits: TenantCapacityLimits
  reservations: Map<string, CapacityAdmissionReceipt>
}

/** Deterministic default and test implementation of tenant admission. */
export class InMemoryTenantCapacityControl
implements MilitaryCapacityControl {
  readonly #states = new Map<string, CapacityState>()
  #tail: Promise<void> = Promise.resolve()

  constructor(initial?: readonly TenantCapacityLimits[]) {
    for (const limits of initial ?? []) {
      this.#states.set(limits.tenantId, {
        limits: validateLimits(limits),
        reservations: new Map(),
      })
    }
  }

  async configure(
    limits: TenantCapacityLimits,
  ): Promise<TenantCapacityLimits> {
    return await this.#serialize(async () => {
      const valid = validateLimits(limits)
      const current = this.#states.get(limits.tenantId)
      if (current !== undefined
        && limits.revision <= current.limits.revision) {
        if (stableJson(limits) === stableJson(current.limits)) {
          return cloneFrozen(current.limits)
        }
        throw new MilitaryError(
          'REVISION_CONFLICT',
          'capacity limit revision must advance',
        )
      }
      this.#states.set(limits.tenantId, {
        limits: valid,
        reservations: current?.reservations ?? new Map(),
      })
      return cloneFrozen(valid)
    })
  }

  async admit(input: {
    readonly reservationId: string
    readonly tenantId: string
    readonly payloadHash: string
    readonly requested: CapacityVector
  }): Promise<CapacityAdmissionReceipt> {
    return await this.#serialize(async () => {
      const state = this.#require(input.tenantId)
      const reservationId = boundedToken(
        input.reservationId,
        'capacity reservationId',
      )
      const requested = validateVector(input.requested)
      const existing = state.reservations.get(reservationId)
      if (existing !== undefined) {
        if (
          existing.payloadHash !== input.payloadHash
          || stableJson(existing.requested) !== stableJson(requested)
        ) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            `capacity reservation ${reservationId} payload changed`,
          )
        }
        return cloneFrozen(existing)
      }
      const current = usage(state.reservations)
      const next = addVector(current, requested)
      for (const key of CAPACITY_KEYS) {
        if (next[key] > state.limits[key]) {
          throw new MilitaryError(
            'CAPACITY_EXHAUSTED',
            `tenant capacity ${key} would exceed ${state.limits[key]}`,
          )
        }
      }
      const receipt: CapacityAdmissionReceipt = {
        schemaVersion: '1.0.0',
        reservationId,
        tenantId: input.tenantId,
        payloadHash: boundedToken(input.payloadHash, 'capacity payloadHash'),
        requested,
        limits: state.limits,
        usageAfterAdmission: next,
        state: 'ACTIVE',
        admittedAt: timestamp(),
      }
      state.reservations.set(reservationId, cloneFrozen(receipt))
      return cloneFrozen(receipt)
    })
  }

  async release(
    reservationId: string,
    tenantId: string,
  ): Promise<CapacityAdmissionReceipt> {
    return await this.#serialize(async () => {
      const state = this.#require(tenantId)
      const key = boundedToken(reservationId, 'capacity reservationId')
      const current = state.reservations.get(key)
      if (current === undefined) {
        throw new MilitaryError(
          'NOT_FOUND',
          `capacity reservation ${key} does not exist`,
        )
      }
      if (current.state === 'RELEASED') return cloneFrozen(current)
      const released: CapacityAdmissionReceipt = {
        ...current,
        state: 'RELEASED',
        releasedAt: timestamp(),
      }
      state.reservations.set(key, cloneFrozen(released))
      return cloneFrozen(released)
    })
  }

  async snapshot(tenantId: string): Promise<CapacitySnapshot> {
    const state = this.#require(tenantId)
    const current = usage(state.reservations)
    return cloneFrozen({
      schemaVersion: '1.0.0',
      tenantId,
      limits: state.limits,
      usage: current,
      activeReservations: [...state.reservations.values()]
        .filter(value => value.state === 'ACTIVE').length,
      saturation: Object.fromEntries(CAPACITY_KEYS.map(key => [
        key,
        state.limits[key] === 0
          ? (current[key] === 0 ? 0 : 1)
          : current[key] / state.limits[key],
      ])) as unknown as CapacitySnapshot['saturation'],
      generatedAt: timestamp(),
    })
  }

  #require(tenantId: string): CapacityState {
    const state = this.#states.get(tenantId)
    if (state === undefined) {
      throw new MilitaryError(
        'NOT_FOUND',
        `tenant capacity policy ${tenantId} is not configured`,
      )
    }
    return state
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>(resolve => { release = resolve })
    await prior
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

type MutableDurableQueueMessage = {
  -readonly [Key in keyof DurableQueueMessage]: DurableQueueMessage[Key]
}

interface InMemoryQueueRecord extends MutableDurableQueueMessage {
  sequence: number
  availableAt: string
  state: 'PENDING' | 'DELIVERED' | 'DEAD_LETTERED'
}

/**
 * Process-local implementation for tests and the default application. It
 * implements the same idempotency and partition-order contract as the durable
 * adapters while truthfully providing no restart guarantee.
 */
export class InMemoryDurableQueue implements MilitaryDurableQueue {
  readonly #tenantId: string
  readonly #handlers = new Map<string, DurableQueueHandler>()
  readonly #records: InMemoryQueueRecord[] = []
  #nextId = 1
  #tail: Promise<void> = Promise.resolve()

  constructor(tenantId: string) {
    this.#tenantId = boundedToken(tenantId, 'queue tenantId')
  }

  register(topic: string, handler: DurableQueueHandler): void {
    const key = boundedToken(topic, 'queue topic')
    if (this.#handlers.has(key)) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        `queue handler already registered for ${key}`,
      )
    }
    this.#handlers.set(key, handler)
  }

  enqueue(input: {
    readonly topic: string
    readonly partitionKey: string
    readonly eventId: string
    readonly payload: unknown
    readonly availableAt?: string
  }): void {
    const topic = boundedToken(input.topic, 'queue topic')
    const partitionKey = boundedToken(
      input.partitionKey,
      'queue partitionKey',
    )
    const eventId = boundedToken(input.eventId, 'queue eventId')
    const encoded = stableJson(input.payload)
    const existing = this.#records.find(value =>
      value.topic === topic && value.eventId === eventId)
    if (existing !== undefined) {
      if (
        existing.partitionKey !== partitionKey
        || stableJson(existing.payload) !== encoded
      ) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `queue ${topic}/${eventId} payload changed`,
        )
      }
      return
    }
    const sequence = this.#nextId
    this.#records.push({
      queueMessageId: `memory-queue-${sequence}`,
      sequence,
      tenantId: this.#tenantId,
      topic,
      partitionKey,
      eventId,
      payload: cloneFrozen(input.payload),
      attempts: 0,
      availableAt: input.availableAt ?? new Date().toISOString(),
      state: 'PENDING',
    })
    this.#nextId += 1
  }

  async dispatchAvailable(input?: {
    readonly workerId?: string
    readonly limit?: number
    readonly leaseMs?: number
    readonly maximumAttempts?: number
  }): Promise<DurableQueueDispatchResult> {
    void input?.workerId
    void input?.leaseMs
    const limit = Math.max(1, Math.min(256, input?.limit ?? 32))
    const maximumAttempts = Math.max(
      1,
      Math.min(1_000, input?.maximumAttempts ?? 12),
    )
    return await this.#serialize(async () => {
      let delivered = 0
      let failed = 0
      let deadLettered = 0
      for (let index = 0; index < limit; index += 1) {
        const now = new Date().toISOString()
        const candidate = this.#records.find(value =>
          value.state === 'PENDING'
          && value.availableAt <= now
          && !this.#records.some(predecessor =>
            predecessor.state === 'PENDING'
            && predecessor.topic === value.topic
            && predecessor.partitionKey === value.partitionKey
            && predecessor.sequence < value.sequence))
        if (candidate === undefined) break
        candidate.attempts += 1
        const handler = this.#handlers.get(candidate.topic)
        try {
          if (handler === undefined) {
            throw new MilitaryError(
              'NOT_FOUND',
              `no queue handler for ${candidate.topic}`,
            )
          }
          await handler(cloneFrozen({
            queueMessageId: candidate.queueMessageId,
            tenantId: candidate.tenantId,
            topic: candidate.topic,
            partitionKey: candidate.partitionKey,
            eventId: candidate.eventId,
            payload: candidate.payload,
            attempts: candidate.attempts,
          }))
          candidate.state = 'DELIVERED'
          delivered += 1
        } catch {
          if (candidate.attempts >= maximumAttempts) {
            candidate.state = 'DEAD_LETTERED'
            deadLettered += 1
          } else {
            failed += 1
            break
          }
        }
      }
      return {
        delivered,
        failed,
        deadLettered,
        remaining: this.#records.filter(value =>
          value.state === 'PENDING').length,
      }
    })
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>(resolve => { release = resolve })
    await prior
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export class UnsupportedBackupControl implements MilitaryBackupControl {
  async create(): Promise<BackupManifest> {
    throw new MilitaryError(
      'POLICY_DENIED',
      'this application composition has no durable backup provider',
    )
  }

  async verify(): Promise<BackupManifest> {
    throw new MilitaryError(
      'POLICY_DENIED',
      'this application composition has no durable backup provider',
    )
  }

  async restoreDrill(): Promise<BackupManifest> {
    throw new MilitaryError(
      'POLICY_DENIED',
      'this application composition has no durable backup provider',
    )
  }

  async list(): Promise<readonly BackupManifest[]> {
    return []
  }
}

/** Ephemeral signer for tests/default composition; production declares it. */
export class EphemeralAssetSigner implements MilitaryAssetSigner {
  readonly #privateKey: KeyObject
  readonly #publicKey: KeyObject
  readonly #keyId: string

  constructor() {
    const pair = generateKeyPairSync('ed25519')
    this.#privateKey = pair.privateKey
    this.#publicKey = pair.publicKey
    this.#keyId = `ephemeral-ed25519-${sha256(
      this.#publicKey.export({ type: 'spki', format: 'der' }),
    ).slice(0, 24)}`
  }

  async sign(payload: Uint8Array): Promise<AssetSignatureReceipt> {
    const digest = sha256(payload)
    return cloneFrozen({
      schemaVersion: '1.0.0',
      keyId: this.#keyId,
      algorithm: 'Ed25519',
      payloadSha256: digest,
      signature: signBytes(null, payload, this.#privateKey).toString('base64'),
      signedAt: timestamp(),
    })
  }

  async verify(
    payload: Uint8Array,
    receipt: AssetSignatureReceipt,
  ): Promise<boolean> {
    if (
      receipt.keyId !== this.#keyId
      || receipt.algorithm !== 'Ed25519'
      || receipt.payloadSha256 !== sha256(payload)
    ) return false
    return verifyBytes(
      null,
      payload,
      this.#publicKey,
      Buffer.from(receipt.signature, 'base64'),
    )
  }

  async publicKey(keyId: string): Promise<string> {
    if (keyId !== this.#keyId) throw new MilitaryError('NOT_FOUND')
    return this.#publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

export class StaticResidencyControl implements MilitaryResidencyControl {
  async authorize(input: {
    readonly tenantId: string
    readonly providerId: string
    readonly classification: import(
      '@dsh-military/contracts'
    ).DataClassification
    readonly requiredRegions: readonly string[]
    readonly observedRegions: readonly string[]
    readonly policyRevision: string
  }): Promise<ResidencyDecisionReceipt> {
    const required = uniqueTokens(input.requiredRegions)
    const observed = uniqueTokens(input.observedRegions)
    const missing = required.filter(region => !observed.includes(region))
    const disposition = missing.length === 0 ? 'ALLOWED' : 'DENIED'
    const decidedAt = timestamp()
    return cloneFrozen({
      schemaVersion: '1.0.0',
      decisionId: `residency-${sha256(stableJson({
        ...input,
        requiredRegions: required,
        observedRegions: observed,
      })).slice(0, 40)}`,
      tenantId: boundedToken(input.tenantId, 'residency tenantId'),
      providerId: boundedToken(input.providerId, 'residency providerId'),
      classification: input.classification,
      requiredRegions: required,
      observedRegions: observed,
      disposition,
      policyRevision: boundedToken(
        input.policyRevision,
        'residency policyRevision',
      ),
      decidedAt,
      reason: disposition === 'ALLOWED'
        ? 'all required regions are covered by the selected provider route'
        : `provider route is missing required regions: ${missing.join(', ')}`,
    })
  }
}

export class ComposedMilitaryProductionPlane
implements MilitaryProductionPlane {
  readonly providers: readonly ProductionProviderDescriptor[]
  readonly telemetry: MilitaryTelemetry
  readonly capacity: MilitaryCapacityControl
  readonly queue: MilitaryDurableQueue
  readonly backups: MilitaryBackupControl
  readonly signer: MilitaryAssetSigner
  readonly residency: MilitaryResidencyControl

  constructor(input: {
    readonly providers: readonly ProductionProviderDescriptor[]
    readonly telemetry: MilitaryTelemetry
    readonly capacity: MilitaryCapacityControl
    readonly queue: MilitaryDurableQueue
    readonly backups: MilitaryBackupControl
    readonly signer: MilitaryAssetSigner
    readonly residency: MilitaryResidencyControl
  }) {
    assertProviderTopology(input.providers)
    this.providers = cloneFrozen(input.providers)
    this.telemetry = input.telemetry
    this.capacity = input.capacity
    this.queue = input.queue
    this.backups = input.backups
    this.signer = input.signer
    this.residency = input.residency
  }

  async snapshot(tenantId: string): Promise<ProductionPlaneSnapshot> {
    const [capacity, backups] = await Promise.all([
      this.capacity.snapshot(tenantId),
      this.backups.list(tenantId),
    ])
    return cloneFrozen({
      schemaVersion: '1.0.0',
      providers: this.providers,
      telemetry: this.telemetry.snapshot(),
      capacity,
      backups,
      generatedAt: timestamp(),
    })
  }
}

/**
 * Evaluate deployment truth without inferring capability from a package name.
 * Local mode accepts embedded providers and reports their limitations;
 * distributed targets require every provider to be externally managed, READY,
 * tenant-isolated and sufficiently durable.
 */
export function assessProductionReadiness(
  providers: readonly ProductionProviderDescriptor[],
  target: ProductionDeploymentTarget,
): ProductionReadinessReport {
  const errors: string[] = []
  const warnings: string[] = []
  try {
    assertProviderTopology(providers)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const distributed = target !== 'LOCAL_SINGLE_HOST'
  const minimumDurability = target === 'DISTRIBUTED_MULTI_REGION'
    ? 'MULTI_REGION'
    : 'REGIONAL'
  const dataKinds = new Set<ProductionProviderDescriptor['kind']>([
    'LEDGER',
    'OBJECT_STORE',
    'QUEUE',
    'KEY_MANAGEMENT',
    'CAPACITY',
    'BACKUP',
    'ASSET_SIGNING',
    'RESIDENCY',
  ])
  const ranks: Readonly<Record<
    ProductionProviderDescriptor['durability'],
    number
  >> = {
    PROCESS: 0,
    LOCAL_DISK: 1,
    REGIONAL: 2,
    MULTI_REGION: 3,
  }
  for (const providerValue of providers) {
    if (providerValue.status !== 'READY') {
      errors.push(
        `${providerValue.kind}/${providerValue.providerId} is `
        + providerValue.status,
      )
    }
    if (!distributed) {
      warnings.push(...providerValue.limitations.map(value =>
        `${providerValue.kind}/${providerValue.providerId}: ${value}`))
      continue
    }
    if (providerValue.deployment !== 'EXTERNAL') {
      errors.push(
        `${providerValue.kind}/${providerValue.providerId} is not EXTERNAL`,
      )
    }
    if (providerValue.tenantIsolation === 'NONE') {
      errors.push(
        `${providerValue.kind}/${providerValue.providerId} has no tenant isolation`,
      )
    }
    if (
      dataKinds.has(providerValue.kind)
      && ranks[providerValue.durability] < ranks[minimumDurability]
    ) {
      errors.push(
        `${providerValue.kind}/${providerValue.providerId} durability `
        + `${providerValue.durability} is below ${minimumDurability}`,
      )
    }
    warnings.push(...providerValue.limitations.map(value =>
      `${providerValue.kind}/${providerValue.providerId}: ${value}`))
  }
  return cloneFrozen({
    schemaVersion: '1.0.0',
    target,
    ready: errors.length === 0,
    providerIds: providers.map(value => value.providerId).sort(),
    errors,
    warnings,
  })
}

export function embeddedProductionProviders():
readonly ProductionProviderDescriptor[] {
  return [
    provider('LEDGER', 'in-memory-ledger', 'PROCESS', [
      'MilitaryLedger contract',
    ], ['not durable across process restart']),
    provider('OBJECT_STORE', 'caller-supplied-artifacts', 'LOCAL_DISK', [
      'content/reference separation',
    ], ['distribution depends on the supplied MilitaryArtifacts provider']),
    provider('QUEUE', 'in-memory-command-observer', 'PROCESS', [
      'bounded process-local delivery',
    ], ['not a durable external queue']),
    provider('KEY_MANAGEMENT', 'ephemeral-ed25519', 'PROCESS', [
      'asset signatures',
    ], ['keys are intentionally ephemeral in default/test composition']),
    provider('CAPACITY', 'in-memory-tenant-capacity', 'PROCESS', [
      'tenant quota admission',
      'idempotent release',
    ], ['not coordinated across processes']),
    provider('TELEMETRY', 'bounded-correlated-recorder', 'PROCESS', [
      'trace correlation',
      'metrics',
      'logs',
      'optional exporter seam',
    ], ['local ring is not a telemetry backend']),
    {
      ...provider('BACKUP', 'unconfigured-backup', 'PROCESS', [], [
        'DefaultMilitaryApplication requires a deployment backup adapter',
      ]),
      status: 'UNCONFIGURED',
    },
    provider('ASSET_SIGNING', 'ephemeral-ed25519', 'PROCESS', [
      'Ed25519 sign/verify',
    ], ['keys are not durable']),
    provider('RESIDENCY', 'static-route-policy', 'PROCESS', [
      'region allow/deny receipts',
    ], ['provider region observations are supplied by the deployment']),
  ]
}

function provider(
  kind: ProductionProviderDescriptor['kind'],
  implementation: string,
  durability: ProductionProviderDescriptor['durability'],
  capabilities: readonly string[],
  limitations: readonly string[],
): ProductionProviderDescriptor {
  return {
    schemaVersion: '1.0.0',
    providerId: `embedded-${kind.toLowerCase().replace(/_/gu, '-')}`,
    kind,
    implementation,
    deployment: 'EMBEDDED',
    status: 'READY',
    durability,
    tenantIsolation: 'NONE',
    capabilities,
    limitations,
  }
}

const CAPACITY_KEYS = [
  'activeTasks',
  'activeAgents',
  'modelConcurrency',
  'pendingOutbox',
  'storageBytes',
] as const satisfies readonly (keyof CapacityVector)[]

function validateVector(value: CapacityVector): CapacityVector {
  const result = {} as Record<keyof CapacityVector, number>
  for (const key of CAPACITY_KEYS) {
    const observed = value[key]
    if (!Number.isSafeInteger(observed) || observed < 0) {
      throw new TypeError(`capacity ${key} must be a non-negative integer`)
    }
    result[key] = observed
  }
  return cloneFrozen(result as unknown as CapacityVector)
}

function validateLimits(value: TenantCapacityLimits): TenantCapacityLimits {
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError('capacity limits revision must be a positive integer')
  }
  return cloneFrozen({
    tenantId: boundedToken(value.tenantId, 'capacity tenantId'),
    revision: value.revision,
    ...validateVector(value),
  })
}

function usage(
  reservations: ReadonlyMap<string, CapacityAdmissionReceipt>,
): CapacityVector {
  let result = emptyVector()
  for (const receipt of reservations.values()) {
    if (receipt.state === 'ACTIVE') {
      result = addVector(result, receipt.requested)
    }
  }
  return result
}

function emptyVector(): CapacityVector {
  return {
    activeTasks: 0,
    activeAgents: 0,
    modelConcurrency: 0,
    pendingOutbox: 0,
    storageBytes: 0,
  }
}

function addVector(left: CapacityVector, right: CapacityVector): CapacityVector {
  return {
    activeTasks: left.activeTasks + right.activeTasks,
    activeAgents: left.activeAgents + right.activeAgents,
    modelConcurrency: left.modelConcurrency + right.modelConcurrency,
    pendingOutbox: left.pendingOutbox + right.pendingOutbox,
    storageBytes: left.storageBytes + right.storageBytes,
  }
}

function assertProviderTopology(
  providers: readonly ProductionProviderDescriptor[],
): void {
  const kinds = new Set(providers.map(value => value.kind))
  const required: readonly ProductionProviderDescriptor['kind'][] = [
    'LEDGER',
    'OBJECT_STORE',
    'QUEUE',
    'KEY_MANAGEMENT',
    'CAPACITY',
    'TELEMETRY',
    'BACKUP',
    'ASSET_SIGNING',
    'RESIDENCY',
  ]
  for (const kind of required) {
    if (!kinds.has(kind)) {
      throw new TypeError(`production provider topology is missing ${kind}`)
    }
  }
  if (new Set(providers.map(value => value.providerId)).size !== providers.length) {
    throw new TypeError('production provider ids must be unique')
  }
}

function sanitizeAttributes(
  value: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
  const entries = Object.entries(value)
    .slice(0, 64)
    .map(([key, observed]) => [
      boundedToken(key, 'telemetry attribute key'),
      typeof observed === 'string'
        ? boundedMessage(observed)
        : observed,
    ] as const)
  return cloneFrozen(Object.fromEntries(entries))
}

function boundedMessage(value: string): string {
  return value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .slice(0, 4_096)
}

function boundedToken(value: string, at: string): string {
  const normalized = value.trim()
  if (
    normalized === ''
    || normalized.length > 240
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) throw new TypeError(`${at} must be a bounded token`)
  return normalized
}

function uniqueTokens(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(value =>
    boundedToken(value, 'region')))].sort()
}

function timestamp(): import('@dsh-military/contracts').IsoDateTime {
  return brand<string, 'IsoDateTime'>(new Date().toISOString())
}

function randomIdentifier(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

function isAbort(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.message.includes('aborted'))
}
