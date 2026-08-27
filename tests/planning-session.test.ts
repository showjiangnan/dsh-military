import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand, MilitaryError } from '@dsh-military/contracts'
import { InMemoryMilitarySessionGate, MilitaryPlanningEngine } from '@dsh-military/core'
import { militaryBinding, task } from './helpers.js'

test('planning engine orders dependencies and rejects parallel write conflicts', () => {
  const engine = new MilitaryPlanningEngine()
  const first = task(undefined, 'task-a', ['src/a'])
  const second = {
    ...task(first.missionId, 'task-b', ['src/b']),
    dependencies: [{ type: 'requires' as const, targetTaskId: first.taskId }],
  }
  const valid = engine.validate([second, first])
  assert.deepEqual(valid.topologicalOrder.map(String), ['task-a', 'task-b'])
  assert.equal(valid.issues.length, 0)

  const conflict = engine.validate([first, task(first.missionId, 'task-c', ['src/a'])])
  assert.ok(conflict.issues.some(issue => issue.code === 'WRITE_CONFLICT'))
})

test('planning engine detects cycles', () => {
  const engine = new MilitaryPlanningEngine()
  const a = task(undefined, 'a')
  const b = task(a.missionId, 'b')
  const cyclicA = { ...a, dependencies: [{ type: 'requires' as const, targetTaskId: b.taskId }] }
  const cyclicB = { ...b, dependencies: [{ type: 'requires' as const, targetTaskId: a.taskId }] }
  const result = engine.validate([cyclicA, cyclicB])
  assert.ok(result.issues.some(issue => issue.code === 'CYCLE'))
})

test('Military session gate isolates generations and verifies exact child inheritance', async () => {
  const gate = new InMemoryMilitarySessionGate()
  await gate.bind(militaryBinding('root'))
  await gate.bind(militaryBinding('child', 'root'))
  await gate.verifyChild(brand<string, 'SessionId'>('root'), brand<string, 'SessionId'>('child'))

  await gate.bind({ ...militaryBinding('bad-child', 'root'), capabilityFingerprint: brand<string, 'Sha256'>('b'.repeat(64)) })
  await assert.rejects(
    async () => gate.verifyChild(brand<string, 'SessionId'>('root'), brand<string, 'SessionId'>('bad-child')),
    (error: unknown) => error instanceof MilitaryError && error.failure.code === 'MILITARY_BINDING_MISMATCH',
  )
  await assert.rejects(
    async () => gate.requireMilitarySession(brand<string, 'SessionId'>('standard-session')),
    (error: unknown) => error instanceof MilitaryError && error.failure.code === 'MILITARY_PRESET_REQUIRED',
  )
})
