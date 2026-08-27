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
