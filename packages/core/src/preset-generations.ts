import {
  MilitaryError,
  type MilitaryPresetGenerations,
  type PresetGenerationManifest,
  type PresetMigrationOrder,
  type PresetResumeReceipt,
  type SessionId,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, uuid, type Clock } from './util.js'

export class InMemoryPresetGenerations implements MilitaryPresetGenerations {
  readonly #manifests = new Map<string, PresetGenerationManifest>()
  readonly #migrations = new Map<string, PresetMigrationOrder>()
  readonly #clock: Clock
  #currentGeneration: string | undefined
  #compatibilityReportId = 'compatibility-not-probed'

  constructor(clock?: Clock) { this.#clock = clock ?? (() => new Date()) }

  setCompatibilityReportId(reportId: string): void { this.#compatibilityReportId = reportId }

  async current(): Promise<PresetGenerationManifest> {
    if (this.#currentGeneration === undefined) throw new MilitaryError('NOT_FOUND', 'no current preset generation')
    return this.get(this.#currentGeneration)
  }

  async get(generation: string): Promise<PresetGenerationManifest> {
    const manifest = this.#manifests.get(generation)
    if (manifest === undefined) throw new MilitaryError('NOT_FOUND', `unknown preset generation ${generation}`)
    return cloneFrozen(manifest)
  }

  async install(manifest: PresetGenerationManifest): Promise<void> {
    const existing = this.#manifests.get(manifest.generation)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(manifest)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    if (manifest.presetId !== 'military' || manifest.dshBaseline.release !== '0.1.1-rc.2') {
      throw new MilitaryError('INVALID_ARGUMENT', 'generation is not an RC.2 military preset')
    }
    this.#manifests.set(manifest.generation, cloneFrozen(manifest))
    if (manifest.status === 'CURRENT') this.#currentGeneration = manifest.generation
  }

  async resume(input: {
    readonly sessionId: SessionId
    readonly requestedGeneration: string
    readonly signal: AbortSignal
  }): Promise<PresetResumeReceipt> {
    if (input.signal.aborted) throw input.signal.reason
    const startedAt = now(this.#clock)
    const manifest = this.#manifests.get(input.requestedGeneration)
    const current = this.#currentGeneration
    const receipt: PresetResumeReceipt = manifest === undefined
      ? {
          schemaVersion: '1.0.0', receiptId: uuid('preset-resume'), sessionId: String(input.sessionId),
          requestedGeneration: input.requestedGeneration, disposition: 'QUARANTINED',
          compatibilityReportId: this.#compatibilityReportId,
          dshBaseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
          reason: 'requested preset generation is not installed', evidenceRefs: [], startedAt, completedAt: now(this.#clock),
        }
      : {
          schemaVersion: '1.0.0', receiptId: uuid('preset-resume'), sessionId: String(input.sessionId),
          requestedGeneration: input.requestedGeneration, resolvedGeneration: manifest.generation,
          disposition: current === manifest.generation ? 'MATCHED' : 'ARCHIVE_REBOUND',
          archiveAssetHash: manifest.assetHash, compatibilityReportId: this.#compatibilityReportId,
          dshBaseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
          reason: current === manifest.generation ? 'active generation matched' : 'archived generation rebound',
          evidenceRefs: manifest.files.map(file => `${file.path}:${file.sha256}`), startedAt, completedAt: now(this.#clock),
        }
    return cloneFrozen(receipt)
  }

  async migrate(order: PresetMigrationOrder): Promise<void> {
    const existing = this.#migrations.get(order.migrationOrderId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(order)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    if (!this.#manifests.has(order.toGeneration)) throw new MilitaryError('NOT_FOUND', 'target preset generation is not installed')
    this.#migrations.set(order.migrationOrderId, cloneFrozen(order))
  }
}
