import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MilitaryError,
  type ArtifactId,
  type ArtifactRef,
  type DataClassification,
  type MilitaryArtifacts,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, type Clock } from '@dsh-military/core'

interface ArtifactMetadata {
  readonly ref: ArtifactRef
  readonly createdAt: string
}

export class LocalArtifactStore implements MilitaryArtifacts {
  readonly #root: string
  readonly #clock: Clock

  constructor(root: string, clock?: Clock) {
    this.#root = root
    this.#clock = clock ?? (() => new Date())
  }

  async put(input: {
    readonly bytes: Uint8Array
    readonly mediaType: string
    readonly classification: DataClassification
    readonly description?: string
  }): Promise<ArtifactRef> {
    const digest = createHash('sha256').update(input.bytes).digest('hex')
    const artifactId = brand<string, 'ArtifactId'>(`artifact-${digest}`)
    const ref: ArtifactRef = {
      artifactId,
      sha256: brand<string, 'Sha256'>(digest),
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      classification: input.classification,
      ...(input.description === undefined ? {} : { description: input.description }),
    }
    const path = this.#dataPath(digest)
    const metadataPath = `${path}.json`
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    try {
      await stat(path)
    } catch {
      const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temporary, input.bytes, { mode: 0o600 })
      await rename(temporary, path)
    }
    const metadata: ArtifactMetadata = { ref, createdAt: now(this.#clock) }
    try { await stat(metadataPath) } catch { await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 }) }
    return cloneFrozen(ref)
  }

  async get(id: ArtifactId): Promise<Uint8Array> {
    const digest = digestFromId(String(id))
    try { return new Uint8Array(await readFile(this.#dataPath(digest))) }
    catch (error) { throw new MilitaryError('NOT_FOUND', `artifact ${String(id)} not found`, undefined, { cause: error }) }
  }

  async verify(ref: ArtifactRef): Promise<boolean> {
    try {
      const bytes = await this.get(ref.artifactId)
      const digest = createHash('sha256').update(bytes).digest('hex')
      return digest === String(ref.sha256) && bytes.byteLength === ref.byteLength
    } catch { return false }
  }

  async metadata(id: ArtifactId): Promise<ArtifactMetadata> {
    const digest = digestFromId(String(id))
    try { return JSON.parse(await readFile(`${this.#dataPath(digest)}.json`, 'utf8')) as ArtifactMetadata }
    catch (error) { throw new MilitaryError('NOT_FOUND', undefined, undefined, { cause: error }) }
  }

  #dataPath(digest: string): string { return join(this.#root, 'sha256', digest.slice(0, 2), digest.slice(2)) }
}

function digestFromId(id: string): string {
  const digest = id.startsWith('artifact-') ? id.slice('artifact-'.length) : id
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new MilitaryError('INVALID_ARGUMENT', 'invalid artifact id')
  return digest
}
