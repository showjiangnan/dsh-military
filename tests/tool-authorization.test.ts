import { mkdir, symlink } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  type AgentExecutionBinding,
  type CapabilityGrant,
  type PermissionProfile,
  type ResourceBudgetPolicy,
  type ToolProfile,
} from '@dsh-military/contracts'
import {
  authorizeDepartmentToolExecution,
  canonicalizeToolTarget,
  settleToolExecutionBudget,
  taskBoundToolPathPolicy,
  toolBudgetReservationId,
} from '@dsh-military/plugin-host/tool-authorization'
import {
  SqliteCapabilityGrantStore,
  SqliteMilitaryDatabase,
  SqliteMilitaryResourceBudgets,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import { identity, missionId, stamp, task } from './helpers.js'

test('tool path canonicalization rejects escapes and symlink traversal', async () => {
  const temp = await temporaryDirectory('military-path-auth-')
  try {
    const root = `${temp.path}/workspace`
    const outside = `${temp.path}/outside`
    await mkdir(`${root}/src`, { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, `${root}/src/external`)

    assert.deepEqual(await canonicalizeToolTarget({
      root,
      raw: `${root}/src/new.ts`,
      requireAbsolute: true,
      followSymlinks: false,
    }), { resource: 'src/new.ts' })
    assert.match((await canonicalizeToolTarget({
      root,
      raw: `${root}/../outside/secret.ts`,
      requireAbsolute: true,
      followSymlinks: false,
    })).denial ?? '', /outside the assigned filesystem root/u)
    assert.match((await canonicalizeToolTarget({
      root,
      raw: `${root}/src/external/secret.ts`,
      requireAbsolute: true,
      followSymlinks: false,
    })).denial ?? '', /symbolic link/u)
    assert.match((await canonicalizeToolTarget({
      root,
      raw: `${root}/src/external/secret.ts`,
      requireAbsolute: true,
      followSymlinks: true,
    })).denial ?? '', /resolves outside/u)
  } finally {
    await temp.dispose()
  }
})

test('an omitted Task path is safe only when RC.2 Session cwd is the execution root', () => {
  assert.deepEqual(taskBoundToolPathPolicy({
    executionRoot: '/workspace/project',
    sessionCwd: '/workspace/project',
    raw: '.',
  }), { requireAbsolute: false })
  const isolated = taskBoundToolPathPolicy({
    executionRoot: '/workspace/project/.worktrees/task-1',
    sessionCwd: '/workspace/project',
    raw: '.',
  })
  assert.equal(isolated.requireAbsolute, true)
  assert.match(isolated.denial ?? '', /absolute path rooted at .*\.worktrees\/task-1/u)
  assert.deepEqual(taskBoundToolPathPolicy({
    executionRoot: '/workspace/project/.worktrees/task-1',
    sessionCwd: '/workspace/project',
    raw: '/workspace/project/.worktrees/task-1/src',
  }), { requireAbsolute: true })
})

test('path and downstream denials do not consume grants; concurrent admission is atomic', async () => {
  const temp = await temporaryDirectory('military-grant-admission-')
  const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
  try {
    const root = `${temp.path}/workspace`
    await mkdir(`${root}/src`, { recursive: true })
    await mkdir(`${root}/docs`, { recursive: true })
    const worker = identity('worker')
    const order = task(missionId('authorization-mission'), 'authorization-task', ['src'])
    const grant: CapabilityGrant = {
      schemaVersion: '1.0.0',
      grantId: 'authorization-grant',
      principalId: String(worker.agentId),
      activationId: String(worker.sessionId),
      missionId: order.missionId,
      taskId: order.taskId,
      taskVersion: order.taskVersion,
      allowedTools: ['write'],
      resourcePatterns: ['src'],
      dataClassificationCeiling: 'confidential',
      maximumUses: 1,
      uses: 0,
      issuedAt: stamp(),
      expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
      nonce: 'authorization-nonce',
      state: 'ACTIVE',
    }
    const grants = new SqliteCapabilityGrantStore(database, 'tenant-1')
    await grants.issue(grant)
    const budgetPolicy: ResourceBudgetPolicy = {
      schemaVersion: '1.0.0',
      policyId: 'budget-default',
      revision: brand<number, 'Revision'>(1),
      status: 'ACTIVE',
      scope: 'TASK',
      limits: {
        modelRequests: 100,
        reasoningTokens: 100_000,
        wallClockSeconds: 10_000,
        toolCalls: 100,
        apiCalls: 100,
        concurrentAgents: 10,
        radioRounds: 10,
        reworkAttempts: 10,
        storageBytes: 100_000_000,
      },
      warningPercent: 80,
      hardStopPercent: 100,
      disposition: 'PAUSE_AND_REPORT',
      createdAt: stamp(),
    }
    const budgets = new SqliteMilitaryResourceBudgets(database, 'tenant-1')
    budgets.registerPolicy(budgetPolicy)
    const toolProfile: ToolProfile = {
      schemaVersion: '1.0.0',
      toolProfileId: 'worker-tools',
      revision: brand<number, 'Revision'>(1),
      status: 'ACTIVE',
      allowTools: ['write'],
      denyTools: [],
      maxParallelCalls: 2,
      timeoutOverrides: {},
      createdAt: stamp(),
    }
    const permission: PermissionProfile = {
      schemaVersion: '1.0.0',
      permissionProfileId: 'worker-permission',
      revision: brand<number, 'Revision'>(1),
      status: 'ACTIVE',
      defaultDecision: 'DENY',
      filesystem: {
        readPaths: ['src'],
        writePaths: ['src'],
        denyPaths: ['.git'],
        followSymlinks: false,
      },
      git: {
        allowLocalRead: true,
        allowLocalMainCommit: false,
        allowBranchCreate: false,
        allowRemoteWrite: false,
        allowDestructiveReset: false,
      },
      network: { allowGrantIds: [], denyUnlisted: true },
      classificationCeiling: 'confidential',
      createdAt: stamp(),
    }
    const binding = {
      tenantId: 'tenant-1',
      missionId: String(order.missionId),
      agent: worker,
      capabilityGrantId: grant.grantId,
      toolProfile: { id: toolProfile.toolProfileId, revision: toolProfile.revision },
      permissionProfile: { id: permission.permissionProfileId, revision: permission.revision },
      resourceBudgetPolicy: { id: budgetPolicy.policyId, revision: budgetPolicy.revision },
      workspace: {
        leaseId: 'lease-1',
        taskId: String(order.taskId),
        taskVersion: Number(order.taskVersion),
      },
    } as unknown as AgentExecutionBinding
    const host = {
      tenantId: 'tenant-1',
      config: { repositoryRoot: root },
      application: {
        policies: {
          async toolProfile() { return toolProfile },
          async permissionProfile() { return permission },
          async resourceBudgetPolicy() { return budgetPolicy },
        },
        runtime: { async getTask() { return order } },
        workspaces: { executionPath() { return root } },
        capabilityGrants: grants,
        resourceBudgets: budgets,
        authorization: {
          async resolve() {
            return {
              schemaVersion: '1.0.0',
              authorityContextId: 'authority-test',
              principalId: String(worker.agentId),
              tenantId: 'tenant-1',
              roles: ['worker'],
              scopes: ['tool.execute*'],
              sessionOwnership: [String(worker.sessionId)],
              workspaceMemberships: [root],
              dataClassificationCeiling: 'confidential',
              authorizationReceiptRefs: [],
              issuedAt: stamp(),
              expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
            }
          },
          async authorize() { return { allowed: true } },
        },
      },
    } as unknown as MilitaryHostRuntime
    const execution = (path: string): ToolExecution => ({
      callId: `call:${path}`,
      name: 'write',
      arguments: { file_path: path, content: 'test' },
      agent: undefined,
    }) as unknown as ToolExecution

    const outsideScope = await authorizeDepartmentToolExecution(
      host,
      binding,
      execution(`${root}/docs/denied.ts`),
      async () => ({ kind: 'allow' }),
    )
    assert.equal(outsideScope.kind, 'deny')
    if (outsideScope.kind === 'deny') {
      const failure = JSON.parse(outsideScope.reason) as {
        readonly error: {
          readonly code: string
          readonly nextTool: string
          readonly correctedShape: { readonly tool: string }
        }
      }
      assert.equal(failure.error.code, 'FORBIDDEN_SCOPE')
      assert.equal(failure.error.nextTool, 'write')
      assert.equal(failure.error.correctedShape.tool, 'write')
      assert.doesNotMatch(outsideScope.reason, new RegExp(escapeRegex(temp.path), 'u'))
    }
    assert.equal((await grants.get(grant.grantId)).uses, 0)
    await assert.rejects(
      budgets.getReservation(toolBudgetReservationId(worker, execution(`${root}/docs/denied.ts`))),
      /unknown reservation/u,
    )

    const downstreamDenied = await authorizeDepartmentToolExecution(
      host,
      binding,
      execution(`${root}/src/downstream.ts`),
      async () => ({ kind: 'deny', reason: 'downstream policy' }),
    )
    assert.deepEqual(downstreamDenied, { kind: 'deny', reason: 'downstream policy' })
    assert.equal((await grants.get(grant.grantId)).uses, 0)
    await assert.rejects(
      budgets.getReservation(toolBudgetReservationId(worker, execution(`${root}/src/downstream.ts`))),
      /unknown reservation/u,
    )

    const decisions = await Promise.all([
      authorizeDepartmentToolExecution(
        host,
        binding,
        execution(`${root}/src/one.ts`),
        async () => ({ kind: 'allow' }),
      ),
      authorizeDepartmentToolExecution(
        host,
        binding,
        execution(`${root}/src/two.ts`),
        async () => ({ kind: 'allow' }),
      ),
    ])
    assert.equal(decisions.filter(value => value.kind === 'allow').length, 1)
    assert.equal(decisions.filter(value => value.kind === 'deny').length, 1)
    assert.equal((await grants.get(grant.grantId)).uses, 1)
    assert.equal((await grants.get(grant.grantId)).state, 'EXHAUSTED')
    const allowedExecution = decisions[0]?.kind === 'allow'
      ? execution(`${root}/src/one.ts`)
      : execution(`${root}/src/two.ts`)
    const retriedAdmission = await authorizeDepartmentToolExecution(
      host,
      binding,
      allowedExecution,
      async () => ({ kind: 'allow' }),
    )
    assert.equal(retriedAdmission.kind, 'allow')
    assert.equal((await grants.get(grant.grantId)).uses, 1)
    await settleToolExecutionBudget(host, worker, allowedExecution, { ok: true }, stamp())
    assert.equal(
      (await budgets.getReservation(toolBudgetReservationId(worker, allowedExecution))).state,
      'SETTLED',
    )
    const usage = await budgets.usageForScope('TASK', String(order.taskId))
    assert.equal(usage.length, 1)
    assert.equal(usage[0]?.actual.toolCalls, 1)
  } finally {
    database.close()
    await temp.dispose()
  }
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
