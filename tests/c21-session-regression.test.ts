import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  defaultToolProfiles,
  rc2ReportDelivery,
} from '@dsh-military/plugin-host'
import {
  DEPARTMENT_FINALIZATION_GRACE_STEPS,
  consumeCancelledChildSettlementOnly,
} from '../packages/plugin-host/src/context-audit.js'
import { compileEngineerSpecsDraft } from '@dsh-military/tools'
import { task } from './helpers.js'

test('the c21 parent/child failure export remains a complete forensic contract', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/c21-session-regression.json', 'utf8'),
  ) as {
    readonly source: {
      readonly archiveSha256: string
      readonly jsonlFiles: number
      readonly allJsonlValid: boolean
      readonly pathsSafe: boolean
    }
    readonly observed: {
      readonly rootToolCalls: number
      readonly childToolCalls: number
      readonly totalToolErrors: number
      readonly reportCallsRejectedByToolProfile: number
      readonly successfulSpecsCommitBeforeCancellation: boolean
      readonly engineerStrategyMaximumSteps: number
      readonly engineerTaskModelSteps: number
    }
    readonly rootCauses: readonly string[]
    readonly postFixContract: {
      readonly ordinaryReportDelivery: string
      readonly specsInputShape: string
      readonly terminalOnlyGraceSteps: number
      readonly userCancelledSettlementOnlyWake: string
    }
  }
  assert.equal(
    fixture.source.archiveSha256,
    'f9695113696be49d0345f0f4df9a912594add69e22697a8bd2bd8f990032a617',
  )
  assert.equal(fixture.source.jsonlFiles, 5)
  assert.equal(fixture.source.allJsonlValid, true)
  assert.equal(fixture.source.pathsSafe, true)
  assert.equal(fixture.observed.rootToolCalls + fixture.observed.childToolCalls, 71)
  assert.equal(fixture.observed.totalToolErrors, 14)
  assert.equal(fixture.observed.reportCallsRejectedByToolProfile, 2)
  assert.equal(fixture.observed.successfulSpecsCommitBeforeCancellation, true)
  assert.equal(fixture.observed.engineerStrategyMaximumSteps, 8)
  assert.equal(fixture.observed.engineerTaskModelSteps, 16)
  assert.ok(fixture.rootCauses.length >= 10)
  assert.equal(fixture.postFixContract.ordinaryReportDelivery, 'next-step')
  assert.equal(fixture.postFixContract.specsInputShape, 'SHALLOW_UPDATES_ONLY')
  assert.equal(
    fixture.postFixContract.terminalOnlyGraceSteps,
    DEPARTMENT_FINALIZATION_GRACE_STEPS,
  )
  assert.equal(
    fixture.postFixContract.userCancelledSettlementOnlyWake,
    'REJECT_WITHOUT_MODEL_REQUEST',
  )
})

test('every continuable department profile admits the RC.2 report tool and wakes General', () => {
  assert.equal(rc2ReportDelivery('ordinary'), 'next-step')
  assert.equal(rc2ReportDelivery('critical'), 'next-step')
  for (const profile of defaultToolProfiles()) {
    if (profile.toolProfileId === 'general-tools') continue
    assert.equal(profile.allowTools.includes('report'), true, profile.toolProfileId)
  }
})

test('Host compiles shallow Specs updates into exact Task authority without model refs', () => {
  const order = {
    ...task(undefined, 'task-c21-specs', ['specs']),
    assignedRole: 'engineer' as const,
    budget: {
      modelSteps: 16,
      toolCalls: 32,
      guidanceRequests: 2,
      wallClockSeconds: 300,
    },
  }
  const compiled = compileEngineerSpecsDraft({
    task: order,
    draft: {
      updates: [{
        document: 'specs/apache-svg-visualization.md',
        purpose: 'Record the implementation contract.',
        content: '# Apache SVG Visualization\n',
      }],
    },
    issuedAt: '2026-08-25T00:00:00.000Z',
  })
  assert.equal(compiled.order.missionId, String(order.missionId))
  assert.deepEqual(compiled.order.trigger, {
    kind: 'manual',
    ref: 'task:task-c21-specs:1',
  })
  assert.deepEqual(compiled.order.requiredUpdates[0]?.sourceEventIds, [
    'task:task-c21-specs:1',
  ])
  assert.deepEqual(compiled.order.allowedPaths, [
    'specs/apache-svg-visualization.md',
  ])
  assert.deepEqual(compiled.order.validation, ['git diff --check'])
  assert.deepEqual(compiled.contentByDocument, {
    'specs/apache-svg-visualization.md': '# Apache SVG Visualization\n',
  })
  assert.equal(JSON.stringify(compiled).includes('@1'), false)

  assert.throws(
    () => compileEngineerSpecsDraft({
      task: order,
      draft: {
        updates: [{
          document: 'docs/outside.md',
          purpose: 'Broaden authority.',
          content: '# no\n',
        }],
      },
    }),
    /outside the immutable Task write scope/u,
  )
  assert.throws(
    () => compileEngineerSpecsDraft({
      task: order,
      draft: {
        updates: [{
          document: 'specs/../src/escape.ts',
          purpose: 'Escape.',
          content: 'no\n',
        }],
      },
    }),
    /must name one file below specs\/ or docs/u,
  )
})

test('a settlement-only wake caused by explicit child cancellation is consumed once', () => {
  const cancelled = new Set(['session-child-cancelled'])
  const settlement = {
    source: {
      kind: 'subagent-settled',
      form: 'notice',
      senderSessionId: 'session-child-cancelled',
    },
    content: [{ type: 'text', text: 'cancelled' }],
  } as unknown as UserMessage
  assert.equal(consumeCancelledChildSettlementOnly([settlement], cancelled), true)
  assert.equal(cancelled.size, 0)

  const withUserInput = {
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'continue' }],
  } as unknown as UserMessage
  cancelled.add('session-child-cancelled')
  assert.equal(
    consumeCancelledChildSettlementOnly([settlement, withUserInput], cancelled),
    false,
  )
  assert.equal(cancelled.size, 0)
})
