import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  brand,
  type MilitaryAuthorityContext,
} from '@dsh-military/contracts'
import {
  modelBudgetReservationId,
  reconcileModelRequestBudgets,
  reserveModelRequestBudget,
  settleModelRequestBudget,
} from '@dsh-military/plugin-host/model-budget'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import {
  SqliteMilitaryDatabase,
  SqliteMilitaryResourceBudgets,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { budgetPolicy, identity, stamp } from './helpers.js'

test('model execution is authority-gated, reserved and settled from observed usage', async () => {
  const temp = await temporaryDirectory('military-model-budget-')
  const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
  try {
    const policy = { ...budgetPolicy(), policyId: 'budget-default' }
    const budgets = new SqliteMilitaryResourceBudgets(database, 'tenant-1')
    budgets.registerPolicy(policy)
    const general = identity('general')
    const authorityContext: MilitaryAuthorityContext = {
      schemaVersion: '1.0.0',
      authorityContextId: 'model-authority',
      principalId: String(general.agentId),
      tenantId: 'tenant-1',
      roles: ['general'],
      scopes: ['model.execute*'],
      sessionOwnership: [String(general.sessionId)],
      workspaceMemberships: ['/workspace'],
      dataClassificationCeiling: 'restricted',
      authorizationReceiptRefs: [],
      issuedAt: stamp(),
      expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
    }
    const host = {
      tenantId: 'tenant-1',
      application: {
        authorization: {
          async resolve() { return authorityContext },
          async authorize() { return { allowed: true } },
        },
        policies: {
          async resourceBudgetPolicy() { return policy },
        },
        runtime: {
          async missionForSession() { return null },
        },
        resourceBudgets: budgets,
      },
    } as unknown as MilitaryHostRuntime
    const config: LlmCallConfig = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      maxTokens: 256,
    }

    const first = await reserveModelRequestBudget(host, general, null, 1, 0, config)
    const duplicate = await reserveModelRequestBudget(host, general, null, 1, 0, config)
    assert.equal(duplicate.reservationId, first.reservationId)
    await settleModelRequestBudget(host, general, {
      turn: 1,
      step: 0,
      attempts: 2,
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 40 },
    })
    const reservation = await budgets.getReservation(modelBudgetReservationId(general, 1, 0))
    assert.equal(reservation.state, 'SETTLED')
    const usage = await budgets.usageForScope('TENANT', 'tenant-1')
    assert.equal(usage.length, 1)
    assert.equal(usage[0]?.actual.modelRequests, 2)
    assert.equal(usage[0]?.actual.reasoningTokens, 40)

    await reserveModelRequestBudget(host, general, null, 2, 0, config)
    const recoveredEvents = [
      {
        type: 'step/start',
        seq: 1,
        time: Date.now() - 5,
        data: { turn: 2, step: 0 },
      },
      {
        type: 'assistant/message',
        seq: 2,
        time: Date.now(),
        data: {
          turn: 2,
          step: 0,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'recovered' }],
            source: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
          },
          usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 },
        },
      },
    ] as unknown as SessionEvent[]
    await reconcileModelRequestBudgets(host, general, recoveredEvents)
    assert.equal(
      (await budgets.getReservation(modelBudgetReservationId(general, 2, 0))).state,
      'SETTLED',
    )
    const recoveredUsage = await budgets.usageForScope('TENANT', 'tenant-1')
    assert.equal(recoveredUsage[1]?.actual.modelRequests, 4)
    assert.equal(recoveredUsage[1]?.actual.reasoningTokens, 3)
  } finally {
    database.close()
    await temp.dispose()
  }
})
