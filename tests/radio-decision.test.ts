import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand, isoNow, MilitaryError, type DecisionQuestionSet } from '@dsh-military/contracts'
import { InMemoryDecisionBroker, InMemoryMilitaryRadio } from '@dsh-military/core'
import { advisor, general, makeGuidance, makeTacticalRequest, worker } from './fixtures.js'

test('radio broker deduplicates, leases, delivers and acknowledges guidance', async () => {
  const radio = new InMemoryMilitaryRadio({ leaseMs: 10_000, maxAttempts: 3 })
  const request = makeTacticalRequest()
  const first = await radio.request(request)
  const duplicate = await radio.request(request)
  assert.deepEqual(duplicate, first)
  const leased = await radio.lease(advisor, new AbortController().signal)
  assert.equal(leased?.requestId, request.requestId)
  const guidance = makeGuidance(request)
  await radio.issue(guidance)
  const delivered = radio.deliver(request.requestId, 1)
  assert.equal(delivered.guidanceId, guidance.guidanceId)
  await radio.acknowledge(String(guidance.guidanceId), worker)
  assert.equal(radio.snapshot()[0]?.state, 'ACKNOWLEDGED')
})

test('decision broker is root-General-owned and first valid answer wins', async () => {
  const broker = new InMemoryDecisionBroker()
  const questionSet: DecisionQuestionSet = {
    schemaVersion: '1.0.0',
    decisionSetId: brand<string, 'DecisionSetId'>('decision-test'),
    producer: worker,
    targetRootSessionId: general.sessionId,
    contextVersion: 1,
    purpose: 'architecture selection',
    deliveryAuthority: 'general',
    questions: [{ id: 'q1', question: 'Choose?', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
    dedupeKey: 'architecture-selection',
    createdAt: isoNow(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() as import('@dsh-military/contracts').IsoDateTime,
  }
  await broker.submit(questionSet)
  await assert.rejects(() => broker.submit({ ...questionSet, decisionSetId: brand<string, 'DecisionSetId'>('decision-duplicate') }),
    error => error instanceof MilitaryError && error.failure.code === 'DECISION_SET_DUPLICATE')
  const presented = await broker.presentNext(general.sessionId)
  assert.equal(presented?.state, 'PRESENTED')
  await broker.recordAnswers({ rootSessionId: general.sessionId, decisionSetId: String(questionSet.decisionSetId), answerReceiptRef: 'answer:test' })
  assert.equal((await broker.record(String(questionSet.decisionSetId))).state, 'ANSWERED')
  await assert.rejects(() => broker.recordAnswers({ rootSessionId: general.sessionId, decisionSetId: String(questionSet.decisionSetId), answerReceiptRef: 'answer:second' }),
    error => error instanceof MilitaryError && error.failure.code === 'DECISION_SET_STALE')
})
