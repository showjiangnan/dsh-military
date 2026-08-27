import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MilitaryError } from '@dsh-military/contracts'
import {
  authoritativeSessionWorkspaceKey,
  MilitarySpecsControl,
} from '@dsh-military/plugin-host'
import { engineerTools, militaryArtifactTool } from '@dsh-military/tools'
import { defineJsonTool } from '../packages/tools/src/common.js'

test('the stopped cb4 Flash session remains a forensic regression contract', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/cb4-session-regression.json', 'utf8'),
  ) as {
    readonly observed: {
      readonly maximumObservedStep: number
      readonly maskedReservationErrors: number
      readonly workspaceSnapshotArtifactErrors: number
      readonly wrongWorkspaceRootErrors: number
    }
    readonly postFixContract: {
      readonly effectiveEngineerMaximumSteps: number
      readonly validationCommands: readonly string[]
      readonly settleOnlyAdmittedCalls: boolean
      readonly specsWritesAtomic: boolean
      readonly missingRootWorkspaceDisposition: string
    }
  }

  assert.equal(fixture.observed.maximumObservedStep, 27)
  assert.equal(fixture.observed.maskedReservationErrors, 2)
  assert.equal(fixture.observed.workspaceSnapshotArtifactErrors, 1)
  assert.equal(fixture.observed.wrongWorkspaceRootErrors, 1)
  assert.equal(fixture.postFixContract.effectiveEngineerMaximumSteps, 16)
  assert.deepEqual(fixture.postFixContract.validationCommands, ['git diff --check'])
  assert.equal(fixture.postFixContract.settleOnlyAdmittedCalls, true)
  assert.equal(fixture.postFixContract.specsWritesAtomic, true)
  assert.equal(fixture.postFixContract.missingRootWorkspaceDisposition, 'FAIL_CLOSED')
})

test('Workspace Snapshot references resolve through their dedicated immutable store', async () => {
  const agent = { id: 'engineer-cb4-regression' } as unknown as Agent
  const snapshot = {
    schemaVersion: '1.0.0',
    workspaceSnapshotId: 'workspace-snapshot-cb4',
    tenantId: 'local',
    workspaceKey: '/tmp/session-workspace',
    git: {
      head: 'abc123',
      treeHash: 'def456',
      branch: 'main',
      dirty: false,
    },
    capturedAt: '2026-08-24T00:00:00.000Z',
  }
  const context = {
    militaryHost: {
      tenantId: 'local',
      identities: {
        require(candidate: Agent) {
          assert.equal(candidate, agent)
          return {
            agentId: 'engineer-cb4-regression',
            sessionId: 'session-cb4-regression',
            role: 'engineer',
            displayName: 'Engineer',
            generation: 1,
          }
        },
      },
      application: {
        workspaces: {
          snapshotById(ref: string) {
            assert.equal(ref, snapshot.workspaceSnapshotId)
            return snapshot
          },
        },
      },
    },
  } as unknown as Context

  const result = await militaryArtifactTool(context).execute(
    { ref: snapshot.workspaceSnapshotId },
    {
      agent,
      signal: new AbortController().signal,
    } as unknown as ToolRunContext,
  )
  assert.deepEqual(result, {
    ref: snapshot.workspaceSnapshotId,
    kind: 'workspace-snapshot',
    snapshot,
  })
})

test('Specs control fails closed without an absolute authoritative workspace', async () => {
  const specs = new MilitarySpecsControl()
  await assert.rejects(
    specs.read({
      workspaceRoot: 'relative/session-workspace',
      paths: [],
      signal: new AbortController().signal,
    }),
    /absolute authoritative workspace root/u,
  )
})

test('root Session workspace never falls back to the Web process directory', () => {
  assert.throws(
    () => authoritativeSessionWorkspaceKey(undefined, undefined),
    /requires an absolute workspace cwd/u,
  )
  assert.throws(
    () => authoritativeSessionWorkspaceKey(undefined, 'relative/project'),
    /requires an absolute workspace cwd/u,
  )
  assert.equal(
    authoritativeSessionWorkspaceKey(undefined, '/tmp/explicit-project'),
    '/tmp/explicit-project',
  )
  assert.equal(
    authoritativeSessionWorkspaceKey(
      { workspaceKey: '/tmp/root-project' },
      '/tmp/untrusted-child-cwd',
    ),
    '/tmp/root-project',
  )
})

test('Engineer receives a shallow Specs draft while Host owns validation and commit policy', () => {
  const definition = engineerTools({} as Context)
    .find(tool => tool.name === 'military_specs_apply_order')
  assert.ok(definition)
  const draft = record(record(record(definition.parameters).properties).draft)
  assert.deepEqual(draft.required, ['updates'])
  const draftProperties = record(draft.properties)
  const update = record(record(record(draftProperties.updates).items))
  assert.deepEqual(update.required, ['document', 'purpose'])
  assert.ok(Object.hasOwn(record(update.properties), 'content'))
  assert.ok(Object.hasOwn(record(update.properties), 'contentArtifactIds'))
  for (const hostOwned of [
    'missionId',
    'taskId',
    'trigger',
    'allowedPaths',
    'validation',
    'commitPolicy',
    'issuedAt',
  ]) {
    assert.equal(Object.hasOwn(draftProperties, hostOwned), false)
  }
})

test('Military domain failures cross the tool boundary as stable machine-readable JSON', async () => {
  const definition = defineJsonTool({
    name: 'military_test_machine_error',
    description: 'Regression-only error contract.',
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    async execute() {
      throw new MilitaryError('INVALID_ARGUMENT', 'invalid regression input', {
        field: 'validation',
      })
    },
  })

  await assert.rejects(
    definition.execute(
      {},
      { signal: new AbortController().signal } as unknown as ToolRunContext,
    ),
    error => {
      assert.ok(error instanceof Error)
      const value = JSON.parse(error.message) as {
        readonly error: {
          readonly code: string
          readonly message: string
          readonly retryable: boolean
          readonly recovery: string
          readonly details: { readonly field: string }
        }
      }
      assert.equal(value.error.code, 'INVALID_ARGUMENT')
      assert.equal(value.error.message, 'invalid regression input')
      assert.equal(value.error.retryable, false)
      assert.equal(typeof value.error.recovery, 'string')
      assert.equal(value.error.details.field, 'validation')
      return true
    },
  )
})

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}
