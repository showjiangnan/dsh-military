import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MilitaryError, brand } from '@dsh-military/contracts'
import { InMemoryDecisionBroker, InMemoryMilitaryRadio, InMemoryMilitaryResourceBudgets } from '@dsh-military/core'
import { budgetPolicy, decisionSet, identity, reservation, tacticalGuidance, tacticalRequest, usageReceipt } from './helpers.js'

test('Decision Broker serializes presentation and answers with dedupe', async () => {
  const broker = new InMemoryDecisionBroker()
  const set = decisionSet('root')
  await broker.submit(set)
  await assert.rejects(async () => broker.submit({ ...set, decisionSetId: brand<string, 'DecisionSetId'>('decision-2') }), (error: unknown) =>
    error instanceof MilitaryError && error.failure.code === 'DECISION_SET_DUPLICATE')
  const presented = await broker.presentNext(set.targetRootSessionId)
  assert.equal(presented?.state, 'PRESENTED')
  await broker.recordAnswers({ rootSessionId: set.targetRootSessionId, decisionSetId: String(set.decisionSetId), answerReceiptRef: 'artifact:answers' })
  assert.equal((await broker.record(String(set.decisionSetId))).state, 'ANSWERED')
  assert.equal((await broker.pending(set.targetRootSessionId)).length, 0)
})

test('Staff radio enforces evidence, task version and worker acknowledgement', async () => {
  const radio = new InMemoryMilitaryRadio({ leaseMs: 1000, maxAttempts: 2 })
  const request = tacticalRequest()
  const result = await radio.request(request)
  assert.equal(result.state, 'QUEUED')
  const leased = await radio.lease(identity('advisor'), new AbortController().signal)
  assert.equal(String(leased?.requestId), String(request.requestId))
  const guidance = tacticalGuidance(request)
  await radio.issue(guidance)
  const delivered = radio.deliver(request.requestId, Number(request.location.taskVersion))
  assert.equal(String(delivered.guidanceId), String(guidance.guidanceId))
  await radio.acknowledge(String(guidance.guidanceId), request.identity)
  assert.equal(radio.snapshot()[0]?.state, 'ACKNOWLEDGED')
})

test('resource reservations are admission controlled and idempotently settled', async () => {
  const budgets = new InMemoryMilitaryResourceBudgets()
  budgets.registerPolicy(budgetPolicy())
  const request = reservation()
  const accepted = await budgets.reserve(request)
  assert.equal(accepted.state, 'RESERVED')
  assert.equal((await budgets.reserve(request)).reservationId, request.reservationId)
  const usage = usageReceipt(accepted)
  await budgets.settle(usage)
  await budgets.settle(usage)
  assert.equal((await budgets.getReservation(request.reservationId)).state, 'SETTLED')
  assert.equal((await budgets.usageForScope('TASK', 'task-1')).length, 1)
})
