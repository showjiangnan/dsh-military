import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  missionEvent,
  type MilitaryLedger,
  type MissionEvent,
} from '@dsh-military/contracts'
import { InMemoryMilitaryLedger, reduceTaskTransition } from '@dsh-military/core'
import {
  SqliteMilitaryDatabase,
  SqliteMilitaryLedger,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, missionId } from './helpers.js'

test('a leased Worker may submit a corrected Candidate directly from REWORK', () => {
  assert.equal(reduceTaskTransition('REWORK', 'CANDIDATE_SUBMITTED'), 'CANDIDATE_SUBMITTED')
})

test('a user abort is a terminal Task cancellation in every ledger projection', async () => {
  const temp = await temporaryDirectory('military-task-cancelled-')
  const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
  try {
    const memory = new InMemoryMilitaryLedger()
    const sqlite = new SqliteMilitaryLedger(database, 'tenant-1')
    const mission = missionId('task-cancelled-mission')
    const general = identity('general')
    const worker = identity('worker')
    const taskId = 'task-cancelled'
    const events: MissionEvent[] = [
      missionEvent({
        type: 'task/created',
        missionId: mission,
        actor: general,
        payload: { taskId, taskVersion: 1, taskOrderRef: 'task-order:cancelled' },
      }),
      missionEvent({
        type: 'task/leased',
        missionId: mission,
        actor: worker,
        payload: {
          taskId,
          taskVersion: 1,
          agent: worker,
          workspaceLeaseId: 'lease-cancelled',
          leaseExpiresAt: brand<string, 'IsoDateTime'>(
            new Date(Date.now() + 60_000).toISOString(),
          ),
        },
      }),
      missionEvent({
        type: 'task/cancelled',
        missionId: mission,
        actor: worker,
        payload: {
          taskId,
          taskVersion: 1,
          reasonCode: 'USER_CANCELLED',
          cancelledAgentId: String(worker.agentId),
        },
      }),
    ]
    for (const event of events) {
      await append(memory, event)
      await append(sqlite, event)
    }
    const key = brand<string, 'TaskId'>(taskId)
    assert.equal((await memory.readMission(mission)).tasks.get(key)?.state, 'CANCELLED')
    assert.equal((await sqlite.readMission(mission)).tasks.get(key)?.state, 'CANCELLED')
  } finally {
    database.close()
    await temp.dispose()
  }
})

test('in-memory and SQLite ledgers use the same Task event reducer', async () => {
  const temp = await temporaryDirectory('military-task-reducer-')
  const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
  try {
    const memory = new InMemoryMilitaryLedger()
    const sqlite = new SqliteMilitaryLedger(database, 'tenant-1')
    const mission = missionId('task-reducer-mission')
    const general = identity('general')
    const worker = identity('worker')
    const taskId = 'task-reducer-task'
    const events: MissionEvent[] = [
      missionEvent({
        type: 'task/created',
        missionId: mission,
        actor: general,
        payload: { taskId, taskVersion: 1, taskOrderRef: 'task-order:1' },
        metadata: { idempotencyKey: 'reducer:create' },
      }),
      missionEvent({
        type: 'task/leased',
        missionId: mission,
        actor: worker,
        payload: {
          taskId,
          taskVersion: 1,
          agent: worker,
          workspaceLeaseId: 'lease-1',
          leaseExpiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
        },
        metadata: { idempotencyKey: 'reducer:lease' },
      }),
      missionEvent({
        type: 'task/candidate-submitted',
        missionId: mission,
        actor: worker,
        payload: {
          taskId,
          taskVersion: 1,
          candidateId: 'candidate-1',
          candidateRef: 'candidate:candidate-1',
        },
        metadata: { idempotencyKey: 'reducer:candidate' },
      }),
      missionEvent({
        type: 'verification/completed',
        missionId: mission,
        actor: general,
        payload: {
          taskId,
          taskVersion: 1,
          candidateId: 'candidate-1',
          verificationReceiptRef: 'verification:1',
          disposition: 'REWORK',
        },
        metadata: { idempotencyKey: 'reducer:verification' },
      }),
    ]
    for (const event of events) {
      await append(memory, event)
      await append(sqlite, event)
    }
    const key = brand<string, 'TaskId'>(taskId)
    assert.equal((await memory.readMission(mission)).tasks.get(key)?.state, 'REWORK')
    assert.deepEqual(
      [...(await memory.readMission(mission)).tasks.entries()],
      [...(await sqlite.readMission(mission)).tasks.entries()],
    )
    const rework = missionEvent({
      type: 'task/rework-requested',
      missionId: mission,
      actor: general,
      payload: {
        taskId,
        previousVersion: 1,
        newVersion: 2,
        reasonCodes: ['VERIFICATION_REWORK'],
      },
      metadata: { idempotencyKey: 'reducer:requeue' },
    })
    await append(memory, rework)
    await append(sqlite, rework)
    assert.equal((await memory.readMission(mission)).tasks.get(key)?.state, 'READY')
    assert.equal(Number((await sqlite.readMission(mission)).tasks.get(key)?.taskVersion), 2)
    assert.deepEqual(
      [...(await memory.readMission(mission)).tasks.entries()],
      [...(await sqlite.readMission(mission)).tasks.entries()],
    )
  } finally {
    database.close()
    await temp.dispose()
  }
})

async function append(ledger: MilitaryLedger, event: MissionEvent): Promise<void> {
  const snapshot = await ledger.readMission(brand<string, 'MissionId'>(event.missionId))
  await ledger.append(event, snapshot.revision)
}
