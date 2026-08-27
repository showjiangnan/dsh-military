import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MilitaryError,
  type ArtifactAccessContext,
  type ArtifactAccessReference,
  type ArtifactDeletionReceipt,
  type ArtifactGarbageCollectionReceipt,
  type ArtifactId,
  type ArtifactKeyRotationReceipt,
  type ArtifactRef,
  type DataClassification,
  type MilitaryArtifacts,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, type Clock } from '@dsh-military/core'

const classificationRank: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
}

interface EncryptionMetadata {
  readonly algorithm: 'AES-256-GCM'
  readonly keyId: string
  readonly iv: string
  readonly authTag: string
}

interface ContentMetadata {
  readonly schemaVersion: '2.0.0'
  readonly artifactId: ArtifactId
  readonly digest: string
  readonly mediaType: string
  readonly byteLength: number
  readonly highestClassification: DataClassification
  readonly references: Readonly<Record<string, ArtifactAccessReference>>
  readonly createdAt: string
  readonly updatedAt: string
  readonly encryption?: EncryptionMetadata
}

interface ReferenceIndex {
  readonly schemaVersion: '1.0.0'
  readonly references: Readonly<Record<string, string>>
}

interface ActiveKey {
  readonly schemaVersion: '1.0.0'
  readonly keyId: string
  readonly createdAt: string
}

interface LegacyArtifactMetadata {
  readonly ref: ArtifactRef
  readonly createdAt: string
}

/**
 * Local governed content-addressed store.
 *
 * Content blobs and authorization-bearing references are separate. The
 * artifact hash is only an integrity identifier; browser/external consumers
 * must use `read(referenceId, context)`. Calls to `get(artifactId)` are the
 * privileged in-process service path used by deterministic Host providers.
 */
export class LocalArtifactStore implements MilitaryArtifacts {
  readonly #root: string
  readonly #clock: Clock
  #writeTail: Promise<void> = Promise.resolve()

  constructor(root: string, clock?: Clock) {
    this.#root = root
    this.#clock = clock ?? (() => new Date())
  }

  async put(input: {
    readonly bytes: Uint8Array
    readonly mediaType: string
    readonly classification: DataClassification
    readonly description?: string
    readonly tenantId?: string
    readonly missionId?: string
    readonly taskId?: string
    readonly ownerPrincipalId?: string
    readonly audiencePrincipalIds?: readonly string[]
    readonly audienceScopes?: readonly string[]
    readonly grantId?: string
    readonly residencyPolicyRef?: string
    readonly retentionUntil?: NonNullable<
      ArtifactAccessReference['retentionUntil']
    >
    readonly expiresAt?: NonNullable<ArtifactAccessReference['expiresAt']>
    readonly legalHoldIds?: readonly string[]
    readonly lineageReferenceIds?: readonly string[]
    readonly idempotencyKey?: string
  }): Promise<ArtifactRef> {
    return await this.#serialize(async () => {
      const digest = createHash('sha256').update(input.bytes).digest('hex')
      const artifactId = brand<string, 'ArtifactId'>(`artifact-${digest}`)
      const timestamp = now(this.#clock)
      const tenantId = normalizedToken(input.tenantId ?? 'local', 'tenantId')
      const referenceId = input.idempotencyKey === undefined
        ? `artifact-ref-${randomUUID()}`
        : `artifact-ref-${createHash('sha256')
          .update(`${tenantId}\u0000${input.idempotencyKey}`)
          .digest('hex')
          .slice(0, 40)}`
      const index = await this.#referenceIndex()
      const priorDigest = index.references[referenceId]
      if (priorDigest !== undefined) {
        if (priorDigest !== digest) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            'artifact operation key was reused with different content',
          )
        }
        const prior = await this.#contentMetadata(priorDigest)
        const reference = prior?.references[referenceId]
        if (
          prior === undefined
          || reference === undefined
          || !sameReferenceAuthority(reference, input, tenantId)
          || prior.mediaType !== input.mediaType
          || prior.byteLength !== input.bytes.byteLength
        ) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            'artifact operation key was reused with different authority or media metadata',
          )
        }
        return artifactRefFor(prior, reference, input.description)
      }
      const current = await this.#contentMetadata(digest)
      if (current !== undefined && current.mediaType !== input.mediaType) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          'identical artifact content cannot be assigned conflicting media types',
        )
      }
      let lineageClassification = input.classification
      for (const lineageReferenceId of input.lineageReferenceIds ?? []) {
        const lineage = await this.#resolveReference(lineageReferenceId)
        if (lineage.reference.deletedAt !== undefined) {
          throw new MilitaryError(
            'NOT_FOUND',
            `lineage reference ${lineageReferenceId} was deleted`,
          )
        }
        if (lineage.reference.tenantId !== tenantId) {
          throw new MilitaryError(
            'UNAUTHORIZED',
            'artifact lineage cannot cross tenant boundaries',
          )
        }
        lineageClassification = maximumClassification(
          lineageClassification,
          lineage.metadata.highestClassification,
        )
      }
      const highestClassification = current === undefined
        ? lineageClassification
        : maximumClassification(
            current.highestClassification,
            lineageClassification,
          )
      const reference: ArtifactAccessReference = {
        schemaVersion: '1.0.0',
        referenceId,
        artifactId,
        contentHash: brand<string, 'Sha256'>(digest),
        tenantId,
        ...(input.missionId === undefined
          ? {}
          : { missionId: normalizedToken(input.missionId, 'missionId') }),
        ...(input.taskId === undefined
          ? {}
          : { taskId: normalizedToken(input.taskId, 'taskId') }),
        classification: highestClassification,
        ownerPrincipalId: normalizedToken(
          input.ownerPrincipalId ?? 'military-host',
          'ownerPrincipalId',
        ),
        audiencePrincipalIds: uniqueTokens(
          input.audiencePrincipalIds ?? ['military-host'],
        ),
        audienceScopes: uniqueTokens(
          input.audienceScopes ?? ['artifact:read'],
        ),
        ...(input.grantId === undefined
          ? {}
          : { grantId: normalizedToken(input.grantId, 'grantId') }),
        residencyPolicyRef: normalizedToken(
          input.residencyPolicyRef ?? 'local-artifact-store@1',
          'residencyPolicyRef',
        ),
        ...(input.retentionUntil === undefined
          ? {}
          : { retentionUntil: input.retentionUntil }),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: input.expiresAt }),
        legalHoldIds: uniqueTokens(input.legalHoldIds ?? []),
        lineageReferenceIds: uniqueTokens(input.lineageReferenceIds ?? []),
        createdAt: timestamp,
      }
      const references = Object.fromEntries(
        Object.entries(current?.references ?? {}).map(([id, value]) => [
          id,
          highestClassification === value.classification
            ? value
            : { ...value, classification: highestClassification },
        ]),
      ) as Record<string, ArtifactAccessReference>
      references[referenceId] = reference
      await mkdir(dirname(this.#dataPath(digest)), {
        recursive: true,
        mode: 0o700,
      })
      let encryption = current?.encryption
      if (current === undefined) {
        const encoded = await this.#encode(input.bytes, highestClassification)
        encryption = encoded.encryption
        await this.#atomicWrite(this.#dataPath(digest), encoded.bytes)
      } else if (
        encryption === undefined
        && requiresEncryption(highestClassification)
      ) {
        const existing = await readFile(this.#dataPath(digest))
        const encoded = await this.#encode(
          new Uint8Array(existing),
          highestClassification,
        )
        encryption = encoded.encryption
        await this.#atomicWrite(this.#dataPath(digest), encoded.bytes)
      }
      const metadata: ContentMetadata = {
        schemaVersion: '2.0.0',
        artifactId,
        digest,
        mediaType: current?.mediaType ?? input.mediaType,
        byteLength: current?.byteLength ?? input.bytes.byteLength,
        highestClassification,
        references,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(encryption === undefined ? {} : { encryption }),
      }
      await this.#writeMetadata(metadata)
      await this.#writeReferenceIndex({
        schemaVersion: '1.0.0',
        references: { ...index.references, [referenceId]: digest },
      })
      return artifactRefFor(metadata, reference, input.description)
    })
  }

  async get(id: ArtifactId): Promise<Uint8Array> {
    const digest = digestFromId(String(id))
    const metadata = await this.#contentMetadata(digest)
    if (metadata === undefined) {
      throw new MilitaryError(
        'NOT_FOUND',
        `artifact ${String(id)} not found`,
      )
    }
    let encoded: Uint8Array
    try {
      encoded = new Uint8Array(await readFile(this.#dataPath(digest)))
    } catch (error) {
      throw new MilitaryError(
        isEnoent(error) ? 'NOT_FOUND' : 'PERSISTENCE_FAILED',
        isEnoent(error)
          ? `artifact ${String(id)} not found`
          : 'governed artifact bytes are unreadable',
        undefined,
        { cause: error },
      )
    }
    let bytes: Uint8Array
    try {
      bytes = metadata.encryption === undefined
        ? encoded
        : await this.#decrypt(encoded, metadata.encryption)
    } catch (error) {
      throw new MilitaryError(
        'PERSISTENCE_FAILED',
        'governed artifact authentication failed',
        undefined,
        { cause: error },
      )
    }
    const observed = createHash('sha256').update(bytes).digest('hex')
    if (observed !== metadata.digest
      || bytes.byteLength !== metadata.byteLength) {
      throw new MilitaryError(
        'PERSISTENCE_FAILED',
        'governed artifact content hash or byte length does not match metadata',
      )
    }
    return bytes
  }

  async verify(ref: ArtifactRef): Promise<boolean> {
    try {
      const bytes = await this.get(ref.artifactId)
      const digest = createHash('sha256').update(bytes).digest('hex')
      return digest === String(ref.sha256)
        && bytes.byteLength === ref.byteLength
    } catch {
      return false
    }
  }

  async reference(referenceId: string): Promise<ArtifactAccessReference> {
    const { metadata, reference } = await this.#resolveReference(referenceId)
    if (reference.deletedAt !== undefined) {
      throw new MilitaryError('NOT_FOUND', `artifact reference ${referenceId} was deleted`)
    }
    if (metadata.highestClassification !== reference.classification) {
      throw new MilitaryError('PERSISTENCE_FAILED', 'artifact classification merge drift')
    }
    return cloneFrozen(reference)
  }

  async read(
    referenceId: string,
    context: ArtifactAccessContext,
  ): Promise<Uint8Array> {
    const { metadata, reference } = await this.#resolveReference(referenceId)
    authorizeReference(reference, metadata.highestClassification, context, 'read')
    return await this.get(reference.artifactId)
  }

  async deleteReference(input: {
    readonly referenceId: string
    readonly context: ArtifactAccessContext
    readonly reason: string
  }): Promise<ArtifactDeletionReceipt> {
    return await this.#serialize(async () => {
      const { metadata, reference } = await this.#resolveReference(
        input.referenceId,
      )
      authorizeReference(
        reference,
        metadata.highestClassification,
        input.context,
        'delete',
      )
      const timestamp = now(this.#clock)
      if (reference.legalHoldIds.length > 0) {
        return await this.#deletionReceipt({
          reference,
          disposition: 'LEGAL_HOLD_BLOCKED',
          reason: 'active legal hold prevents reference deletion',
          contentDeleted: false,
          completedAt: timestamp,
        })
      }
      if (reference.retentionUntil !== undefined
        && Date.parse(reference.retentionUntil) > Date.parse(timestamp)) {
        return await this.#deletionReceipt({
          reference,
          disposition: 'RETENTION_BLOCKED',
          reason: 'retention window has not elapsed',
          contentDeleted: false,
          completedAt: timestamp,
        })
      }
      const nextReference: ArtifactAccessReference = {
        ...reference,
        deletedAt: timestamp,
      }
      await this.#writeMetadata({
        ...metadata,
        references: {
          ...metadata.references,
          [reference.referenceId]: nextReference,
        },
        updatedAt: timestamp,
      })
      return await this.#deletionReceipt({
        reference,
        disposition: 'REFERENCE_DELETED',
        reason: boundedReason(input.reason),
        contentDeleted: false,
        completedAt: timestamp,
      })
    })
  }

  async setLegalHold(input: {
    readonly referenceId: string
    readonly holdId: string
    readonly active: boolean
    readonly context: ArtifactAccessContext
  }): Promise<ArtifactAccessReference> {
    return await this.#serialize(async () => {
      const { metadata, reference } = await this.#resolveReference(
        input.referenceId,
      )
      authorizeReference(
        reference,
        metadata.highestClassification,
        input.context,
        'legal-hold',
      )
      if (!input.context.scopes.includes('artifact:legal-hold')
        && !input.context.scopes.includes('*')) {
        throw new MilitaryError('POLICY_DENIED', 'legal hold scope is required')
      }
      const holdId = normalizedToken(input.holdId, 'holdId')
      const holds = new Set(reference.legalHoldIds)
      if (input.active) holds.add(holdId)
      else holds.delete(holdId)
      const updated: ArtifactAccessReference = {
        ...reference,
        legalHoldIds: [...holds].sort(),
      }
      await this.#writeMetadata({
        ...metadata,
        references: {
          ...metadata.references,
          [reference.referenceId]: updated,
        },
        updatedAt: now(this.#clock),
      })
      return cloneFrozen(updated)
    })
  }

  async garbageCollect(
    operationId: string,
  ): Promise<ArtifactGarbageCollectionReceipt> {
    return await this.#serialize(async () => {
      const id = normalizedToken(operationId, 'operationId')
      const receiptPath = join(this.#root, 'receipts', 'gc', `${id}.json`)
      const previous = await readJson<ArtifactGarbageCollectionReceipt>(
        receiptPath,
      )
      if (previous !== undefined) return cloneFrozen(previous)
      const digests = await this.#storedDigests()
      const timestamp = now(this.#clock)
      let deletedContent = 0
      let retainedContent = 0
      const deletionReceiptIds: string[] = []
      const nextIndex: Record<string, string> = {}
      for (const digest of digests) {
        const metadata = await this.#contentMetadata(digest)
        const contentExists = await fileExists(this.#dataPath(digest))
        if (metadata === undefined) {
          // A content blob without authority metadata is unreachable by
          // design. It can only be a crash orphan and must not accumulate.
          if (contentExists) {
            await unlinkIfExists(this.#dataPath(digest))
            deletedContent += 1
          }
          continue
        }
        if (metadata.digest !== digest
          || String(metadata.artifactId) !== `artifact-${digest}`) {
          throw new MilitaryError(
            'PERSISTENCE_FAILED',
            `artifact metadata identity drift for digest ${digest}`,
          )
        }
        const active = Object.values(metadata.references).filter(reference =>
          reference.deletedAt === undefined
          && (reference.expiresAt === undefined
            || Date.parse(reference.expiresAt) > Date.parse(timestamp)))
        const held = Object.values(metadata.references).some(reference =>
          reference.legalHoldIds.length > 0)
        const retained = Object.values(metadata.references).some(reference =>
          reference.retentionUntil !== undefined
          && Date.parse(reference.retentionUntil) > Date.parse(timestamp))
        if (active.length > 0 || held || retained) {
          if (!contentExists) {
            throw new MilitaryError(
              'PERSISTENCE_FAILED',
              `retained artifact ${String(metadata.artifactId)} has no content blob`,
            )
          }
          for (const reference of Object.values(metadata.references)) {
            const priorDigest = nextIndex[reference.referenceId]
            if (priorDigest !== undefined && priorDigest !== digest) {
              throw new MilitaryError(
                'PERSISTENCE_FAILED',
                `artifact reference ${reference.referenceId} resolves to multiple content digests`,
              )
            }
            nextIndex[reference.referenceId] = digest
          }
          retainedContent += 1
          continue
        }
        await unlinkIfExists(this.#dataPath(digest))
        await unlinkIfExists(this.#metadataPath(digest))
        for (const reference of Object.values(metadata.references)) {
          delete nextIndex[reference.referenceId]
          const deletion = await this.#deletionReceipt({
            reference,
            disposition: 'CONTENT_GARBAGE_COLLECTED',
            reason: 'no active reference, retention window or legal hold remains',
            contentDeleted: true,
            completedAt: timestamp,
          })
          deletionReceiptIds.push(deletion.deletionReceiptId)
        }
        deletedContent += 1
      }
      await this.#writeReferenceIndex({
        schemaVersion: '1.0.0',
        references: nextIndex,
      })
      const receipt: ArtifactGarbageCollectionReceipt = {
        schemaVersion: '1.0.0',
        operationId: id,
        scannedContent: digests.length,
        deletedContent,
        retainedContent,
        deletionReceiptIds,
        completedAt: timestamp,
      }
      await this.#atomicWrite(
        receiptPath,
        new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
      )
      return cloneFrozen(receipt)
    })
  }

  async rotateEncryptionKey(
    operationId: string,
  ): Promise<ArtifactKeyRotationReceipt> {
    return await this.#serialize(async () => {
      const id = normalizedToken(operationId, 'operationId')
      const receiptPath = join(this.#root, 'receipts', 'key-rotation', `${id}.json`)
      const previous = await readJson<ArtifactKeyRotationReceipt>(receiptPath)
      if (previous !== undefined) return cloneFrozen(previous)
      const old = await this.#activeKey()
      const next = await this.#createKey()
      const digests = await this.#storedDigests()
      let rotatedContent = 0
      for (const digest of digests) {
        const metadata = await this.#contentMetadata(digest)
        if (metadata?.encryption === undefined) continue
        const encrypted = new Uint8Array(await readFile(this.#dataPath(digest)))
        const clear = await this.#decrypt(encrypted, metadata.encryption)
        const encoded = await this.#encryptWithKey(clear, next)
        await this.#atomicWrite(this.#dataPath(digest), encoded.bytes)
        await this.#writeMetadata({
          ...metadata,
          encryption: encoded.encryption,
          updatedAt: now(this.#clock),
        })
        rotatedContent += 1
      }
      await this.#writeActiveKey(next)
      const receipt: ArtifactKeyRotationReceipt = {
        schemaVersion: '1.0.0',
        operationId: id,
        fromKeyId: old.keyId,
        toKeyId: next.keyId,
        rotatedContent,
        completedAt: now(this.#clock),
      }
      await this.#atomicWrite(
        receiptPath,
        new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
      )
      return cloneFrozen(receipt)
    })
  }

  async metadata(id: ArtifactId): Promise<ContentMetadata> {
    const digest = digestFromId(String(id))
    const metadata = await this.#contentMetadata(digest)
    if (metadata === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(metadata)
  }

  async #resolveReference(referenceId: string): Promise<{
    readonly metadata: ContentMetadata
    readonly reference: ArtifactAccessReference
  }> {
    const id = normalizedToken(referenceId, 'referenceId')
    const digest = (await this.#referenceIndex()).references[id]
    if (digest === undefined) {
      throw new MilitaryError('NOT_FOUND', `artifact reference ${id} not found`)
    }
    const metadata = await this.#contentMetadata(digest)
    const reference = metadata?.references[id]
    if (metadata === undefined || reference === undefined) {
      throw new MilitaryError('PERSISTENCE_FAILED', 'artifact reference index drift')
    }
    return { metadata, reference }
  }

  async #contentMetadata(digest: string): Promise<ContentMetadata | undefined> {
    const parsed = await readJson<ContentMetadata | LegacyArtifactMetadata>(
      this.#metadataPath(digest),
    )
    if (parsed === undefined) return undefined
    if ('schemaVersion' in parsed && parsed.schemaVersion === '2.0.0') {
      return parsed
    }
    if (!('ref' in parsed)) return undefined
    const timestamp = parsed.createdAt
    const referenceId = `artifact-ref-legacy-${digest}`
    const reference: ArtifactAccessReference = {
      schemaVersion: '1.0.0',
      referenceId,
      artifactId: parsed.ref.artifactId,
      contentHash: parsed.ref.sha256,
      tenantId: parsed.ref.tenantId ?? 'local',
      ...(parsed.ref.missionId === undefined
        ? {}
        : { missionId: parsed.ref.missionId }),
      ...(parsed.ref.taskId === undefined
        ? {}
        : { taskId: parsed.ref.taskId }),
      classification: parsed.ref.classification,
      ownerPrincipalId: 'military-host',
      audiencePrincipalIds: ['military-host'],
      audienceScopes: ['artifact:read'],
      residencyPolicyRef: 'local-artifact-store@1',
      legalHoldIds: [],
      lineageReferenceIds: [],
      createdAt: timestamp as ArtifactAccessReference['createdAt'],
    }
    const migrated: ContentMetadata = {
      schemaVersion: '2.0.0',
      artifactId: parsed.ref.artifactId,
      digest,
      mediaType: parsed.ref.mediaType,
      byteLength: parsed.ref.byteLength,
      highestClassification: parsed.ref.classification,
      references: { [referenceId]: reference },
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.#writeMetadata(migrated)
    const index = await this.#referenceIndex()
    await this.#writeReferenceIndex({
      schemaVersion: '1.0.0',
      references: { ...index.references, [referenceId]: digest },
    })
    return migrated
  }

  async #writeMetadata(metadata: ContentMetadata): Promise<void> {
    await this.#atomicWrite(
      this.#metadataPath(metadata.digest),
      new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
    )
  }

  async #referenceIndex(): Promise<ReferenceIndex> {
    return await readJson<ReferenceIndex>(this.#referenceIndexPath())
      ?? { schemaVersion: '1.0.0', references: {} }
  }

  async #writeReferenceIndex(index: ReferenceIndex): Promise<void> {
    await this.#atomicWrite(
      this.#referenceIndexPath(),
      new TextEncoder().encode(JSON.stringify(index, null, 2)),
    )
  }

  async #deletionReceipt(input: {
    readonly reference: ArtifactAccessReference
    readonly disposition: ArtifactDeletionReceipt['disposition']
    readonly contentDeleted: boolean
    readonly reason: string
    readonly completedAt: string
  }): Promise<ArtifactDeletionReceipt> {
    const digest = createHash('sha256')
      .update(JSON.stringify({
        referenceId: input.reference.referenceId,
        disposition: input.disposition,
        contentDeleted: input.contentDeleted,
        reason: input.reason,
        completedAt: input.completedAt,
      }))
      .digest('hex')
    const receipt: ArtifactDeletionReceipt = {
      schemaVersion: '1.0.0',
      deletionReceiptId: `artifact-deletion-${digest.slice(0, 40)}`,
      referenceId: input.reference.referenceId,
      artifactId: input.reference.artifactId,
      tenantId: input.reference.tenantId,
      disposition: input.disposition,
      contentDeleted: input.contentDeleted,
      reason: input.reason,
      completedAt: input.completedAt as ArtifactDeletionReceipt['completedAt'],
    }
    await this.#atomicWrite(
      join(this.#root, 'receipts', 'deletion', `${receipt.deletionReceiptId}.json`),
      new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
    )
    return cloneFrozen(receipt)
  }

  async #encode(
    bytes: Uint8Array,
    classification: DataClassification,
  ): Promise<{
    readonly bytes: Uint8Array
    readonly encryption?: EncryptionMetadata
  }> {
    if (!requiresEncryption(classification)) return { bytes }
    return await this.#encryptWithKey(bytes, await this.#activeKey())
  }

  async #encryptWithKey(
    bytes: Uint8Array,
    active: ActiveKey,
  ): Promise<{
    readonly bytes: Uint8Array
    readonly encryption: EncryptionMetadata
  }> {
    const key = await this.#keyBytes(active.keyId)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
    return {
      bytes: new Uint8Array(encrypted),
      encryption: {
        algorithm: 'AES-256-GCM',
        keyId: active.keyId,
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      },
    }
  }

  async #decrypt(
    bytes: Uint8Array,
    metadata: EncryptionMetadata,
  ): Promise<Uint8Array> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await this.#keyBytes(metadata.keyId),
      Buffer.from(metadata.iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(metadata.authTag, 'base64'))
    return new Uint8Array(Buffer.concat([
      decipher.update(bytes),
      decipher.final(),
    ]))
  }

  async #activeKey(): Promise<ActiveKey> {
    const current = await readJson<ActiveKey>(this.#activeKeyPath())
    if (current !== undefined) return current
    const created = await this.#createKey()
    await this.#writeActiveKey(created)
    return created
  }

  async #createKey(): Promise<ActiveKey> {
    const createdAt = now(this.#clock)
    const keyId = `local-kek-${createHash('sha256')
      .update(`${createdAt}:${randomUUID()}`)
      .digest('hex')
      .slice(0, 24)}`
    await this.#atomicWrite(this.#keyPath(keyId), new Uint8Array(randomBytes(32)))
    return { schemaVersion: '1.0.0', keyId, createdAt }
  }

  async #writeActiveKey(value: ActiveKey): Promise<void> {
    await this.#atomicWrite(
      this.#activeKeyPath(),
      new TextEncoder().encode(JSON.stringify(value, null, 2)),
    )
  }

  async #keyBytes(keyId: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(await readFile(this.#keyPath(keyId)))
    if (bytes.byteLength !== 32) {
      throw new MilitaryError('PERSISTENCE_FAILED', `invalid local key ${keyId}`)
    }
    return bytes
  }

  async #storedDigests(): Promise<readonly string[]> {
    const root = join(this.#root, 'sha256')
    const prefixes = await readdir(root, { withFileTypes: true }).catch(() => [])
    const digests = new Set<string>()
    for (const prefix of prefixes) {
      if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/u.test(prefix.name)) continue
      const entries = await readdir(join(root, prefix.name), {
        withFileTypes: true,
      })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const leaf = entry.name.endsWith('.json')
          ? entry.name.slice(0, -'.json'.length)
          : entry.name
        const digest = `${prefix.name}${leaf}`
        if (/^[a-f0-9]{64}$/u.test(digest)) digests.add(digest)
      }
    }
    return [...digests].sort()
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTail
    let release!: () => void
    this.#writeTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async #atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await unlinkIfExists(temporary)
    }
  }

  #dataPath(digest: string): string {
    return join(this.#root, 'sha256', digest.slice(0, 2), digest.slice(2))
  }

  #metadataPath(digest: string): string {
    return `${this.#dataPath(digest)}.json`
  }

  #referenceIndexPath(): string {
    return join(this.#root, 'reference-index.json')
  }

  #activeKeyPath(): string {
    return join(this.#root, 'keys', 'active.json')
  }

  #keyPath(keyId: string): string {
    return join(this.#root, 'keys', `${keyId}.key`)
  }
}

function authorizeReference(
  reference: ArtifactAccessReference,
  highestClassification: DataClassification,
  context: ArtifactAccessContext,
  action: 'read' | 'delete' | 'legal-hold',
): void {
  const timestamp = String(context.now ?? new Date().toISOString())
  if (reference.deletedAt !== undefined) throw new MilitaryError('NOT_FOUND')
  if (reference.tenantId !== context.tenantId) {
    throw new MilitaryError('UNAUTHORIZED', 'artifact tenant mismatch')
  }
  if (reference.missionId !== undefined
    && reference.missionId !== context.missionId) {
    throw new MilitaryError('UNAUTHORIZED', 'artifact Mission scope mismatch')
  }
  if (reference.taskId !== undefined
    && reference.taskId !== context.taskId) {
    throw new MilitaryError('UNAUTHORIZED', 'artifact Task scope mismatch')
  }
  if (reference.expiresAt !== undefined
    && Date.parse(reference.expiresAt) <= Date.parse(timestamp)) {
    throw new MilitaryError('UNAUTHORIZED', 'artifact reference expired')
  }
  if (classificationRank[highestClassification]
    > classificationRank[context.classificationCeiling]) {
    throw new MilitaryError(
      'POLICY_DENIED',
      'artifact classification ceiling exceeded',
    )
  }
  const principal = context.principalId === reference.ownerPrincipalId
    || reference.audiencePrincipalIds.includes(context.principalId)
  const scope = context.scopes.includes('*')
    || context.scopes.includes(`artifact:${action}`)
    || (
      action === 'read'
      && reference.audienceScopes.some(value => context.scopes.includes(value))
    )
  const grant = reference.grantId !== undefined
    && context.grantIds.includes(reference.grantId)
  if (!principal && !grant) {
    throw new MilitaryError(
      'UNAUTHORIZED',
      'artifact reference grants no matching owner, audience or capability grant',
    )
  }
  if (!scope) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `artifact:${action} scope is required`,
    )
  }
}

function maximumClassification(
  left: DataClassification,
  right: DataClassification,
): DataClassification {
  return classificationRank[left] >= classificationRank[right] ? left : right
}

function sameReferenceAuthority(
  reference: ArtifactAccessReference,
  input: Parameters<MilitaryArtifacts['put']>[0],
  tenantId: string,
): boolean {
  const missionId = input.missionId === undefined
    ? undefined
    : normalizedToken(input.missionId, 'missionId')
  const taskId = input.taskId === undefined
    ? undefined
    : normalizedToken(input.taskId, 'taskId')
  return reference.tenantId === tenantId
    && reference.missionId === missionId
    && reference.taskId === taskId
    && reference.ownerPrincipalId === normalizedToken(
      input.ownerPrincipalId ?? 'military-host',
      'ownerPrincipalId',
    )
    && reference.grantId === (input.grantId === undefined
      ? undefined
      : normalizedToken(input.grantId, 'grantId'))
    && reference.residencyPolicyRef === normalizedToken(
      input.residencyPolicyRef ?? 'local-artifact-store@1',
      'residencyPolicyRef',
    )
    && reference.retentionUntil === input.retentionUntil
    && reference.expiresAt === input.expiresAt
    && classificationRank[reference.classification]
      >= classificationRank[input.classification]
    && sameTokens(
      reference.audiencePrincipalIds,
      uniqueTokens(input.audiencePrincipalIds ?? ['military-host']),
    )
    && sameTokens(
      reference.audienceScopes,
      uniqueTokens(input.audienceScopes ?? ['artifact:read']),
    )
    && sameTokens(
      reference.legalHoldIds,
      uniqueTokens(input.legalHoldIds ?? []),
    )
    && sameTokens(
      reference.lineageReferenceIds,
      uniqueTokens(input.lineageReferenceIds ?? []),
    )
}

function sameTokens(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.length === rightSorted.length
    && leftSorted.every((value, index) => value === rightSorted[index])
}

function artifactRefFor(
  metadata: ContentMetadata,
  reference: ArtifactAccessReference,
  description?: string,
): ArtifactRef {
  return cloneFrozen({
    artifactId: metadata.artifactId,
    referenceId: reference.referenceId,
    sha256: brand<string, 'Sha256'>(metadata.digest),
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    classification: reference.classification,
    tenantId: reference.tenantId,
    ...(reference.missionId === undefined
      ? {}
      : { missionId: reference.missionId }),
    ...(reference.taskId === undefined
      ? {}
      : { taskId: reference.taskId }),
    ...(description === undefined ? {} : { description }),
  })
}

function requiresEncryption(value: DataClassification): boolean {
  return classificationRank[value] >= classificationRank.confidential
}

function uniqueTokens(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(value => normalizedToken(value, 'token')))].sort()
}

function normalizedToken(value: string, at: string): string {
  const normalized = value.trim()
  if (normalized === ''
    || normalized.length > 240
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${at} must be a non-empty bounded token`)
  }
  return normalized
}

function boundedReason(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized === '') throw new TypeError('artifact deletion reason is required')
  return normalized.slice(0, 1_000)
}

function digestFromId(id: string): string {
  const digest = id.startsWith('artifact-')
    ? id.slice('artifact-'.length)
    : id
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new MilitaryError('INVALID_ARGUMENT', 'invalid artifact id')
  }
  return digest
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isEnoent(error)) return undefined
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'governed artifact metadata is unreadable or malformed',
    )
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isEnoent(error)) throw error
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isEnoent(error)) return false
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
