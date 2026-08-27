import assert from 'node:assert/strict'
import test from 'node:test'
import { brand, MilitaryError } from '@dsh-military/contracts'
import { ExecutionLifecycleCoordinator } from '@dsh-military/core'
import {
  SqliteExecutionLifecycleStateStore,
  SqliteMilitaryDatabase,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, missionId, sessionId } from './helpers.js'

test('workflow obligations correlate multiple open requests without scanning arbitrary Tasks', async () => {
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const lifecycle = new ExecutionLifecycleCoordinator({
    clock: () => new Date(timestamp),
  })
  const rootSessionId = sessionId('root-multi-request')
  const first = await lifecycle.openWorkflowObligation({
    tenantId: 'tenant-lifecycle',
    rootSessionId,
    requestKey: 'message-1',
    requestHash: 'hash-1',
    requestSummary: 'implement service A',
    reason: 'USER_EXECUTION',
  })
  timestamp += 1_000
  const second = await lifecycle.openWorkflowObligation({
    tenantId: 'tenant-lifecycle',
    rootSessionId,
    requestKey: 'message-2',
    requestHash: 'hash-2',
    requestSummary: 'implement service B',
    reason: 'USER_EXECUTION',
  })
  const taskA = brand<string, 'TaskId'>('task-request-a')
  const taskB = brand<string, 'TaskId'>('task-request-b')
  const advancedA = await lifecycle.advanceWorkflowObligation({
    obligationId: first.obligationId,
    expectedRevision: first.revision,
    state: 'DISPATCHING',
    stage: 'SPAWN_DEPARTMENT',
    missionId: missionId('mission-multi-request'),
    taskIds: [taskA],
    transitionReason: 'request A compiled',
  })
  const advancedB = await lifecycle.advanceWorkflowObligation({
    obligationId: second.obligationId,
    expectedRevision: second.revision,
    state: 'DISPATCHING',
    stage: 'SPAWN_DEPARTMENT',
    missionId: missionId('mission-multi-request'),
    taskIds: [taskB],
    transitionReason: 'request B compiled',
  })
  assert.deepEqual(advancedA.taskIds, [taskA])
  assert.deepEqual(advancedB.taskIds, [taskB])
  assert.equal(
    (await lifecycle.activeWorkflowObligation(rootSessionId))?.obligationId,
    second.obligationId,
  )
  await lifecycle.settleWorkflowObligation({
    obligationId: second.obligationId,
    expectedRevision: advancedB.revision,
    outcome: 'COMPLETED',
    reason: 'request B settled',
  })
  assert.equal(
    (await lifecycle.activeWorkflowObligation(rootSessionId))?.obligationId,
    first.obligationId,
  )
})

test('three Rework continuations create distinct Attempt/Activation/Dispatch aggregates', async () => {
  const lifecycle = new ExecutionLifecycleCoordinator()
  const taskId = brand<string, 'TaskId'>('task-three-reworks')
  const taskVersion = brand<number, 'TaskVersion'>(1)
  const attempts: string[] = []
  for (let index = 0; index < 4; index += 1) {
    const reservation = await lifecycle.reserveTaskDispatch({
      tenantId: 'tenant-lifecycle',
      missionId: missionId('mission-three-reworks'),
      taskId,
      taskVersion,
      dispatchKey: `dispatch-attempt-${index + 1}`,
      payloadHash: `payload-${index + 1}`,
      cause: index === 0 ? 'INITIAL' : 'REWORK',
    })
    attempts.push(reservation.attempt.attemptId)
    assert.equal(reservation.attempt.attemptNo, index + 1)
    assert.equal(
      reservation.attempt.cause,
      index === 0 ? 'INITIAL' : 'REWORK',
    )
    await lifecycle.bindActivationAgent(
      reservation.activation.activationId,
      identity('worker'),
    )
    await lifecycle.markDispatch({
      dispatchId: reservation.dispatch.dispatchId,
      state: 'ACCEPTED',
      childSessionId: sessionId(`child-rework-${index + 1}`),
      transportReceiptId: `transport-${index + 1}`,
    })
    await lifecycle.markDispatch({
      dispatchId: reservation.dispatch.dispatchId,
      state: 'STARTED',
      childSessionId: sessionId(`child-rework-${index + 1}`),
      transportReceiptId: `transport-${index + 1}`,
    })
    await lifecycle.settleActivation({
      activationId: reservation.activation.activationId,
      outcome: 'SETTLED',
      reason: index === 3 ? 'accepted' : 'verification requested rework',
      settlementReceiptId: `settlement-${index + 1}`,
    })
    assert.equal(
      await lifecycle.activeDispatchForTask(taskId, taskVersion),
      null,
    )
  }
  assert.equal(new Set(attempts).size, 4)
  for (const attemptId of attempts) {
    assert.equal((await lifecycle.getAttempt(attemptId))?.state, 'SETTLED')
  }
})

test('Activation liveness requires durable heartbeats and expires to recovery exactly once', async () => {
  let timestamp = Date.parse('2026-08-27T00:00:00.000Z')
  const lifecycle = new ExecutionLifecycleCoordinator({
    clock: () => new Date(timestamp),
    heartbeatLeaseMs: 30_000,
  })
  const taskId = brand<string, 'TaskId'>('task-heartbeat')
  const taskVersion = brand<number, 'TaskVersion'>(1)
  const reservation = await lifecycle.reserveTaskDispatch({
    tenantId: 'tenant-lifecycle',
    missionId: missionId('mission-heartbeat'),
    taskId,
    taskVersion,
    dispatchKey: 'dispatch-heartbeat',
    payloadHash: 'payload-heartbeat',
    cause: 'INITIAL',
  })
  await lifecycle.bindActivationAgent(
    reservation.activation.activationId,
    identity('worker'),
  )
  await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'ACCEPTED',
  })
  await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'STARTED',
    childSessionId: sessionId('child-heartbeat'),
    transportReceiptId: 'transport-heartbeat',
  })
  const started = await lifecycle.getActivation(
    reservation.activation.activationId,
  )
  assert.equal(started?.heartbeatSequence, 1)
  assert.equal(started?.state, 'RUNNING')

  timestamp += 20_000
  const heartbeat = await lifecycle.heartbeatActivation({
    activationId: reservation.activation.activationId,
  })
  assert.equal(heartbeat.heartbeatSequence, 2)
  assert.deepEqual(
    await lifecycle.reconcileExpiredActivations(),
    [],
  )

  timestamp += 30_001
  const expired = await lifecycle.reconcileExpiredActivations()
  assert.equal(expired.length, 1)
  assert.equal(expired[0]?.state, 'LOST')
  assert.equal(
    (await lifecycle.getDispatch(reservation.dispatch.dispatchId))?.state,
    'RECOVERY_REQUIRED',
  )
  assert.equal(
    (await lifecycle.getAttempt(reservation.attempt.attemptId))?.state,
    'LOST',
  )
  assert.deepEqual(await lifecycle.reconcileExpiredActivations(), [])
})

test('concurrent dispatch reservation is serialized, lineage-bound, and only exact-key idempotent', async () => {
  const lifecycle = new ExecutionLifecycleCoordinator()
  const taskId = brand<string, 'TaskId'>('task-concurrent-reservation')
  const taskVersion = brand<number, 'TaskVersion'>(1)
  const base = {
    tenantId: 'tenant-lifecycle',
    missionId: missionId('mission-concurrent-reservation'),
    taskId,
    taskVersion,
    payloadHash: 'same-payload',
    cause: 'INITIAL' as const,
  }
  const exact = await Promise.all([
    lifecycle.reserveTaskDispatch({
      ...base,
      dispatchKey: 'exact-key',
    }),
    lifecycle.reserveTaskDispatch({
      ...base,
      dispatchKey: 'exact-key',
    }),
  ])
  assert.equal(exact.filter(value => value.recovered).length, 1)
  assert.equal(new Set(exact.map(value => value.dispatch.dispatchId)).size, 1)

  await assert.rejects(
    lifecycle.reserveTaskDispatch({
      ...base,
      dispatchKey: 'different-key-same-payload',
    }),
    error => failureCode(error) === 'RESOURCE_LOCKED',
  )
  await assert.rejects(
    lifecycle.reserveTaskDispatch({
      ...base,
      tenantId: 'another-tenant',
      dispatchKey: 'cross-tenant-key',
    }),
    error => failureCode(error) === 'IDEMPOTENCY_CONFLICT',
  )
})

test('SQLite lifecycle retries storage CAS races without weakening dispatch identity', async () => {
  const temporary = await temporaryDirectory('military-lifecycle-cas-')
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const primary = new ExecutionLifecycleCoordinator({
      state: new SqliteExecutionLifecycleStateStore(
        database,
        'tenant-lifecycle-cas',
      ),
    })
    const contender = new ExecutionLifecycleCoordinator({
      state: new SqliteExecutionLifecycleStateStore(
        database,
        'tenant-lifecycle-cas',
      ),
    })
    const exactInput = {
      tenantId: 'tenant-lifecycle-cas',
      missionId: missionId('mission-lifecycle-cas'),
      taskId: brand<string, 'TaskId'>('task-lifecycle-cas-exact'),
      taskVersion: brand<number, 'TaskVersion'>(1),
      dispatchKey: 'dispatch-lifecycle-cas-exact',
      payloadHash: 'payload-lifecycle-cas-exact',
      cause: 'INITIAL' as const,
    }
    const exact = await Promise.all([
      primary.reserveTaskDispatch(exactInput),
      contender.reserveTaskDispatch(exactInput),
    ])
    assert.equal(exact.filter(value => value.recovered).length, 1)
    assert.equal(
      new Set(exact.map(value => value.dispatch.dispatchId)).size,
      1,
    )

    const conflictingBase = {
      tenantId: 'tenant-lifecycle-cas',
      missionId: missionId('mission-lifecycle-cas'),
      taskId: brand<string, 'TaskId'>('task-lifecycle-cas-conflict'),
      taskVersion: brand<number, 'TaskVersion'>(1),
      payloadHash: 'payload-lifecycle-cas-conflict',
      cause: 'INITIAL' as const,
    }
    const conflicting = await Promise.allSettled([
      primary.reserveTaskDispatch({
        ...conflictingBase,
        dispatchKey: 'dispatch-lifecycle-cas-a',
      }),
      contender.reserveTaskDispatch({
        ...conflictingBase,
        dispatchKey: 'dispatch-lifecycle-cas-b',
      }),
    ])
    assert.equal(
      conflicting.filter(result => result.status === 'fulfilled').length,
      1,
    )
    const rejected = conflicting.find(
      result => result.status === 'rejected',
    )
    assert.equal(
      rejected?.status === 'rejected'
        ? failureCode(rejected.reason)
        : undefined,
      'RESOURCE_LOCKED',
    )
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('dispatch replay does not mutate liveness and conflicting replay is rejected', async () => {
  let timestamp = Date.parse('2026-08-27T01:00:00.000Z')
  const lifecycle = new ExecutionLifecycleCoordinator({
    clock: () => new Date(timestamp),
  })
  const reservation = await lifecycle.reserveTaskDispatch({
    tenantId: 'tenant-lifecycle',
    missionId: missionId('mission-dispatch-replay'),
    taskId: brand<string, 'TaskId'>('task-dispatch-replay'),
    taskVersion: brand<number, 'TaskVersion'>(1),
    dispatchKey: 'dispatch-replay',
    payloadHash: 'payload-replay',
    cause: 'INITIAL',
  })
  await lifecycle.bindActivationAgent(
    reservation.activation.activationId,
    identity('worker'),
  )
  await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'ACCEPTED',
    transportReceiptId: 'transport-replay',
  })
  timestamp += 1_000
  const started = await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'STARTED',
    childSessionId: sessionId('child-dispatch-replay'),
    transportReceiptId: 'transport-replay',
  })
  const activation = await lifecycle.getActivation(
    reservation.activation.activationId,
  )
  timestamp += 60_000
  const replayed = await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'STARTED',
    childSessionId: sessionId('child-dispatch-replay'),
    transportReceiptId: 'transport-replay',
  })
  assert.deepEqual(replayed, started)
  assert.deepEqual(
    await lifecycle.getActivation(reservation.activation.activationId),
    activation,
  )
  await assert.rejects(
    lifecycle.markDispatch({
      dispatchId: reservation.dispatch.dispatchId,
      state: 'STARTED',
      childSessionId: sessionId('another-child'),
      transportReceiptId: 'transport-replay',
    }),
    error => failureCode(error) === 'IDEMPOTENCY_CONFLICT',
  )
})

test('Activation cannot false-settle before start and recovery records terminal reason', async () => {
  const lifecycle = new ExecutionLifecycleCoordinator()
  const reservation = await lifecycle.reserveTaskDispatch({
    tenantId: 'tenant-lifecycle',
    missionId: missionId('mission-transition-guard'),
    taskId: brand<string, 'TaskId'>('task-transition-guard'),
    taskVersion: brand<number, 'TaskVersion'>(1),
    dispatchKey: 'dispatch-transition-guard',
    payloadHash: 'payload-transition-guard',
    cause: 'INITIAL',
  })
  await assert.rejects(
    lifecycle.settleActivation({
      activationId: reservation.activation.activationId,
      outcome: 'SETTLED',
      reason: 'false completion',
      settlementReceiptId: 'false-settlement',
    }),
    error => failureCode(error) === 'POLICY_DENIED',
  )
  await lifecycle.markDispatch({
    dispatchId: reservation.dispatch.dispatchId,
    state: 'RECOVERY_REQUIRED',
    failureCode: 'TRANSPORT_UNOBSERVED',
  })
  const activation = await lifecycle.getActivation(
    reservation.activation.activationId,
  )
  const attempt = await lifecycle.getAttempt(reservation.attempt.attemptId)
  assert.equal(activation?.state, 'LOST')
  assert.equal(activation?.settlementReason, 'TRANSPORT_UNOBSERVED')
  assert.ok(activation?.settledAt)
  assert.equal(attempt?.state, 'LOST')
  assert.equal(attempt?.settlementReason, 'TRANSPORT_UNOBSERVED')
  assert.ok(attempt?.settledAt)
  await assert.rejects(
    lifecycle.bindActivationAgent(
      reservation.activation.activationId,
      identity('worker'),
    ),
    error => failureCode(error) === 'POLICY_DENIED',
  )
})

function failureCode(error: unknown): string | undefined {
  return error instanceof MilitaryError ? error.failure.code : undefined
}
