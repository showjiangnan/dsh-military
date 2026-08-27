import assert from 'node:assert/strict'
import test from 'node:test'
import { MilitaryError } from '@dsh-military/contracts'
import {
  SqliteMilitaryDatabase,
  SqliteStateRecords,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'

test('SQLite durable state rejects concurrent lost updates and permits explicit retry', async () => {
  const temporary = await temporaryDirectory('military-state-cas-')
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const records = new SqliteStateRecords(database, 'tenant-cas')
    records.putSync('counter', 'one', { value: 0 }, { createOnly: true })
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const increment = () => records.update(
      'counter',
      'one',
      () => ({ value: 0 }),
      async current => {
        arrivals += 1
        if (arrivals === 2) release()
        await gate
        return {
          next: { value: current.value + 1 },
          result: current.value + 1,
        }
      },
    )
    const settled = await Promise.allSettled([increment(), increment()])
    assert.equal(
      settled.filter(value => value.status === 'fulfilled').length,
      1,
    )
    const rejected = settled.find(value => value.status === 'rejected')
    assert.ok(rejected?.status === 'rejected')
    assert.ok(rejected.reason instanceof MilitaryError)
    assert.equal(rejected.reason.failure.code, 'REVISION_CONFLICT')
    assert.deepEqual(records.readSync('counter', 'one'), { value: 1 })

    assert.equal(await incrementWithoutGate(records), 2)
    assert.deepEqual(records.readSync('counter', 'one'), { value: 2 })
  } finally {
    database.close()
    await temporary.dispose()
  }
})

async function incrementWithoutGate(
  records: SqliteStateRecords,
): Promise<number> {
  return await records.update(
    'counter',
    'one',
    () => ({ value: 0 }),
    current => ({
      next: { value: current.value + 1 },
      result: current.value + 1,
    }),
  )
}
