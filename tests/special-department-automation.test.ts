import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missionEvent } from '@dsh-military/contracts'
import { SpecialDepartmentAutomation } from '@dsh-military/runtime'
import {
  SqliteMilitaryDatabase,
  SqliteMilitaryLedger,
  SqliteSpecialDepartmentAutomationStore,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, missionId } from './helpers.js'

test('special department automation dispatches each source event once across restart', async () => {
  const temp = await temporaryDirectory('military-special-automation-')
  const path = `${temp.path}/military.sqlite`
  const mission = missionId('special-automation-mission')
  let database = new SqliteMilitaryDatabase({ path })
  try {
    let ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    await ledger.append(missionEvent({
      type: 'wave/barrier-satisfied',
      missionId: mission,
      actor: identity('general'),
      payload: {
        waveId: 'wave-1',
        acceptedTaskIds: ['task-1'],
        integrationReceiptRefs: ['integration-1'],
        specsCommitRef: 'specs-1',
      },
      metadata: { idempotencyKey: 'wave-barrier:wave-1' },
    }))

    let dispatches = 0
    const dispatcher = {
      async dispatch(job: { readonly jobId: string }) {
        dispatches += 1
        return {
          childSessionId: `child:${job.jobId}`,
          bindingId: `binding:${job.jobId}`,
        }
      },
    }
    let trajectoryEnabled = false
    let automation = new SpecialDepartmentAutomation({
      ledger,
      store: new SqliteSpecialDepartmentAutomationStore(database, 'tenant-1'),
      dispatcher,
      enabled: kind => kind !== 'TRAJECTORY_AFTER_WAVE' || trajectoryEnabled,
    })
    const signal = new AbortController().signal
    const disabled = await automation.reconcile({ missionId: mission, parent: 'general', signal })
    assert.deepEqual(disabled, [])
    assert.equal(dispatches, 0)

    trajectoryEnabled = true
    const first = await automation.reconcile({ missionId: mission, parent: 'general', signal })
    assert.equal(first.filter(receipt => receipt.disposition === 'DISPATCHED').length, 1)
    assert.equal(dispatches, 1)

    database.close()
    database = new SqliteMilitaryDatabase({ path })
    ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    const store = new SqliteSpecialDepartmentAutomationStore(database, 'tenant-1')
    automation = new SpecialDepartmentAutomation({ ledger, store, dispatcher })
    const resumed = await automation.reconcile({ missionId: mission, parent: 'general', signal })
    assert.equal(resumed.filter(receipt => receipt.disposition === 'ALREADY_DISPATCHED').length, 1)
    assert.equal(dispatches, 1)
    const jobs = await store.list(mission)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]?.kind, 'TRAJECTORY_AFTER_WAVE')
    assert.equal(jobs[0]?.state, 'DISPATCHED')
  } finally {
    database.close()
    await temp.dispose()
  }
})

test('expired special-department claims recover the same dispatch attempt after crash', async () => {
  const temp = await temporaryDirectory('military-special-claim-recovery-')
  const path = `${temp.path}/military.sqlite`
  const mission = missionId('special-claim-recovery-mission')
  let clockMs = Date.parse('2026-08-24T00:00:00.000Z')
  const clock = () => new Date(clockMs)
  let database = new SqliteMilitaryDatabase({ path })
  try {
    let ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    await ledger.append(missionEvent({
      type: 'wave/barrier-satisfied',
      missionId: mission,
      actor: identity('general'),
      payload: {
        waveId: 'wave-recovery',
        acceptedTaskIds: ['task-recovery'],
        integrationReceiptRefs: ['integration-recovery'],
        specsCommitRef: 'specs-recovery',
      },
      metadata: { idempotencyKey: 'wave-barrier:wave-recovery' },
    }))
    let store = new SqliteSpecialDepartmentAutomationStore(
      database,
      'tenant-1',
      { clock, claimLeaseMs: 30_000 },
    )
    const failed = new SpecialDepartmentAutomation({
      ledger,
      store,
      workerId: 'first-process',
      dispatcher: {
        async dispatch() { throw new Error('injected dispatch failure') },
      },
    })
    await failed.reconcile({
      missionId: mission,
      parent: 'general',
      signal: new AbortController().signal,
    })
    const [failedJob] = await store.list(mission)
    assert.equal(failedJob?.state, 'FAILED')
    assert.equal(failedJob?.attempts, 1)
    const abandoned = await store.claim(failedJob!.jobId, 'crashed-process')
    assert.equal(abandoned?.state, 'RUNNING')
    assert.equal(abandoned?.attempts, 2)

    database.close()
    clockMs += 31_000
    database = new SqliteMilitaryDatabase({ path })
    ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    store = new SqliteSpecialDepartmentAutomationStore(
      database,
      'tenant-1',
      { clock, claimLeaseMs: 30_000 },
    )
    let recoveredAttempts = 0
    const recovered = new SpecialDepartmentAutomation({
      ledger,
      store,
      workerId: 'restarted-process',
      dispatcher: {
        async dispatch(job) {
          recoveredAttempts = job.attempts
          return {
            childSessionId: `child:${job.jobId}:${job.attempts}`,
            bindingId: `binding:${job.jobId}:${job.attempts}`,
          }
        },
      },
    })
    const receipts = await recovered.reconcile({
      missionId: mission,
      parent: 'general',
      signal: new AbortController().signal,
    })
    assert.equal(receipts[0]?.disposition, 'DISPATCHED')
    assert.equal(recoveredAttempts, 2)
    const [completed] = await store.list(mission)
    assert.equal(completed?.state, 'DISPATCHED')
    assert.equal(completed?.attempts, 2)
    assert.equal(completed?.claimOwner, undefined)
    assert.equal(completed?.claimExpiresAt, undefined)
  } finally {
    database.close()
    await temp.dispose()
  }
})
