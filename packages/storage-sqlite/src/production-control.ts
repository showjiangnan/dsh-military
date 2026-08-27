import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  MilitaryError,
  brand,
  type AssetSignatureReceipt,
  type BackupManifest,
  type CapacityAdmissionReceipt,
  type CapacitySnapshot,
  type CapacityVector,
  type MilitaryAssetSigner,
  type MilitaryCapacityControl,
  type MilitaryDurableQueue,
  type MilitaryProductionPlane,
  type MilitaryTelemetry,
  type ProductionProviderDescriptor,
  type TenantCapacityLimits,
} from '@dsh-military/contracts'
import {
  ComposedMilitaryProductionPlane,
  CorrelatedMilitaryTelemetry,
  StaticResidencyControl,
  cloneFrozen,
  sha256,
  stableJson,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteOutboxDispatcher } from './outbox-dispatcher.js'
import { SqliteStateRecords } from './state-records.js'

const CAPACITY_NAMESPACE = 'production-tenant-capacity'
const CAPACITY_STATE_KEY = 'current'

interface CapacityState {
  readonly schemaVersion: '1.0.0'
  readonly limits: TenantCapacityLimits
  readonly reservations: Readonly<Record<string, CapacityAdmissionReceipt>>
}

/** Durable, CAS-fenced tenant admission for the embedded production plane. */
export class SqliteTenantCapacityControl
implements MilitaryCapacityControl {
  readonly #records: SqliteStateRecords
  readonly #tenantId: string

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    initialLimits: TenantCapacityLimits,
  ) {
    this.#tenantId = tenantId
    this.#records = new SqliteStateRecords(database, tenantId)
    const limits = validateLimits(initialLimits)
    if (limits.tenantId !== tenantId) {
      throw new TypeError('capacity limits tenant does not match provider tenant')
    }
    if (this.#records.readSync<CapacityState>(
      CAPACITY_NAMESPACE,
      CAPACITY_STATE_KEY,
    ) === null) {
      this.#records.putSync(CAPACITY_NAMESPACE, CAPACITY_STATE_KEY, {
        schemaVersion: '1.0.0',
        limits,
        reservations: {},
      } satisfies CapacityState, { createOnly: true })
    }
  }

  async configure(
    limits: TenantCapacityLimits,
  ): Promise<TenantCapacityLimits> {
    this.#requireTenant(limits.tenantId)
    const valid = validateLimits(limits)
    return await this.#records.update<CapacityState, TenantCapacityLimits>(
      CAPACITY_NAMESPACE,
      CAPACITY_STATE_KEY,
      missingCapacityState,
      current => {
        if (valid.revision < current.limits.revision) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            'capacity policy revision cannot move backwards',
          )
        }
        if (valid.revision === current.limits.revision) {
          if (stableJson(valid) !== stableJson(current.limits)) {
            throw new MilitaryError(
              'REVISION_CONFLICT',
              'capacity policy content changed without a revision advance',
            )
          }
          return { next: current, result: current.limits }
        }
        const activeUsage = capacityUsage(current.reservations)
        for (const key of CAPACITY_KEYS) {
          if (activeUsage[key] > valid[key]) {
            throw new MilitaryError(
              'CAPACITY_EXHAUSTED',
              `new capacity ${key} is below current usage`,
            )
          }
        }
        return {
          next: { ...current, limits: valid },
          result: valid,
        }
      },
    )
  }

  async admit(input: {
    readonly reservationId: string
    readonly tenantId: string
    readonly payloadHash: string
    readonly requested: CapacityVector
  }): Promise<CapacityAdmissionReceipt> {
    this.#requireTenant(input.tenantId)
    const reservationId = boundedToken(
      input.reservationId,
      'capacity reservationId',
    )
    const payloadHash = boundedToken(
      input.payloadHash,
      'capacity payloadHash',
    )
    const requested = validateVector(input.requested)
    return await this.#records.update<CapacityState, CapacityAdmissionReceipt>(
      CAPACITY_NAMESPACE,
      CAPACITY_STATE_KEY,
      missingCapacityState,
      current => {
        const existing = current.reservations[reservationId]
        if (existing !== undefined) {
          if (
            existing.payloadHash !== payloadHash
            || stableJson(existing.requested) !== stableJson(requested)
          ) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `capacity reservation ${reservationId} payload changed`,
            )
          }
          return { next: current, result: existing }
        }
        const nextUsage = addVector(
          capacityUsage(current.reservations),
          requested,
        )
        for (const key of CAPACITY_KEYS) {
          if (nextUsage[key] > current.limits[key]) {
            throw new MilitaryError(
              'CAPACITY_EXHAUSTED',
              `tenant capacity ${key} would exceed ${current.limits[key]}`,
            )
          }
        }
        const receipt: CapacityAdmissionReceipt = {
          schemaVersion: '1.0.0',
          reservationId,
          tenantId: this.#tenantId,
          payloadHash,
          requested,
          limits: current.limits,
          usageAfterAdmission: nextUsage,
          state: 'ACTIVE',
          admittedAt: timestamp(),
        }
        return {
          next: {
            ...current,
            reservations: {
              ...current.reservations,
              [reservationId]: receipt,
            },
          },
          result: receipt,
        }
      },
    )
  }

  async release(
    reservationId: string,
    tenantId: string,
  ): Promise<CapacityAdmissionReceipt> {
    this.#requireTenant(tenantId)
    const key = boundedToken(reservationId, 'capacity reservationId')
    return await this.#records.update<CapacityState, CapacityAdmissionReceipt>(
      CAPACITY_NAMESPACE,
      CAPACITY_STATE_KEY,
      missingCapacityState,
      current => {
        const existing = current.reservations[key]
        if (existing === undefined) {
          throw new MilitaryError(
            'NOT_FOUND',
            `capacity reservation ${key} does not exist`,
          )
        }
        if (existing.state === 'RELEASED') {
          return { next: current, result: existing }
        }
        const released: CapacityAdmissionReceipt = {
          ...existing,
          state: 'RELEASED',
          releasedAt: timestamp(),
        }
        return {
          next: {
            ...current,
            reservations: {
              ...current.reservations,
              [key]: released,
            },
          },
          result: released,
        }
      },
    )
  }

  async snapshot(tenantId: string): Promise<CapacitySnapshot> {
    this.#requireTenant(tenantId)
    const state = this.#records.readSync<CapacityState>(
      CAPACITY_NAMESPACE,
      CAPACITY_STATE_KEY,
    )
    if (state === null) throw new MilitaryError('PERSISTENCE_FAILED')
    const usage = capacityUsage(state.reservations)
    return cloneFrozen({
      schemaVersion: '1.0.0',
      tenantId,
      limits: state.limits,
      usage,
      activeReservations: Object.values(state.reservations)
        .filter(value => value.state === 'ACTIVE').length,
      saturation: Object.fromEntries(CAPACITY_KEYS.map(key => [
        key,
        state.limits[key] === 0
          ? (usage[key] === 0 ? 0 : 1)
          : usage[key] / state.limits[key],
      ])) as unknown as CapacitySnapshot['saturation'],
      generatedAt: timestamp(),
    })
  }

  #requireTenant(tenantId: string): void {
    if (tenantId !== this.#tenantId) {
      throw new MilitaryError('UNAUTHORIZED', 'capacity tenant mismatch')
    }
  }
}

/**
 * Governed SQLite backup provider. Restore is intentionally a drill into a
 * disposable database; replacing the live database remains an operator
 * runbook action while DSH is stopped.
 */
export class SqliteBackupControl {
  readonly #database: SqliteMilitaryDatabase
  readonly #databasePath: string
  readonly #root: string
  readonly #tenantId: string
  readonly #signer: MilitaryAssetSigner
  #tail: Promise<void> = Promise.resolve()

  constructor(input: {
    readonly database: SqliteMilitaryDatabase
    readonly databasePath: string
    readonly root: string
    readonly tenantId: string
    readonly signer: MilitaryAssetSigner
  }) {
    this.#database = input.database
    this.#databasePath = resolve(input.databasePath)
    this.#root = resolve(input.root)
    this.#tenantId = input.tenantId
    this.#signer = input.signer
  }

  async create(input: {
    readonly operationId: string
    readonly tenantId: string
  }): Promise<BackupManifest> {
    this.#requireTenant(input.tenantId)
    const operationId = boundedToken(input.operationId, 'backup operationId')
    const backupId = `backup-${sha256(
      `${this.#tenantId}:${operationId}`,
    ).slice(0, 40)}`
    return await this.#serialize(async () => {
      const previous = await this.#manifest(backupId)
      if (previous !== null) return previous
      await mkdir(this.#root, { recursive: true, mode: 0o700 })
      const path = this.#backupPath(backupId)
      try {
        await stat(path)
        throw new MilitaryError(
          'REVISION_CONFLICT',
          `unindexed backup file ${basename(path)} already exists`,
        )
      } catch (error) {
        if (error instanceof MilitaryError) throw error
        if (!isMissingFile(error)) throw error
      }
      this.#database.maintenance(() => {
        this.#database.db.prepare('VACUUM INTO ?').run(path)
      })
      const integrity = sqliteIntegrity(path)
      if (integrity !== 'ok') {
        await unlink(path).catch(() => undefined)
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          `backup integrity check failed: ${integrity}`,
        )
      }
      const file = await fileEvidence(path)
      const unsigned = {
        schemaVersion: '1.0.0' as const,
        backupId,
        tenantId: this.#tenantId,
        providerId: 'sqlite-vacuum-backup',
        sourceRevision: this.#sourceRevision(),
        byteLength: file.byteLength,
        sha256: file.sha256,
        status: 'CREATED' as const,
        createdAt: timestamp(),
        evidence: [
          `sqlite-integrity:${integrity}`,
          `source:${basename(this.#databasePath)}`,
          `backup:${basename(path)}`,
        ],
      }
      const signature = await this.#signManifest(unsigned)
      const manifest: BackupManifest = { ...unsigned, signature }
      await this.#writeManifest(manifest)
      return cloneFrozen(manifest)
    })
  }

  async verify(
    backupId: string,
    tenantId: string,
  ): Promise<BackupManifest> {
    this.#requireTenant(tenantId)
    const id = backupIdentifier(backupId)
    return await this.#serialize(async () => {
      const current = await this.#requireManifest(id)
      try {
        const file = await fileEvidence(this.#backupPath(id))
        const integrity = sqliteIntegrity(this.#backupPath(id))
        const signatureValid = current.signature !== undefined
          && await this.#verifyManifest(current, current.signature)
        if (
          file.byteLength !== current.byteLength
          || file.sha256 !== current.sha256
          || integrity !== 'ok'
          || !signatureValid
        ) {
          throw new Error('digest, integrity or signature mismatch')
        }
        const verified: BackupManifest = {
          ...withoutSignature(current),
          status: current.status === 'DRILL_PASSED'
            ? 'DRILL_PASSED'
            : 'VERIFIED',
          verifiedAt: timestamp(),
          evidence: unique([
            ...current.evidence,
            `verified-sha256:${file.sha256}`,
            'verified-integrity:ok',
            `verified-signature:${current.signature.keyId}`,
          ]),
        }
        const signature = await this.#signManifest(verified)
        const signed: BackupManifest = { ...verified, signature }
        await this.#writeManifest(signed)
        return cloneFrozen(signed)
      } catch (error) {
        if (error instanceof MilitaryError) throw error
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          `backup ${id} verification failed`,
          undefined,
          { cause: error },
        )
      }
    })
  }

  async restoreDrill(
    backupId: string,
    tenantId: string,
  ): Promise<BackupManifest> {
    this.#requireTenant(tenantId)
    const id = backupIdentifier(backupId)
    return await this.#serialize(async () => {
      const current = await this.#requireManifest(id)
      const currentFile = await fileEvidence(this.#backupPath(id))
      const currentSignatureValid = current.signature !== undefined
        && await this.#verifyManifest(current, current.signature)
      if (
        currentFile.byteLength !== current.byteLength
        || currentFile.sha256 !== current.sha256
        || sqliteIntegrity(this.#backupPath(id)) !== 'ok'
        || !currentSignatureValid
      ) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          `backup ${id} must verify before restore drill`,
        )
      }
      const drillRoot = join(this.#root, 'restore-drills')
      await mkdir(drillRoot, { recursive: true, mode: 0o700 })
      const drillPath = join(
        drillRoot,
        `${id}-${Date.now()}-${process.pid}.sqlite`,
      )
      let status: BackupManifest['status'] = 'DRILL_PASSED'
      let error: string | undefined
      const drillAt = timestamp()
      const evidence = [...current.evidence]
      try {
        await copyFile(this.#backupPath(id), drillPath)
        const restored = new DatabaseSync(drillPath)
        try {
          const integrityRow = restored
            .prepare('PRAGMA integrity_check')
            .get() as Record<string, unknown> | undefined
          const integrity = String(Object.values(integrityRow ?? {})[0] ?? '')
          if (integrity !== 'ok') {
            throw new Error(`restore integrity_check: ${integrity}`)
          }
          const migrationCount = scalar(restored, `
            SELECT COUNT(*) AS count FROM military_schema_migrations
          `)
          const missionCount = scalar(restored, `
            SELECT COUNT(*) AS count FROM mission_streams
            WHERE tenant_id = ?
          `, this.#tenantId)
          evidence.push(
            'restore-drill-integrity:ok',
            `restore-drill-migrations:${migrationCount}`,
            `restore-drill-missions:${missionCount}`,
          )
        } finally {
          restored.close()
        }
      } catch (observed) {
        status = 'DRILL_FAILED'
        error = observed instanceof Error ? observed.message : String(observed)
        evidence.push(`restore-drill-error:${boundedMessage(error)}`)
      } finally {
        await unlink(drillPath).catch(() => undefined)
      }
      const drilled: BackupManifest = {
        ...withoutSignature(current),
        status,
        lastDrillAt: drillAt,
        evidence: unique(evidence),
        ...(error === undefined ? {} : { error: boundedMessage(error) }),
      }
      const signature = await this.#signManifest(drilled)
      const signed: BackupManifest = { ...drilled, signature }
      await this.#writeManifest(signed)
      return cloneFrozen(signed)
    })
  }

  async list(tenantId: string): Promise<readonly BackupManifest[]> {
    this.#requireTenant(tenantId)
    const entries = await readdir(this.#root, {
      withFileTypes: true,
    }).catch(() => [])
    const manifests: BackupManifest[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.manifest.json')) continue
      const parsed = await readJson<BackupManifest>(
        join(this.#root, entry.name),
      )
      if (parsed?.tenantId === tenantId) manifests.push(parsed)
    }
    return cloneFrozen(manifests.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)))
  }

  #sourceRevision(): string {
    const migrations = this.#database.db.prepare(`
      SELECT version, applied_at
      FROM military_schema_migrations
      ORDER BY version
    `).all() as unknown as Array<{
      readonly version: string
      readonly applied_at: string
    }>
    const streams = this.#database.db.prepare(`
      SELECT mission_id, aggregate_revision, last_seq, status
      FROM mission_streams
      WHERE tenant_id = ?
      ORDER BY mission_id
    `).all(this.#tenantId)
    return `sqlite-state-${sha256(stableJson({ migrations, streams }))}`
  }

  async #signManifest(
    manifest: Omit<BackupManifest, 'signature'>,
  ): Promise<AssetSignatureReceipt> {
    return await this.#signer.sign(
      new TextEncoder().encode(stableJson(manifest)),
    )
  }

  async #verifyManifest(
    manifest: BackupManifest,
    signature: AssetSignatureReceipt,
  ): Promise<boolean> {
    return await this.#signer.verify(
      new TextEncoder().encode(stableJson(withoutSignature(manifest))),
      signature,
    )
  }

  async #manifest(backupId: string): Promise<BackupManifest | null> {
    return await readJson<BackupManifest>(this.#manifestPath(backupId)) ?? null
  }

  async #requireManifest(backupId: string): Promise<BackupManifest> {
    const value = await this.#manifest(backupId)
    if (value === null || value.tenantId !== this.#tenantId) {
      throw new MilitaryError('NOT_FOUND', `backup ${backupId} not found`)
    }
    return value
  }

  async #writeManifest(manifest: BackupManifest): Promise<void> {
    await atomicWrite(
      this.#manifestPath(manifest.backupId),
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    )
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

  #requireTenant(tenantId: string): void {
    if (tenantId !== this.#tenantId) {
      throw new MilitaryError('UNAUTHORIZED', 'backup tenant mismatch')
    }
  }

  #backupPath(backupId: string): string {
    return join(this.#root, `${backupId}.sqlite`)
  }

  #manifestPath(backupId: string): string {
    return join(this.#root, `${backupId}.manifest.json`)
  }
}

export function createSqliteProductionPlane(input: {
  readonly database: SqliteMilitaryDatabase
  readonly databasePath: string
  readonly dataRoot: string
  readonly tenantId: string
  readonly signer: MilitaryAssetSigner
  readonly queue?: MilitaryDurableQueue
  readonly telemetry?: MilitaryTelemetry
  readonly capacityLimits?: TenantCapacityLimits
  readonly otelConfigured?: boolean
}): MilitaryProductionPlane {
  const telemetry = input.telemetry
    ?? new CorrelatedMilitaryTelemetry({ maximumRecords: 4_096 })
  const capacity = new SqliteTenantCapacityControl(
    input.database,
    input.tenantId,
    input.capacityLimits ?? defaultCapacityLimits(input.tenantId),
  )
  const backups = new SqliteBackupControl({
    database: input.database,
    databasePath: input.databasePath,
    root: join(input.dataRoot, 'backups'),
    tenantId: input.tenantId,
    signer: input.signer,
  })
  return new ComposedMilitaryProductionPlane({
    providers: sqliteProductionProviders({
      otelConfigured: input.otelConfigured === true,
    }),
    telemetry,
    capacity,
    queue: input.queue
      ?? new SqliteOutboxDispatcher(input.database, input.tenantId),
    backups,
    signer: input.signer,
    residency: new StaticResidencyControl(),
  })
}

export function sqliteProductionProviders(input?: {
  readonly otelConfigured?: boolean
}): readonly ProductionProviderDescriptor[] {
  return [
    descriptor({
      providerId: 'sqlite-mission-ledger',
      kind: 'LEDGER',
      implementation: 'SqliteMilitaryLedger',
      durability: 'LOCAL_DISK',
      isolation: 'APPLICATION_ROW',
      capabilities: ['event CAS', 'command receipts', 'restart recovery'],
      limitations: [
        'single-host writer',
        'replace with a MilitaryLedger PostgreSQL adapter for horizontal hosts',
      ],
    }),
    descriptor({
      providerId: 'local-governed-artifacts',
      kind: 'OBJECT_STORE',
      implementation: 'LocalArtifactStore',
      durability: 'LOCAL_DISK',
      isolation: 'BUCKET_PREFIX',
      capabilities: [
        'content/reference separation',
        'classification',
        'retention',
        'legal hold',
        'encryption',
      ],
      limitations: [
        'local filesystem only',
        'replace with a MilitaryArtifacts object-store adapter for distributed deployments',
      ],
    }),
    descriptor({
      providerId: 'sqlite-transactional-outbox',
      kind: 'QUEUE',
      implementation: 'SqliteOutboxDispatcher',
      durability: 'LOCAL_DISK',
      isolation: 'APPLICATION_ROW',
      capabilities: [
        'partition ordering',
        'claim/retry',
        'dead letter',
        'consumer offsets',
      ],
      limitations: [
        'single SQLite database',
        'replace behind the durable queue seam for external brokers',
      ],
    }),
    descriptor({
      providerId: 'local-file-key-management',
      kind: 'KEY_MANAGEMENT',
      implementation: 'LocalArtifactStore AES-256-GCM key files',
      durability: 'LOCAL_DISK',
      isolation: 'DATABASE',
      capabilities: ['AES-256-GCM', 'key rotation', 'mode-0600 keys'],
      limitations: [
        'not an external KMS or HSM',
        'production clusters should inject a KMS-backed artifact provider',
      ],
    }),
    descriptor({
      providerId: 'sqlite-tenant-capacity',
      kind: 'CAPACITY',
      implementation: 'SqliteTenantCapacityControl',
      durability: 'LOCAL_DISK',
      isolation: 'APPLICATION_ROW',
      capabilities: [
        'CAS admission',
        'idempotent reservations',
        'multi-tenant row quotas',
      ],
      limitations: ['coordination scope is one SQLite database'],
    }),
    descriptor({
      providerId: input?.otelConfigured === true
        ? 'otel-correlated-telemetry'
        : 'local-correlated-telemetry',
      kind: 'TELEMETRY',
      implementation: input?.otelConfigured === true
        ? 'CorrelatedMilitaryTelemetry + configured exporter'
        : 'CorrelatedMilitaryTelemetry',
      durability: input?.otelConfigured === true ? 'REGIONAL' : 'PROCESS',
      isolation: 'APPLICATION_ROW',
      capabilities: [
        'trace/span correlation',
        'metrics',
        'logs',
        'bounded local ring',
      ],
      limitations: input?.otelConfigured === true
        ? ['exporter durability is controlled by the deployment']
        : ['no OTLP exporter configured; records are process-local'],
    }),
    descriptor({
      providerId: 'sqlite-vacuum-backup',
      kind: 'BACKUP',
      implementation: 'SqliteBackupControl',
      durability: 'LOCAL_DISK',
      isolation: 'DATABASE',
      capabilities: [
        'consistent VACUUM INTO backup',
        'digest/signature verification',
        'isolated restore drill',
      ],
      limitations: [
        'no automatic off-host replication',
        'live restore requires the documented stopped-host runbook',
      ],
    }),
    descriptor({
      providerId: 'local-ed25519-signing',
      kind: 'ASSET_SIGNING',
      implementation: 'LocalEd25519AssetSigner',
      durability: 'LOCAL_DISK',
      isolation: 'DATABASE',
      capabilities: ['Ed25519', 'key rotation', 'historical verification'],
      limitations: ['private signing key is not held in an external KMS/HSM'],
    }),
    descriptor({
      providerId: 'static-residency-policy',
      kind: 'RESIDENCY',
      implementation: 'StaticResidencyControl',
      durability: 'PROCESS',
      isolation: 'EXTERNAL_POLICY',
      capabilities: ['exact region allow/deny receipt'],
      limitations: [
        'provider region observations must come from deployment configuration',
      ],
    }),
  ]
}

function descriptor(input: {
  readonly providerId: string
  readonly kind: ProductionProviderDescriptor['kind']
  readonly implementation: string
  readonly durability: ProductionProviderDescriptor['durability']
  readonly isolation: ProductionProviderDescriptor['tenantIsolation']
  readonly capabilities: readonly string[]
  readonly limitations: readonly string[]
}): ProductionProviderDescriptor {
  return {
    schemaVersion: '1.0.0',
    providerId: input.providerId,
    kind: input.kind,
    implementation: input.implementation,
    deployment: 'EMBEDDED',
    status: 'READY',
    durability: input.durability,
    tenantIsolation: input.isolation,
    capabilities: input.capabilities,
    limitations: input.limitations,
  }
}

function defaultCapacityLimits(tenantId: string): TenantCapacityLimits {
  return {
    tenantId,
    revision: 1,
    activeTasks: 2_048,
    activeAgents: 256,
    modelConcurrency: 64,
    pendingOutbox: 100_000,
    storageBytes: 50 * 1024 * 1024 * 1024,
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
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new TypeError(`capacity ${key} must be a non-negative integer`)
    }
    result[key] = value[key]
  }
  return cloneFrozen(result as unknown as CapacityVector)
}

function validateLimits(value: TenantCapacityLimits): TenantCapacityLimits {
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError('capacity revision must be a positive integer')
  }
  return cloneFrozen({
    tenantId: boundedToken(value.tenantId, 'capacity tenantId'),
    revision: value.revision,
    ...validateVector(value),
  })
}

function missingCapacityState(): CapacityState {
  throw new MilitaryError(
    'PERSISTENCE_FAILED',
    'durable capacity state is missing',
  )
}

function capacityUsage(
  reservations: Readonly<Record<string, CapacityAdmissionReceipt>>,
): CapacityVector {
  let result = emptyVector()
  for (const receipt of Object.values(reservations)) {
    if (receipt.state === 'ACTIVE') result = addVector(result, receipt.requested)
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

function withoutSignature(
  value: BackupManifest,
): Omit<BackupManifest, 'signature'> {
  const { signature: _signature, ...manifest } = value
  return manifest
}

function backupIdentifier(value: string): string {
  if (!/^backup-[a-f0-9]{40}$/u.test(value)) {
    throw new MilitaryError('INVALID_ARGUMENT', 'invalid backup id')
  }
  return value
}

function sqliteIntegrity(path: string): string {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as
      | Record<string, unknown>
      | undefined
    return String(Object.values(row ?? {})[0] ?? 'unknown')
  } finally {
    database.close()
  }
}

async function fileEvidence(path: string): Promise<{
  readonly byteLength: number
  readonly sha256: string
}> {
  const bytes = await readFile(path)
  return {
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function scalar(
  database: DatabaseSync,
  query: string,
  ...parameters: readonly (string | number)[]
): number {
  const row = database.prepare(query).get(...parameters) as
    | Record<string, unknown>
    | undefined
  return Number(Object.values(row ?? {})[0] ?? 0)
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function boundedToken(value: string, at: string): string {
  const normalized = value.trim()
  if (
    normalized === ''
    || normalized.length > 180
    || /[\u0000-\u001f\u007f/\\]/u.test(normalized)
  ) throw new TypeError(`${at} must be a bounded path-safe token`)
  return normalized
}

function boundedMessage(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').slice(0, 500)
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function timestamp(): import('@dsh-military/contracts').IsoDateTime {
  return brand<string, 'IsoDateTime'>(new Date().toISOString())
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
