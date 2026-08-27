import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  isoNow,
  MilitaryError,
  type DecisionQuestionSet,
  type IsoDateTime,
} from '@dsh-military/contracts'
import {
  InMemoryDecisionBroker,
  InMemoryMilitaryBrainstorm,
  InMemoryMilitaryLedger,
  InMemoryMilitaryRadio,
  MilitaryOrchestrator,
  OversightController,
} from '@dsh-military/core'
import { advisor, general, makeGuidance, makeTacticalRequest, worker } from './fixtures.js'
import { task } from './helpers.js'

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

test('Decision TTL reconciliation expires the exact Task wait and never fabricates an answer', async () => {
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const clock = () => new Date(timestamp)
  const broker = new InMemoryDecisionBroker(clock)
  const questionSet: DecisionQuestionSet = {
    schemaVersion: '1.0.0',
    decisionSetId: brand<string, 'DecisionSetId'>('decision-expiring'),
    producer: worker,
    targetRootSessionId: general.sessionId,
    contextVersion: 1,
    purpose: 'architecture migration',
    deliveryAuthority: 'general',
    questions: [{
      id: 'q1',
      question: 'Choose?',
      options: [{ label: 'A', description: 'Option A' }],
      multiSelect: false,
    }],
    dedupeKey: 'decision-expiring',
    createdAt: iso('2026-08-27T00:00:00.000Z'),
    expiresAt: iso('2026-08-27T00:00:01.000Z'),
  }
  const order = task()
  await broker.submit(questionSet, {
    missionId: order.missionId,
    taskId: order.taskId,
    taskVersion: order.taskVersion,
    attemptId: 'attempt-decision-1',
  })
  assert.equal(
    (await broker.record('decision-expiring')).attemptId,
    'attempt-decision-1',
  )
  await assert.rejects(
    broker.submit(questionSet, {
      missionId: order.missionId,
      taskId: order.taskId,
      taskVersion: order.taskVersion,
      attemptId: 'attempt-decision-2',
    }),
    militaryFailure('IDEMPOTENCY_CONFLICT'),
  )
  timestamp = Date.parse('2026-08-27T00:00:02.000Z')
  const expired = await broker.reconcileExpired()
  assert.deepEqual(expired.map(value => value.decisionSetId), [
    'decision-expiring',
  ])
  assert.equal(expired[0]?.taskId, String(order.taskId))
  assert.equal(expired[0]?.attemptId, 'attempt-decision-1')
  assert.equal((await broker.record('decision-expiring')).state, 'EXPIRED')
  assert.deepEqual(await broker.reconcileExpired(), [])
})

test('Decision answer delivery is durable until the exact Worker acknowledges it', async () => {
  const ledger = new InMemoryMilitaryLedger()
  const runtime = new MilitaryOrchestrator({
    ledger,
    verification: {} as never,
    oversight: new OversightController(),
    brainstorm: new InMemoryMilitaryBrainstorm(),
  })
  const order = task()
  await runtime.registerMission({
    missionId: order.missionId,
    rootSessionId: general.sessionId,
    general,
    title: 'Decision delivery fixture',
    authorityContextRef: 'authority:fixture',
  })
  await runtime.registerTask(order, general)
  await runtime.leaseTask(order.taskId, worker, 'workspace-decision')
  await runtime.waitForDecision({
    taskId: order.taskId,
    taskVersion: order.taskVersion,
    decisionSetId: 'decision-runtime-1',
    actor: worker,
  })
  assert.equal(runtime.taskState(order.taskId), 'WAITING_DECISION')
  assert.equal(await runtime.resolveDecision({
    decisionSetId: 'decision-runtime-1',
    answerReceiptRef: 'artifact-ref-answer-1',
    actor: general,
  }), order.taskId)
  assert.deepEqual(await runtime.pendingDecisionAnswer(order.taskId), {
    decisionSetId: 'decision-runtime-1',
    answerReceiptRef: 'artifact-ref-answer-1',
    resolvedAt: (await runtime.pendingDecisionAnswer(order.taskId))?.resolvedAt,
  })
  await assert.rejects(
    runtime.acknowledgeDecisionAnswer(
      order.taskId,
      'decision-runtime-1',
      advisor,
    ),
    militaryFailure('UNAUTHORIZED'),
  )
  await runtime.acknowledgeDecisionAnswer(
    order.taskId,
    'decision-runtime-1',
    worker,
  )
  assert.equal(await runtime.pendingDecisionAnswer(order.taskId), null)
  const events = await ledger.readEvents(order.missionId)
  assert.ok(events.some(value =>
    value.type === 'decision/answer-acknowledged'))

  await runtime.leaseTask(order.taskId, worker, 'workspace-decision-2')
  await runtime.waitForDecision({
    taskId: order.taskId,
    taskVersion: order.taskVersion,
    decisionSetId: 'decision-runtime-2',
    actor: worker,
  })
  assert.equal(await runtime.expireDecisionWait({
    decisionSetId: 'decision-runtime-2',
    reason: 'TTL',
    actor: general,
  }), order.taskId)
  assert.equal(runtime.taskState(order.taskId), 'BLOCKED')
  assert.equal(await runtime.pendingDecisionAnswer(order.taskId), null)
})

test('Radio reconciliation dead-letters expired requests and exhausted leases once', async () => {
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const radio = new InMemoryMilitaryRadio({
    clock: () => new Date(timestamp),
    leaseMs: 1_000,
    maxAttempts: 1,
  })
  const expiring = {
    ...makeTacticalRequest(),
    requestId: brand<string, 'TacticalRequestId'>('radio-expiring'),
    idempotencyKey: 'radio-expiring',
    createdAt: iso('2026-08-27T00:00:00.000Z'),
    expiresAt: iso('2026-08-27T00:00:01.000Z'),
  }
  await radio.request(expiring)
  timestamp = Date.parse('2026-08-27T00:00:02.000Z')
  assert.deepEqual(
    (await radio.reconcileDeadLetters()).map(value => String(value.requestId)),
    ['radio-expiring'],
  )
  assert.deepEqual(await radio.reconcileDeadLetters(), [])

  const exhausted = {
    ...makeTacticalRequest(),
    requestId: brand<string, 'TacticalRequestId'>('radio-exhausted'),
    idempotencyKey: 'radio-exhausted',
    createdAt: iso('2026-08-27T00:00:02.000Z'),
    expiresAt: iso('2026-08-27T01:00:00.000Z'),
  }
  await radio.request(exhausted)
  assert.equal(
    String((await radio.lease(advisor, new AbortController().signal))?.requestId),
    'radio-exhausted',
  )
  timestamp = Date.parse('2026-08-27T00:00:04.000Z')
  assert.deepEqual(
    (await radio.reconcileDeadLetters()).map(value => String(value.requestId)),
    ['radio-exhausted'],
  )
})

function iso(value: string): IsoDateTime {
  return value as IsoDateTime
}

function militaryFailure(code: string): (error: unknown) => boolean {
  return error =>
    error instanceof MilitaryError
    && error.failure.code === code
}
