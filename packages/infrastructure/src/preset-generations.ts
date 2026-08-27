import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  MilitaryError,
  type MilitaryPresetGenerations,
  type PresetGenerationManifest,
  type PresetMigrationOrder,
  type PresetResumeReceipt,
  type SessionId,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, sha256, stableJson, uuid, type Clock } from '@dsh-military/core'

export class FilePresetGenerationArchive implements MilitaryPresetGenerations {
  readonly #root: string
  readonly #clock: Clock

  constructor(root: string, clock?: Clock) {
    this.#root = resolve(root)
    this.#clock = clock ?? (() => new Date())
  }

  async current(): Promise<PresetGenerationManifest> {
    const pointer = JSON.parse(await readFile(join(this.#root, 'current.json'), 'utf8')) as { generation: string }
    return await this.get(pointer.generation)
  }

  async get(generation: string): Promise<PresetGenerationManifest> {
    const path = join(this.#root, safeGeneration(generation), 'generation-manifest.json')
    try { return cloneFrozen(JSON.parse(await readFile(path, 'utf8')) as PresetGenerationManifest) }
    catch (error) { throw new MilitaryError('NOT_FOUND', `preset generation ${generation} not found`, undefined, { cause: error }) }
  }

  async install(manifest: PresetGenerationManifest): Promise<void> {
    if (manifest.dshBaseline.commit !== 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e') throw new MilitaryError('POLICY_DENIED')
    const directory = join(this.#root, safeGeneration(manifest.generation))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'generation-manifest.json')
    try {
      const existing = JSON.parse(await readFile(path, 'utf8')) as PresetGenerationManifest
      // A compatible host-only bundle upgrade may carry the same content-addressed
      // preset generation under a newer bundle version. Keep the first archived
      // manifest as the canonical generation record while rejecting every other
      // kind of drift for that generation.
      if (stableJson({ ...existing, bundleVersion: manifest.bundleVersion }) !== stableJson(manifest)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      }
    } catch (error) {
      if (error instanceof MilitaryError) throw error
      await writeFile(path, JSON.stringify(manifest, null, 2), { mode: 0o600 })
    }
    if (manifest.status === 'CURRENT') {
      await mkdir(this.#root, { recursive: true })
      await writeFile(join(this.#root, 'current.json'), JSON.stringify({ generation: manifest.generation }, null, 2), { mode: 0o600 })
    }
  }

  async archiveAssets(sourceDirectory: string, manifest: PresetGenerationManifest): Promise<PresetGenerationManifest> {
    await this.install(manifest)
    const target = join(this.#root, safeGeneration(manifest.generation), 'assets')
    try {
      await stat(target)
    } catch {
      const staging = `${target}.tmp-${process.pid}-${Date.now()}`
      await cp(sourceDirectory, staging, { recursive: true, force: false, errorOnExist: true })
      await import('node:fs/promises').then(({ rename }) => rename(staging, target))
    }
    for (const file of manifest.files) {
      const bytes = await readFile(join(target, file.path))
      if (sha256(bytes) !== String(file.sha256) || bytes.byteLength !== file.byteLength) {
        throw new MilitaryError('MILITARY_PRESET_GENERATION_MISMATCH', `archived asset mismatch: ${file.path}`)
      }
    }
    return await this.get(manifest.generation)
  }

  async resume(input: {
    readonly sessionId: SessionId
    readonly requestedGeneration: string
    readonly signal: AbortSignal
  }): Promise<PresetResumeReceipt> {
    if (input.signal.aborted) throw input.signal.reason
    const startedAt = now(this.#clock)
    try {
      const manifest = await this.get(input.requestedGeneration)
      const current = await this.current()
      const disposition = manifest.generation === current.generation ? 'MATCHED' : 'ARCHIVE_REBOUND'
      return cloneFrozen({
        schemaVersion: '1.0.0', receiptId: uuid('preset-resume'), sessionId: String(input.sessionId),
        requestedGeneration: input.requestedGeneration, resolvedGeneration: manifest.generation,
        disposition, archiveAssetHash: manifest.assetHash, compatibilityReportId: 'rc2-exact',
        dshBaseline: manifest.dshBaseline, reason: disposition === 'MATCHED' ? 'current generation matches' : 'archived generation available',
        evidenceRefs: [`manifest:${manifest.generation}`], startedAt, completedAt: now(this.#clock),
      })
    } catch (error) {
      return cloneFrozen({
        schemaVersion: '1.0.0', receiptId: uuid('preset-resume'), sessionId: String(input.sessionId),
        requestedGeneration: input.requestedGeneration, disposition: 'QUARANTINED', compatibilityReportId: 'rc2-exact',
        dshBaseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
        reason: error instanceof Error ? error.message : 'generation unavailable', evidenceRefs: [],
        startedAt, completedAt: now(this.#clock),
      })
    }
  }

  async migrate(order: PresetMigrationOrder): Promise<void> {
    if (Date.parse(order.expiresAt) <= this.#clock().getTime()) throw new MilitaryError('POLICY_DENIED', 'preset migration order expired')
    await this.get(order.fromGeneration)
    await this.get(order.toGeneration)
  }

  generationDirectory(generation: string): string { return join(this.#root, safeGeneration(generation)) }
}

export async function buildPresetManifest(input: {
  readonly presetDirectory: string
  readonly bundleVersion: string
  readonly status?: PresetGenerationManifest['status']
  readonly clock?: Clock
}): Promise<PresetGenerationManifest> {
  const files = ['preset.yml', 'agent.cordis.yml']
  const entries = await Promise.all(files.map(async path => {
    const bytes = await readFile(join(input.presetDirectory, path))
    return { path, sha256: brand<string, 'Sha256'>(sha256(bytes)), byteLength: bytes.byteLength }
  }))
  const assetHash = brand<string, 'Sha256'>(sha256(stableJson(entries)))
  const generation = `military@sha256:${assetHash}`
  return {
    schemaVersion: '1.0.0', presetId: 'military', generation, assetHash,
    bundleVersion: input.bundleVersion,
    dshBaseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    publicSelectionId: 'military', hiddenArchiveId: `military-generation-${String(assetHash).slice(0, 16)}`,
    status: input.status ?? 'CURRENT', files: entries, createdAt: now(input.clock),
    compatibility: { mode: 'EXACT_RC2', breaking: false, resumeSupported: true },
  }
}

function safeGeneration(generation: string): string {
  return basename(generation.replaceAll(':', '-').replaceAll('@', '-'))
}
