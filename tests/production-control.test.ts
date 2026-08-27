import assert from 'node:assert/strict'
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  MilitaryError,
} from '@dsh-military/contracts'
import {
  assessProductionReadiness,
  CorrelatedMilitaryTelemetry,
  InMemoryDurableQueue,
  type MilitaryTelemetryExporter,
} from '@dsh-military/core'
import {
  LocalEd25519AssetSigner,
} from '@dsh-military/infrastructure'
import {
  SqliteMilitaryDatabase,
  SqliteTenantCapacityControl,
  createSqliteProductionPlane,
  sqliteProductionProviders,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'

test('correlated telemetry preserves nested trace authority and degrades truthfully when export fails', async () => {
  const exported: string[] = []
  const exporter: MilitaryTelemetryExporter = {
    exporterId: 'test-otlp',
    export(record) {
      exported.push(record.kind)
      if (record.kind === 'LOG' && record.value.message === 'fail export') {
        throw new Error('collector unavailable')
      }
    },
  }
  const telemetry = new CorrelatedMilitaryTelemetry({
    exporter,
    maximumRecords: 32,
  })
  const contexts = await telemetry.withSpan({
    name: 'mission.dispatch',
    tenantId: 'tenant-prod',
    missionId: 'mission-prod',
    taskId: 'task-prod',
    operationId: 'operation-prod',
  }, async () => {
    const parentContext = telemetry.currentContext()
    telemetry.recordMetric({
      name: 'military.dispatch.count',
      kind: 'COUNTER',
      value: 1,
      unit: 'dispatches',
    })
    const childContext = await telemetry.withSpan({
      name: 'provider.call',
      tenantId: 'tenant-prod',
    }, async () => {
      return telemetry.currentContext()
    })
    return { parentContext, childContext }
  })
  assert.ok(contexts.parentContext)
  assert.ok(contexts.childContext)
  assert.equal(
    contexts.childContext.traceId,
    contexts.parentContext.traceId,
  )
  assert.equal(
    contexts.childContext.parentSpanId,
    contexts.parentContext.spanId,
  )

  await assert.rejects(
    telemetry.withSpan({
      name: 'provider.failure',
      tenantId: 'tenant-prod',
    }, async () => {
      throw new MilitaryError('CAPACITY_EXHAUSTED')
    }),
    failure('CAPACITY_EXHAUSTED'),
  )
  telemetry.log({
    level: 'ERROR',
    message: 'fail export',
  })
  await new Promise<void>(resolve => {
    setImmediate(resolve)
  })
  const snapshot = telemetry.snapshot()
  assert.equal(snapshot.exporter, 'OTEL_DEGRADED')
  assert.ok(snapshot.droppedRecords >= 1)
  assert.equal(
    snapshot.spans.find(value => value.name === 'provider.failure')?.errorCode,
    'CAPACITY_EXHAUSTED',
  )
  assert.ok(snapshot.metrics.some(value =>
    value.context?.missionId === 'mission-prod'))
  assert.ok(exported.includes('SPAN'))
})

test('durable queue seam preserves idempotency and partition order independently of SQLite', async () => {
  const queue = new InMemoryDurableQueue('tenant-queue-contract')
  const observed: string[] = []
  queue.register('task.continue', async message => {
    observed.push(message.eventId)
  })
  queue.enqueue({
    topic: 'task.continue',
    partitionKey: 'task-1',
    eventId: 'event-1',
    payload: { sequence: 1 },
  })
  queue.enqueue({
    topic: 'task.continue',
    partitionKey: 'task-1',
    eventId: 'event-2',
    payload: { sequence: 2 },
  })
  queue.enqueue({
    topic: 'task.continue',
    partitionKey: 'task-1',
    eventId: 'event-1',
    payload: { sequence: 1 },
  })
  assert.throws(() => {
    queue.enqueue({
      topic: 'task.continue',
      partitionKey: 'task-1',
      eventId: 'event-1',
      payload: { sequence: 99 },
    })
  }, failure('IDEMPOTENCY_CONFLICT'))
  assert.deepEqual(await queue.dispatchAvailable({ limit: 8 }), {
    delivered: 2,
    failed: 0,
    deadLettered: 0,
    remaining: 0,
  })
  assert.deepEqual(observed, ['event-1', 'event-2'])
})

test('distributed readiness rejects local descriptors and validates exact external provider topology', () => {
  const local = assessProductionReadiness(
    sqliteProductionProviders(),
    'DISTRIBUTED_REGIONAL',
  )
  assert.equal(local.ready, false)
  assert.ok(local.errors.some(value => value.includes('not EXTERNAL')))
  assert.ok(local.errors.some(value => value.includes('below REGIONAL')))

  const external = sqliteProductionProviders().map(value => ({
    ...value,
    providerId: `external-${value.kind.toLowerCase()}`,
    implementation: `DeploymentBound${value.kind}`,
    deployment: 'EXTERNAL' as const,
    status: 'READY' as const,
    durability: 'MULTI_REGION' as const,
    tenantIsolation: value.kind === 'OBJECT_STORE'
      ? 'BUCKET_PREFIX' as const
      : 'EXTERNAL_POLICY' as const,
    limitations: [],
  }))
  assert.deepEqual(
    assessProductionReadiness(external, 'DISTRIBUTED_MULTI_REGION'),
    {
      schemaVersion: '1.0.0',
      target: 'DISTRIBUTED_MULTI_REGION',
      ready: true,
      providerIds: external.map(value => value.providerId).sort(),
      errors: [],
      warnings: [],
    },
  )
})

test('SQLite tenant capacity is CAS-fenced, idempotent and durable across restart', async () => {
  const temporary = await temporaryDirectory('military-capacity-')
  const path = join(temporary.path, 'military.sqlite')
  const limits = {
    tenantId: 'tenant-capacity',
    revision: 1,
    activeTasks: 2,
    activeAgents: 2,
    modelConcurrency: 1,
    pendingOutbox: 10,
    storageBytes: 1_024,
  } as const
  let database = new SqliteMilitaryDatabase({ path })
  try {
    let capacity = new SqliteTenantCapacityControl(
      database,
      'tenant-capacity',
      limits,
    )
    const requested = {
      activeTasks: 1,
      activeAgents: 1,
      modelConcurrency: 1,
      pendingOutbox: 0,
      storageBytes: 64,
    }
    const first = await capacity.admit({
      reservationId: 'capacity-reservation-1',
      tenantId: 'tenant-capacity',
      payloadHash: 'payload-hash-1',
      requested,
    })
    const duplicate = await capacity.admit({
      reservationId: 'capacity-reservation-1',
      tenantId: 'tenant-capacity',
      payloadHash: 'payload-hash-1',
      requested,
    })
    assert.deepEqual(duplicate, first)
    await assert.rejects(capacity.admit({
      reservationId: 'capacity-reservation-1',
      tenantId: 'tenant-capacity',
      payloadHash: 'payload-changed',
      requested,
    }), failure('IDEMPOTENCY_CONFLICT'))
    await assert.rejects(capacity.admit({
      reservationId: 'capacity-reservation-2',
      tenantId: 'tenant-capacity',
      payloadHash: 'payload-hash-2',
      requested,
    }), failure('CAPACITY_EXHAUSTED'))
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    capacity = new SqliteTenantCapacityControl(
      database,
      'tenant-capacity',
      limits,
    )
    assert.equal((await capacity.snapshot('tenant-capacity')).activeReservations, 1)
    const released = await capacity.release(
      'capacity-reservation-1',
      'tenant-capacity',
    )
    assert.equal(released.state, 'RELEASED')
    assert.deepEqual(
      await capacity.release(
        'capacity-reservation-1',
        'tenant-capacity',
      ),
      released,
    )
    const configured = await capacity.configure({
      ...limits,
      revision: 2,
      modelConcurrency: 2,
    })
    assert.equal(configured.revision, 2)
    assert.equal((await capacity.snapshot('tenant-capacity')).usage.activeAgents, 0)
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('SQLite production plane creates signed backups and performs an isolated restore drill', async () => {
  const temporary = await temporaryDirectory('military-production-plane-')
  const dataRoot = join(temporary.path, 'data')
  const path = join(dataRoot, 'military.sqlite')
  const database = new SqliteMilitaryDatabase({ path })
  try {
    database.db.prepare(`
      INSERT INTO mission_streams(
        tenant_id, mission_id, aggregate_revision, last_seq,
        status, created_at, updated_at
      ) VALUES (?, ?, 0, 0, 'ACTIVE', ?, ?)
    `).run(
      'tenant-production',
      'mission-production',
      '2026-08-27T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z',
    )
    const signer = new LocalEd25519AssetSigner(
      join(dataRoot, 'signing-keys'),
    )
    const production = createSqliteProductionPlane({
      database,
      databasePath: path,
      dataRoot,
      tenantId: 'tenant-production',
      signer,
    })
    const created = await production.backups.create({
      operationId: 'nightly-2026-08-27',
      tenantId: 'tenant-production',
    })
    assert.equal(created.status, 'CREATED')
    assert.ok(created.signature)
    assert.deepEqual(
      await production.backups.create({
        operationId: 'nightly-2026-08-27',
        tenantId: 'tenant-production',
      }),
      created,
    )
    const verified = await production.backups.verify(
      created.backupId,
      'tenant-production',
    )
    assert.equal(verified.status, 'VERIFIED')
    const drilled = await production.backups.restoreDrill(
      created.backupId,
      'tenant-production',
    )
    assert.equal(drilled.status, 'DRILL_PASSED')
    assert.ok(drilled.evidence.includes('restore-drill-integrity:ok'))
    const snapshot = await production.snapshot('tenant-production')
    assert.equal(snapshot.backups[0]?.status, 'DRILL_PASSED')
    assert.deepEqual(
      new Set(snapshot.providers.map(value => value.kind)),
      new Set([
        'LEDGER',
        'OBJECT_STORE',
        'QUEUE',
        'KEY_MANAGEMENT',
        'CAPACITY',
        'TELEMETRY',
        'BACKUP',
        'ASSET_SIGNING',
        'RESIDENCY',
      ]),
    )
    assert.ok(snapshot.providers.find(value =>
      value.kind === 'LEDGER')?.limitations.some(value =>
        value.includes('PostgreSQL')))

    const privateKey = (await readdir(
      join(dataRoot, 'signing-keys'),
    )).find(value => value.endsWith('.private.pem'))
    assert.ok(privateKey)
    assert.equal(
      (await stat(join(dataRoot, 'signing-keys', privateKey!))).mode & 0o777,
      0o600,
    )

    const backupPath = join(
      dataRoot,
      'backups',
      `${created.backupId}.sqlite`,
    )
    const original = await readFile(backupPath)
    await writeFile(backupPath, new Uint8Array([0, ...original.subarray(1)]))
    await assert.rejects(
      production.backups.verify(created.backupId, 'tenant-production'),
      failure('PERSISTENCE_FAILED'),
    )
    await writeFile(backupPath, original)
    await chmod(backupPath, 0o600)
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('durable Ed25519 signer verifies pre-rotation assets after key rotation', async () => {
  const temporary = await temporaryDirectory('military-signing-')
  try {
    const signer = new LocalEd25519AssetSigner(temporary.path)
    const payload = new TextEncoder().encode('signed military asset')
    const first = await signer.sign(payload)
    assert.equal(await signer.verify(payload, first), true)
    assert.equal(
      await signer.verify(new TextEncoder().encode('changed'), first),
      false,
    )
    const nextKey = await signer.rotate()
    assert.notEqual(nextKey, first.keyId)
    assert.equal(await signer.verify(payload, first), true)
    const second = await signer.sign(payload)
    assert.equal(second.keyId, nextKey)
    assert.equal(await signer.verify(payload, second), true)
  } finally {
    await temporary.dispose()
  }
})

function failure(code: string): (error: unknown) => boolean {
  return error =>
    error instanceof MilitaryError
    && error.failure.code === code
}
