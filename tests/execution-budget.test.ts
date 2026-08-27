import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countedExecutionReservationId,
  withCountedExecutionBudget,
} from '@dsh-military/tools'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import {
  SqliteMilitaryDatabase,
  SqliteMilitaryResourceBudgets,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { budgetPolicy, identity, missionId } from './helpers.js'

test('radio and rework workflow counters reserve before mutation and settle exact usage', async () => {
  const temp = await temporaryDirectory('military-execution-budget-')
  const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
  try {
    const base = budgetPolicy()
    const policy = {
      ...base,
      policyId: 'budget-default',
      limits: {
        ...base.limits,
        radioRounds: 1,
        reworkAttempts: 1,
      },
    }
    const budgets = new SqliteMilitaryResourceBudgets(database, 'tenant-1')
    budgets.registerPolicy(policy)
    const host = {
      tenantId: 'tenant-1',
      application: {
        policies: {
          async resourceBudgetPolicy() { return policy },
        },
        resourceBudgets: budgets,
      },
    } as unknown as MilitaryHostRuntime
    const general = identity('general')
    const mission = missionId('counted-execution-mission')
    let mutations = 0

    const radio = await withCountedExecutionBudget(host, {
      identity: general,
      missionId: mission,
      counter: 'radioRounds',
      idempotencyKey: 'radio-one',
      operation: async () => {
        mutations += 1
        return { queued: true }
      },
      actual: () => 1,
    })
    assert.equal(radio.queued, true)
    assert.equal(mutations, 1)
    await assert.rejects(
      withCountedExecutionBudget(host, {
        identity: general,
        missionId: mission,
        counter: 'radioRounds',
        idempotencyKey: 'radio-two',
        operation: async () => {
          mutations += 1
          return { queued: true }
        },
        actual: () => 1,
      }),
      /budget radioRounds exhausted/u,
    )
    assert.equal(mutations, 1)

    await withCountedExecutionBudget(host, {
      identity: general,
      missionId: mission,
      counter: 'reworkAttempts',
      idempotencyKey: 'accepted-candidate',
      operation: async () => ({ disposition: 'ACCEPTED' as const }),
      actual: () => 0,
    })
    await withCountedExecutionBudget(host, {
      identity: general,
      missionId: mission,
      counter: 'reworkAttempts',
      idempotencyKey: 'reworked-candidate',
      operation: async () => ({ disposition: 'REWORK' as const }),
      actual: () => 1,
    })
    const usage = await budgets.usageForScope('MISSION', String(mission))
    assert.equal(usage.reduce((sum, item) => sum + item.actual.radioRounds, 0), 1)
    assert.equal(usage.reduce((sum, item) => sum + item.actual.reworkAttempts, 0), 1)
    assert.equal(
      (await budgets.getReservation(countedExecutionReservationId({
        identity: general,
        missionId: mission,
        counter: 'reworkAttempts',
        idempotencyKey: 'accepted-candidate',
      }))).state,
      'SETTLED',
    )
  } finally {
    database.close()
    await temp.dispose()
  }
})
