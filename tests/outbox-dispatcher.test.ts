import assert from 'node:assert/strict'
import test from 'node:test'
import { MilitaryError } from '@dsh-military/contracts'
import {
  SqliteMilitaryDatabase,
  SqliteOutboxDispatcher,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'

test('transactional outbox retries across restart and advances ordered partition offsets only after delivery', async () => {
  const temporary = await temporaryDirectory('military-outbox-')
  const path = `${temporary.path}/military.sqlite`
  let database = new SqliteMilitaryDatabase({ path })
  try {
    const first = new SqliteOutboxDispatcher(database, 'tenant-outbox')
    first.enqueue({
      topic: 'task.continue',
      partitionKey: 'task-1',
      eventId: 'event-1',
      payload: { sequence: 1 },
    })
    first.enqueue({
      topic: 'task.continue',
      partitionKey: 'task-1',
      eventId: 'event-2',
      payload: { sequence: 2 },
    })
    first.enqueue({
      topic: 'task.continue',
      partitionKey: 'task-1',
      eventId: 'event-1',
      payload: { sequence: 1 },
    })
    await assert.rejects(async () => {
      first.enqueue({
        topic: 'task.continue',
        partitionKey: 'task-1',
        eventId: 'event-1',
        payload: { sequence: 99 },
      })
    }, militaryFailure('IDEMPOTENCY_CONFLICT'))
    first.register('task.continue', async message => {
      assert.equal(message.eventId, 'event-1')
      throw new Error('transient provider failure')
    })
    assert.deepEqual(await first.dispatchAvailable({
      workerId: 'worker-before-restart',
      limit: 2,
      maximumAttempts: 3,
    }), {
      delivered: 0,
      failed: 1,
      deadLettered: 0,
      remaining: 2,
    })
    assert.equal(
      count(database, 'outbox_delivery_receipts'),
      0,
      'event-2 must not overtake the failed predecessor in one partition',
    )
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    database.db.prepare(`
      UPDATE transactional_outbox
      SET available_at = ?
      WHERE tenant_id = ? AND delivered_at IS NULL
    `).run('2026-01-01T00:00:00.000Z', 'tenant-outbox')
    const delivered: string[] = []
    const resumed = new SqliteOutboxDispatcher(database, 'tenant-outbox')
    resumed.register('task.continue', async message => {
      delivered.push(message.eventId)
    })
    assert.deepEqual(await resumed.dispatchAvailable({
      workerId: 'worker-after-restart',
      limit: 8,
      maximumAttempts: 3,
    }), {
      delivered: 2,
      failed: 0,
      deadLettered: 0,
      remaining: 0,
    })
    assert.deepEqual(delivered, ['event-1', 'event-2'])
    const receipts = database.db.prepare(`
      SELECT event_id, attempts
      FROM outbox_delivery_receipts
      WHERE tenant_id = ?
      ORDER BY outbox_id
    `).all('tenant-outbox') as unknown as Array<{
      readonly event_id: string
      readonly attempts: number
    }>
    assert.deepEqual(receipts.map(row => ({
      event_id: row.event_id,
      attempts: row.attempts,
    })), [
      { event_id: 'event-1', attempts: 2 },
      { event_id: 'event-2', attempts: 1 },
    ])
    const offset = database.db.prepare(`
      SELECT last_event_id
      FROM outbox_consumer_offsets
      WHERE tenant_id = ? AND topic = ? AND partition_key = ?
    `).get(
      'tenant-outbox',
      'task.continue',
      'task-1',
    ) as { readonly last_event_id: string }
    assert.equal(offset.last_event_id, 'event-2')
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('transactional outbox records bounded dead letters without reporting delivery', async () => {
  const temporary = await temporaryDirectory('military-outbox-dead-letter-')
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const outbox = new SqliteOutboxDispatcher(database, 'tenant-outbox')
    outbox.enqueue({
      topic: 'unhandled.topic',
      partitionKey: 'partition-1',
      eventId: 'event-dead',
      payload: { safe: true },
    })
    assert.deepEqual(await outbox.dispatchAvailable({
      workerId: 'dead-letter-worker',
      maximumAttempts: 1,
    }), {
      delivered: 0,
      failed: 0,
      deadLettered: 1,
      remaining: 0,
    })
    const row = database.db.prepare(`
      SELECT dead_lettered_at, delivered_at, last_error
      FROM transactional_outbox
      WHERE tenant_id = ? AND event_id = ?
    `).get('tenant-outbox', 'event-dead') as {
      readonly dead_lettered_at: string | null
      readonly delivered_at: string | null
      readonly last_error: string
    }
    assert.ok(row.dead_lettered_at)
    assert.equal(row.delivered_at, null)
    assert.match(row.last_error, /^MILITARY_NOT_FOUND;fingerprint=[a-f0-9]{24}$/u)
    assert.doesNotMatch(row.last_error, /no outbox handler/u)
    assert.equal(count(database, 'outbox_delivery_receipts'), 0)
    assert.equal(
      count(
        database,
        'durable_state_records',
        "namespace = 'outbox-dead-letter'",
      ),
      1,
    )
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('transactional outbox attempt fence prevents an expired handler from acknowledging a reclaimed message', async () => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  try {
    const outbox = new SqliteOutboxDispatcher(database, 'tenant-outbox-fence')
    outbox.enqueue({
      topic: 'fenced.topic',
      partitionKey: 'partition-fenced',
      eventId: 'event-fenced',
      payload: { safe: true },
    })
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let firstEntered!: () => void
    const entered = new Promise<void>(resolve => {
      firstEntered = resolve
    })
    let calls = 0
    outbox.register('fenced.topic', async () => {
      calls += 1
      if (calls === 1) {
        firstEntered()
        await firstBlocked
      }
    })
    const staleWorker = outbox.dispatchAvailable({
      workerId: 'stale-worker',
      limit: 1,
      leaseMs: 1_000,
    })
    await entered
    database.db.prepare(`
      UPDATE transactional_outbox
      SET claimed_until = '2026-01-01T00:00:00.000Z'
      WHERE tenant_id = ? AND event_id = ?
    `).run('tenant-outbox-fence', 'event-fenced')
    const currentWorker = await outbox.dispatchAvailable({
      workerId: 'current-worker',
      limit: 1,
      leaseMs: 1_000,
    })
    assert.equal(currentWorker.delivered, 1)
    releaseFirst()
    await assert.rejects(staleWorker, militaryFailure('REVISION_CONFLICT'))

    const row = database.db.prepare(`
      SELECT delivered_at, attempts, claimed_by, last_error
      FROM transactional_outbox
      WHERE tenant_id = ? AND event_id = ?
    `).get('tenant-outbox-fence', 'event-fenced') as {
      readonly delivered_at: string | null
      readonly attempts: number
      readonly claimed_by: string | null
      readonly last_error: string | null
    }
    assert.ok(row.delivered_at)
    assert.equal(row.attempts, 2)
    assert.equal(row.claimed_by, null)
    assert.equal(row.last_error, null)
    assert.equal(count(database, 'outbox_delivery_receipts'), 1)
  } finally {
    database.close()
  }
})

function count(
  database: SqliteMilitaryDatabase,
  table: string,
  predicate = '1 = 1',
): number {
  const row = database.db.prepare(
    `SELECT count(*) AS count FROM "${table}" WHERE ${predicate}`,
  ).get() as { readonly count: number }
  return row.count
}

function militaryFailure(code: string): (error: unknown) => boolean {
  return error =>
    error instanceof MilitaryError
    && error.failure.code === code
}
