import assert from 'node:assert/strict'
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  MilitaryError,
  type ArtifactAccessContext,
  type IsoDateTime,
} from '@dsh-military/contracts'
import { LocalArtifactStore } from '@dsh-military/infrastructure'
import { temporaryDirectory } from '@dsh-military/testkit'

const text = new TextEncoder()

test('artifact references require tenant, workflow, audience/grant, scope and classification authority', async () => {
  const temporary = await temporaryDirectory('military-artifact-acl-')
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const store = new LocalArtifactStore(
    temporary.path,
    () => new Date(timestamp),
  )
  try {
    const first = await store.put({
      bytes: text.encode('shared classified payload'),
      mediaType: 'text/plain',
      classification: 'internal',
      tenantId: 'tenant-a',
      missionId: 'mission-a',
      taskId: 'task-a',
      ownerPrincipalId: 'alice',
      audiencePrincipalIds: ['bob'],
      audienceScopes: ['artifact:read'],
      grantId: 'grant-a',
      residencyPolicyRef: 'local-korea@1',
    })
    assert.ok(first.referenceId)
    const alice = access({
      tenantId: 'tenant-a',
      missionId: 'mission-a',
      taskId: 'task-a',
      principalId: 'alice',
      scopes: ['artifact:read'],
      classificationCeiling: 'internal',
    })
    assert.equal(
      new TextDecoder().decode(await store.read(first.referenceId!, alice)),
      'shared classified payload',
    )
    await assert.rejects(
      store.read(first.referenceId!, {
        ...alice,
        principalId: 'mallory',
      }),
      militaryFailure('UNAUTHORIZED'),
    )
    await assert.rejects(
      store.read(first.referenceId!, {
        ...alice,
        principalId: 'bob',
        scopes: [],
      }),
      militaryFailure('POLICY_DENIED'),
    )
    assert.equal(
      new TextDecoder().decode(await store.read(first.referenceId!, {
        ...alice,
        principalId: 'automation',
        grantIds: ['grant-a'],
      })),
      'shared classified payload',
    )
    for (const denied of [
      { ...alice, tenantId: 'tenant-b' },
      { ...alice, missionId: 'mission-b' },
      { ...alice, taskId: 'task-b' },
      { ...alice, classificationCeiling: 'public' as const },
    ]) {
      await assert.rejects(
        store.read(first.referenceId!, denied),
        error => error instanceof MilitaryError,
      )
    }

    const elevated = await store.put({
      bytes: text.encode('shared classified payload'),
      mediaType: 'text/plain',
      classification: 'restricted',
      tenantId: 'tenant-b',
      ownerPrincipalId: 'tenant-b-owner',
      audiencePrincipalIds: ['tenant-b-owner'],
      audienceScopes: ['artifact:read'],
    })
    assert.equal(elevated.artifactId, first.artifactId)
    assert.equal(
      (await store.reference(first.referenceId!)).classification,
      'restricted',
      'deduplicated content must adopt the highest classification on every reference',
    )
    await assert.rejects(
      store.read(first.referenceId!, alice),
      militaryFailure('POLICY_DENIED'),
    )
    const metadata = await store.metadata(first.artifactId)
    assert.equal(metadata.highestClassification, 'restricted')
    assert.equal(metadata.encryption?.algorithm, 'AES-256-GCM')
    const digest = String(first.sha256)
    const raw = await readFile(join(
      temporary.path,
      'sha256',
      digest.slice(0, 2),
      digest.slice(2),
    ))
    assert.doesNotMatch(raw.toString('utf8'), /shared classified payload/u)
  } finally {
    await temporary.dispose()
  }
})

test('artifact lineage elevates classification and cannot cross tenants', async () => {
  const temporary = await temporaryDirectory('military-artifact-lineage-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const source = await store.put({
      bytes: text.encode('source'),
      mediaType: 'text/plain',
      classification: 'confidential',
      tenantId: 'tenant-lineage',
      ownerPrincipalId: 'owner',
    })
    const derived = await store.put({
      bytes: text.encode('derived'),
      mediaType: 'text/plain',
      classification: 'public',
      tenantId: 'tenant-lineage',
      ownerPrincipalId: 'owner',
      lineageReferenceIds: [source.referenceId!],
    })
    assert.equal(derived.classification, 'confidential')
    await assert.rejects(
      store.put({
        bytes: text.encode('cross tenant derived'),
        mediaType: 'text/plain',
        classification: 'public',
        tenantId: 'other-tenant',
        ownerPrincipalId: 'owner',
        lineageReferenceIds: [source.referenceId!],
      }),
      militaryFailure('UNAUTHORIZED'),
    )
  } finally {
    await temporary.dispose()
  }
})

test('artifact operation keys replay one authority reference and reject semantic reuse', async () => {
  const temporary = await temporaryDirectory('military-artifact-idempotency-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const input = {
      bytes: text.encode('idempotent artifact'),
      mediaType: 'text/plain',
      classification: 'confidential' as const,
      tenantId: 'tenant-idempotency',
      missionId: 'mission-idempotency',
      taskId: 'task-idempotency',
      ownerPrincipalId: 'owner',
      audiencePrincipalIds: ['owner'],
      audienceScopes: ['artifact:read'],
      idempotencyKey: 'operation-1',
    }
    const first = await store.put(input)
    const replay = await store.put(input)
    assert.deepEqual(replay, first)
    await assert.rejects(
      store.put({
        ...input,
        bytes: text.encode('different content'),
      }),
      militaryFailure('IDEMPOTENCY_CONFLICT'),
    )
    await assert.rejects(
      store.put({
        ...input,
        audiencePrincipalIds: ['other-principal'],
      }),
      militaryFailure('IDEMPOTENCY_CONFLICT'),
    )
    await assert.rejects(
      store.put({
        ...input,
        idempotencyKey: 'operation-2',
        mediaType: 'application/json',
      }),
      militaryFailure('IDEMPOTENCY_CONFLICT'),
    )
  } finally {
    await temporary.dispose()
  }
})

test('artifact retention, legal hold, deletion, GC and key rotation are durable and idempotent', async () => {
  const temporary = await temporaryDirectory('military-artifact-lifecycle-')
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const store = new LocalArtifactStore(
    temporary.path,
    () => new Date(timestamp),
  )
  try {
    const ref = await store.put({
      bytes: text.encode('retained secret'),
      mediaType: 'text/plain',
      classification: 'restricted',
      tenantId: 'tenant-lifecycle',
      ownerPrincipalId: 'owner',
      audiencePrincipalIds: ['owner'],
      audienceScopes: ['artifact:read'],
      retentionUntil: iso('2026-08-28T00:00:00.000Z'),
    })
    const context = access({
      tenantId: 'tenant-lifecycle',
      principalId: 'owner',
      scopes: [
        'artifact:read',
        'artifact:delete',
        'artifact:legal-hold',
      ],
      classificationCeiling: 'restricted',
    })
    const held = await store.setLegalHold({
      referenceId: ref.referenceId!,
      holdId: 'legal-case-1',
      active: true,
      context,
    })
    assert.deepEqual(held.legalHoldIds, ['legal-case-1'])
    assert.equal((await store.deleteReference({
      referenceId: ref.referenceId!,
      context,
      reason: 'test deletion while held',
    })).disposition, 'LEGAL_HOLD_BLOCKED')
    await store.setLegalHold({
      referenceId: ref.referenceId!,
      holdId: 'legal-case-1',
      active: false,
      context,
    })
    assert.equal((await store.deleteReference({
      referenceId: ref.referenceId!,
      context,
      reason: 'test deletion during retention',
    })).disposition, 'RETENTION_BLOCKED')

    const rotation = await store.rotateEncryptionKey('rotate-1')
    const replayedRotation = await store.rotateEncryptionKey('rotate-1')
    assert.deepEqual(replayedRotation, rotation)
    assert.notEqual(rotation.fromKeyId, rotation.toKeyId)
    assert.equal(rotation.rotatedContent, 1)
    assert.equal(
      new TextDecoder().decode(await store.read(ref.referenceId!, context)),
      'retained secret',
    )
    const keyMode = (await stat(join(
      temporary.path,
      'keys',
      `${rotation.toKeyId}.key`,
    ))).mode & 0o777
    assert.equal(keyMode, 0o600)

    timestamp = Date.parse('2026-08-29T00:00:00.000Z')
    const deletion = await store.deleteReference({
      referenceId: ref.referenceId!,
      context: { ...context, now: iso('2026-08-29T00:00:00.000Z') },
      reason: 'retention elapsed',
    })
    assert.equal(deletion.disposition, 'REFERENCE_DELETED')
    const gc = await store.garbageCollect('gc-1')
    assert.equal(gc.deletedContent, 1)
    assert.ok(gc.deletionReceiptIds.length >= 1)
    assert.deepEqual(await store.garbageCollect('gc-1'), gc)
    await assert.rejects(
      store.get(ref.artifactId),
      militaryFailure('NOT_FOUND'),
    )
  } finally {
    await temporary.dispose()
  }
})

test('corrupt governed artifact metadata fails closed instead of being treated as missing', async () => {
  const temporary = await temporaryDirectory('military-artifact-corrupt-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const ref = await store.put({
      bytes: text.encode('governed'),
      mediaType: 'text/plain',
      classification: 'internal',
      tenantId: 'tenant-corrupt',
      ownerPrincipalId: 'owner',
    })
    await writeFile(
      join(temporary.path, 'reference-index.json'),
      '{ malformed',
      { mode: 0o600 },
    )
    await assert.rejects(
      store.reference(ref.referenceId!),
      militaryFailure('PERSISTENCE_FAILED'),
    )
  } finally {
    await temporary.dispose()
  }
})

test('tampered governed artifact bytes fail authentication before any caller can read them', async () => {
  const temporary = await temporaryDirectory('military-artifact-bytes-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const ref = await store.put({
      bytes: text.encode('original governed bytes'),
      mediaType: 'text/plain',
      classification: 'internal',
      tenantId: 'tenant-byte-integrity',
      ownerPrincipalId: 'owner',
      audiencePrincipalIds: ['owner'],
      audienceScopes: ['artifact:read'],
    })
    const digest = String(ref.sha256)
    await writeFile(
      join(
        temporary.path,
        'sha256',
        digest.slice(0, 2),
        digest.slice(2),
      ),
      text.encode('tampered governed bytes'),
      { mode: 0o600 },
    )
    await assert.rejects(
      store.get(ref.artifactId),
      militaryFailure('PERSISTENCE_FAILED'),
    )
    await assert.rejects(
      store.read(ref.referenceId!, access({
        tenantId: 'tenant-byte-integrity',
        principalId: 'owner',
        scopes: ['artifact:read'],
        classificationCeiling: 'internal',
      })),
      militaryFailure('PERSISTENCE_FAILED'),
    )
  } finally {
    await temporary.dispose()
  }
})

test('artifact GC reconstructs the authority index and deletes metadata-free crash orphans', async () => {
  const temporary = await temporaryDirectory('military-artifact-gc-repair-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const ref = await store.put({
      bytes: text.encode('active governed artifact'),
      mediaType: 'text/plain',
      classification: 'internal',
      tenantId: 'tenant-gc-repair',
      ownerPrincipalId: 'owner',
      audiencePrincipalIds: ['owner'],
      audienceScopes: ['artifact:read'],
      idempotencyKey: 'active-reference',
    })
    await writeFile(
      join(temporary.path, 'reference-index.json'),
      JSON.stringify({ schemaVersion: '1.0.0', references: {} }),
    )
    const orphanDigest = 'f'.repeat(64)
    const orphanPath = join(
      temporary.path,
      'sha256',
      orphanDigest.slice(0, 2),
      orphanDigest.slice(2),
    )
    await mkdir(join(temporary.path, 'sha256', orphanDigest.slice(0, 2)), {
      recursive: true,
    })
    await writeFile(orphanPath, 'unreachable crash orphan')

    const receipt = await store.garbageCollect('gc-index-repair')
    assert.equal(receipt.scannedContent, 2)
    assert.equal(receipt.retainedContent, 1)
    assert.equal(receipt.deletedContent, 1)
    assert.equal(
      new TextDecoder().decode(await store.read(
        ref.referenceId!,
        access({
          tenantId: 'tenant-gc-repair',
          principalId: 'owner',
          scopes: ['artifact:read'],
          classificationCeiling: 'internal',
        }),
      )),
      'active governed artifact',
    )
    await assert.rejects(
      stat(orphanPath),
      error => isEnoent(error),
    )
  } finally {
    await temporary.dispose()
  }
})

test('artifact GC fails closed when retained authority metadata has lost its content blob', async () => {
  const temporary = await temporaryDirectory('military-artifact-gc-drift-')
  const store = new LocalArtifactStore(temporary.path)
  try {
    const ref = await store.put({
      bytes: text.encode('must remain readable'),
      mediaType: 'text/plain',
      classification: 'internal',
      tenantId: 'tenant-gc-drift',
      ownerPrincipalId: 'owner',
    })
    const digest = String(ref.sha256)
    await unlink(join(
      temporary.path,
      'sha256',
      digest.slice(0, 2),
      digest.slice(2),
    ))
    await assert.rejects(
      store.garbageCollect('gc-retained-drift'),
      militaryFailure('PERSISTENCE_FAILED'),
    )
  } finally {
    await temporary.dispose()
  }
})

function access(input: {
  readonly tenantId: string
  readonly missionId?: string
  readonly taskId?: string
  readonly principalId: string
  readonly scopes: readonly string[]
  readonly classificationCeiling:
    | 'public'
    | 'internal'
    | 'confidential'
    | 'restricted'
}): ArtifactAccessContext {
  return {
    ...input,
    grantIds: [],
  }
}

function iso(value: string): IsoDateTime {
  return value as IsoDateTime
}

function militaryFailure(code: string): (error: unknown) => boolean {
  return error =>
    error instanceof MilitaryError
    && error.failure.code === code
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
