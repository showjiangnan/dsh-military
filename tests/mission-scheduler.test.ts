import assert from 'node:assert/strict'
import test from 'node:test'
import { brand } from '@dsh-military/contracts'
import {
  InMemoryMilitaryBrainstorm,
  InMemoryMilitaryLedger,
  MilitaryOrchestrator,
  OversightController,
} from '@dsh-military/core'
import {
  general,
  worker,
} from './fixtures.js'
import { task } from './helpers.js'

test('Mission scheduler enforces dependency and Wave barriers before dispatch', async () => {
  const ledger = new InMemoryMilitaryLedger()
  const runtime = new MilitaryOrchestrator({
    ledger,
    verification: {} as never,
    oversight: new OversightController(),
    brainstorm: new InMemoryMilitaryBrainstorm(),
  })
  const first = task(undefined, 'task-wave-1', ['src/one'])
  const second = {
    ...task(first.missionId, 'task-wave-2', ['src/two']),
    waveId: brand<string, 'WaveId'>('wave-2'),
    dependencies: [{
      type: 'requires' as const,
      targetTaskId: first.taskId,
    }],
  }
  await runtime.registerMission({
    missionId: first.missionId,
    rootSessionId: general.sessionId,
    general,
    title: 'Wave scheduler fixture',
    authorityContextRef: 'authority:scheduler',
  })
  await runtime.registerTask(first, general)
  await runtime.registerTask(second, general)
  assert.equal(runtime.taskState(first.taskId), 'READY')
  assert.equal(
    runtime.taskState(second.taskId),
    'CREATED',
    'a later Wave Task must not be dispatchable before its dependency barrier',
  )

  await runtime.leaseTask(first.taskId, worker, 'lease-wave-1')
  await runtime.recordSpecsCommit(first.taskId, {
    commit: '1'.repeat(40),
    treeHash: 'a'.repeat(40),
    changedPaths: ['src/one/result.ts'],
  })
  assert.equal(runtime.taskState(first.taskId), 'ACCEPTED')
  assert.equal(runtime.taskState(second.taskId), 'READY')
  let events = await ledger.readEvents(first.missionId)
  assert.ok(events.some(value =>
    value.type === 'wave/barrier-satisfied'
    && value.payload.waveId === String(first.waveId)))
  assert.ok(events.some(value =>
    value.type === 'wave/opened'
    && value.payload.waveId === String(second.waveId)))
  const secondReady = events.find(value =>
    value.type === 'task/ready'
    && value.payload.taskId === String(second.taskId))
  assert.deepEqual(
    secondReady?.type === 'task/ready'
      ? secondReady.payload.satisfiedDependencyIds
      : undefined,
    [String(first.taskId)],
  )

  await runtime.leaseTask(second.taskId, worker, 'lease-wave-2')
  await runtime.recordSpecsCommit(second.taskId, {
    commit: '2'.repeat(40),
    treeHash: 'b'.repeat(40),
    changedPaths: ['src/two/result.ts'],
  })
  await runtime.completeMission(first.missionId, general)
  events = await ledger.readEvents(first.missionId)
  assert.equal(
    events.filter(value => value.type === 'wave/barrier-satisfied').length,
    2,
  )
  assert.equal(
    events.filter(value => value.type === 'mission/completed').length,
    1,
  )
  await assert.rejects(
    runtime.registerTask(
      task(first.missionId, 'task-after-completion'),
      general,
    ),
    /already COMPLETED/u,
  )
})

test('explicit Mission cancellation is receipt-bound, terminal and cancels every open Task', async () => {
  const ledger = new InMemoryMilitaryLedger()
  const expiredRadio: Array<{ requestId: string; reason: string }> = []
  const expiredDecisions: Array<{ decisionSetId: string; reason: string }> = []
  const runtime = new MilitaryOrchestrator({
    ledger,
    verification: {} as never,
    oversight: new OversightController(),
    brainstorm: new InMemoryMilitaryBrainstorm(),
    radio: {
      async expire(requestId, reason) {
        expiredRadio.push({ requestId: String(requestId), reason })
      },
    },
    decisions: {
      async expire(decisionSetId, reason) {
        expiredDecisions.push({ decisionSetId, reason })
      },
    },
  })
  const order = task(undefined, 'task-mission-cancel', ['src/radio'])
  const decisionOrder = task(
    order.missionId,
    'task-mission-cancel-decision',
    ['src/decision'],
  )
  await runtime.registerMission({
    missionId: order.missionId,
    rootSessionId: general.sessionId,
    general,
    title: 'Mission cancellation fixture',
    authorityContextRef: 'authority:mission-cancel',
  })
  await runtime.registerTask(order, general)
  await runtime.registerTask(decisionOrder, general)
  await runtime.leaseTask(order.taskId, worker, 'lease-cancel-radio')
  await runtime.submitBlocker({
    taskId: order.taskId,
    taskVersion: order.taskVersion,
    actor: worker,
    blockerId: 'blocker-cancel-radio',
    evidenceRefs: ['evidence-cancel-radio'],
    requestId: 'radio-cancel-1',
  })
  await runtime.leaseTask(
    decisionOrder.taskId,
    worker,
    'lease-cancel-decision',
  )
  await runtime.waitForDecision({
    taskId: decisionOrder.taskId,
    taskVersion: decisionOrder.taskVersion,
    decisionSetId: 'decision-cancel-1',
    actor: worker,
  })
  await runtime.cancelMission({
    missionId: order.missionId,
    actor: general,
    reason: 'Explicit operator scope withdrawal',
    cancellationReceiptRef: 'authorization-cancel-1',
  })
  assert.equal(runtime.taskState(order.taskId), 'CANCELLED')
  assert.equal(runtime.taskState(decisionOrder.taskId), 'CANCELLED')
  assert.deepEqual(expiredRadio, [{
    requestId: 'radio-cancel-1',
    reason: 'MISSION_CANCELLED',
  }])
  assert.deepEqual(expiredDecisions, [{
    decisionSetId: 'decision-cancel-1',
    reason: 'MISSION_CANCELLED',
  }])
  await runtime.cancelMission({
    missionId: order.missionId,
    actor: general,
    reason: 'Explicit operator scope withdrawal',
    cancellationReceiptRef: 'authorization-cancel-1',
  })
  const events = await ledger.readEvents(order.missionId)
  assert.equal(
    events.filter(value => value.type === 'mission/cancelled').length,
    1,
  )
  assert.equal(
    events.filter(value => value.type === 'task/cancelled').length,
    2,
  )
  await assert.rejects(
    runtime.completeMission(order.missionId, general),
    /cancelled Mission cannot be completed/u,
  )
  await assert.rejects(
    runtime.recordEvent({
      missionId: order.missionId,
      actor: general,
      type: 'mission/completed',
      payload: {
        completionReportRef: 'must-not-append',
        acceptedTaskCount: 0,
        integratedTaskCount: 0,
      },
      idempotencyKey: 'must-not-append-after-terminal',
    }),
    /is terminal after mission\/cancelled/u,
  )
})
