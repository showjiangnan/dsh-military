import assert from 'node:assert/strict'
import test from 'node:test'
import {
  brand,
  type AgentIdentity,
} from '@dsh-military/contracts'
import {
  CorrelatedMilitaryTelemetry,
  type MilitaryOrchestrator,
} from '@dsh-military/core'
import { MilitaryCoordinationMaintenance } from '@dsh-military/plugin-host'

const coordinator: AgentIdentity = {
  agentId: brand<string, 'AgentId'>('agent-maintenance-test'),
  sessionId: brand<string, 'SessionId'>('session-maintenance-test'),
  role: 'harness',
  displayName: 'Maintenance Test',
  generation: 1,
}

test('coordination maintenance coalesces overlapping passes and records exact outcomes', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let dispatchCalls = 0
  const telemetry = new CorrelatedMilitaryTelemetry()
  const maintenance = new MilitaryCoordinationMaintenance({
    tenantId: 'tenant-maintenance',
    outbox: {
      async dispatchAvailable() {
        dispatchCalls += 1
        await gate
        return {
          delivered: 2,
          failed: 1,
          deadLettered: 1,
          remaining: 3,
        }
      },
    },
    radio: {
      async reconcileDeadLetters() {
        return []
      },
    },
    decisions: {
      async reconcileExpired() {
        return []
      },
    },
    runtime: {
      async deadLetterGuidanceWait(
        _input: Parameters<
          MilitaryOrchestrator['deadLetterGuidanceWait']
        >[0],
      ) {
        void _input
        return null
      },
      async expireDecisionWait(
        _input: Parameters<MilitaryOrchestrator['expireDecisionWait']>[0],
      ) {
        void _input
        return null
      },
    },
    lifecycle: {
      async reconcileExpiredActivations() {
        return []
      },
    },
    telemetry,
    coordinator,
  })

  const first = maintenance.runOnce()
  const second = maintenance.runOnce()
  assert.equal(second, first)
  release?.()
  assert.deepEqual(await first, {
    outbox: {
      delivered: 2,
      failed: 1,
      deadLettered: 1,
      remaining: 3,
    },
    guidanceDeadLetters: 0,
    expiredDecisions: 0,
    expiredActivations: 0,
  })
  assert.equal(dispatchCalls, 1)
  const snapshot = telemetry.snapshot()
  assert.equal(
    snapshot.spans.filter(value =>
      value.name === 'military.coordination.maintenance').length,
    1,
  )
  assert.deepEqual(
    snapshot.metrics
      .filter(value => value.name === 'military.outbox.delivery')
      .map(value => [value.attributes.outcome, value.value]),
    [
      ['delivered', 2],
      ['failed_or_dead_lettered', 2],
    ],
  )
})
