import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MilitaryPlanningEngine, normalizeWorkspacePath, pathWithinAny } from '@dsh-military/core'
import { makeTask } from './fixtures.js'
import { brand } from '@dsh-military/contracts'

test('planner detects nested write conflicts and path policy rejects escapes', () => {
  const planner = new MilitaryPlanningEngine()
  const first = makeTask({ taskId: brand<string, 'TaskId'>('task-a'), scope: { readPaths: ['.'], writePaths: ['src'], forbiddenPaths: [] } })
  const second = makeTask({ taskId: brand<string, 'TaskId'>('task-b'), scope: { readPaths: ['.'], writePaths: ['src/components'], forbiddenPaths: [] } })
  const result = planner.validate([first, second])
  assert.ok(result.issues.some(issue => issue.code === 'WRITE_CONFLICT'))
  assert.equal(pathWithinAny('src/components/App.tsx', ['src']), true)
  assert.equal(pathWithinAny('../secrets', ['src']), false)
  assert.throws(() => normalizeWorkspacePath('../../etc/passwd'))
})

test('planner distinguishes Wave barriers, ordering dependencies and speculative edges', () => {
  const planner = new MilitaryPlanningEngine()
  const base = makeTask({
    taskId: brand<string, 'TaskId'>('task-plan-base'),
    scope: {
      readPaths: ['.'],
      writePaths: ['src/shared'],
      forbiddenPaths: [],
    },
  })
  const laterWave = {
    ...makeTask({
      taskId: brand<string, 'TaskId'>('task-plan-later-wave'),
      scope: {
        readPaths: ['.'],
        writePaths: ['src/shared'],
        forbiddenPaths: [],
      },
    }),
    waveId: brand<string, 'WaveId'>('wave-later'),
  }
  assert.equal(
    planner.validate([base, laterWave]).issues
      .some(issue => issue.code === 'WRITE_CONFLICT'),
    false,
  )

  const middle = {
    ...makeTask({
      taskId: brand<string, 'TaskId'>('task-plan-middle'),
      scope: {
        readPaths: ['.'],
        writePaths: ['src/middle'],
        forbiddenPaths: [],
      },
    }),
    dependencies: [{
      type: 'requires' as const,
      targetTaskId: base.taskId,
    }],
  }
  const transitive = {
    ...makeTask({
      taskId: brand<string, 'TaskId'>('task-plan-transitive'),
      scope: {
        readPaths: ['.'],
        writePaths: ['src/shared/nested'],
        forbiddenPaths: [],
      },
    }),
    dependencies: [{
      type: 'requires' as const,
      targetTaskId: middle.taskId,
    }],
  }
  assert.equal(
    planner.validate([base, middle, transitive]).issues
      .some(issue => issue.code === 'WRITE_CONFLICT'),
    false,
  )

  const speculative = {
    ...makeTask({
      taskId: brand<string, 'TaskId'>('task-plan-speculative'),
      scope: {
        readPaths: ['.'],
        writePaths: ['src/shared/speculative'],
        forbiddenPaths: [],
      },
    }),
    dependencies: [{
      type: 'speculativeWith' as const,
      targetTaskId: base.taskId,
    }],
  }
  assert.equal(
    planner.validate([base, speculative]).issues
      .some(issue => issue.code === 'WRITE_CONFLICT'),
    true,
  )
})
