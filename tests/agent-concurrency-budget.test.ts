import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand } from '@dsh-military/contracts'
import {
  agentConcurrencyReservationId,
  reserveAgentConcurrencyBudget,
} from '@dsh-military/runtime'
import {
  SqliteMilitaryDatabase,
  SqliteMilitaryResourceBudgets,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { budgetPolicy, identity, missionId } from './helpers.js'

test('department child concurrency is held durably for its complete live lifecycle', async () => {
  const temp = await temporaryDirectory('military-agent-budget-')
  const path = `${temp.path}/military.sqlite`
  let database = new SqliteMilitaryDatabase({ path })
  try {
    const policy = {
      ...budgetPolicy(),
      policyId: 'agent-budget-policy',
      limits: {
        ...budgetPolicy().limits,
        concurrentAgents: 1,
      },
    }
    let budgets = new SqliteMilitaryResourceBudgets(database, 'tenant-1')
    budgets.registerPolicy(policy)
    const firstAgent = identity('worker', 'concurrency-first')
    const secondAgent = identity('advisor', 'concurrency-second')
    const mission = missionId('concurrency-mission')
    const startedAt = new Date()
    const clock = () => startedAt
    const first = await reserveAgentConcurrencyBudget({
      budgets,
      policy,
      identity: firstAgent,
      tenantId: 'tenant-1',
      missionId: mission,
      taskId: brand<string, 'TaskId'>('concurrency-scope'),
      maximumWallClockSeconds: 75,
      clock,
    })
    const duplicate = await reserveAgentConcurrencyBudget({
      budgets,
      policy,
      identity: firstAgent,
      tenantId: 'tenant-1',
      missionId: mission,
      taskId: brand<string, 'TaskId'>('concurrency-scope'),
      maximumWallClockSeconds: 75,
      clock,
    })
    assert.equal(duplicate.reservationId, first.reservationId)
    assert.equal(
      first.reservationId,
      agentConcurrencyReservationId(firstAgent),
    )
    assert.equal(
      Date.parse(first.expiresAt) - Date.parse(first.reservedAt),
      75_000,
    )

    database.close()
    database = new SqliteMilitaryDatabase({ path })
    budgets = new SqliteMilitaryResourceBudgets(database, 'tenant-1')
    await assert.rejects(
      reserveAgentConcurrencyBudget({
        budgets,
        policy,
        identity: secondAgent,
        tenantId: 'tenant-1',
        missionId: mission,
        taskId: brand<string, 'TaskId'>('concurrency-scope'),
      }),
      /budget concurrentAgents exhausted/u,
    )

    await budgets.revoke(first.reservationId, 'AGENT_RELEASED')
    const second = await reserveAgentConcurrencyBudget({
      budgets,
      policy,
      identity: secondAgent,
      tenantId: 'tenant-1',
      missionId: mission,
      taskId: brand<string, 'TaskId'>('concurrency-scope'),
    })
    assert.equal(second.state, 'RESERVED')
  } finally {
    database.close()
    await temp.dispose()
  }
})
