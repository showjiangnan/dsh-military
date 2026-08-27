import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import {
  brand,
  type AgentTemplateId,
} from '@dsh-military/contracts'
import {
  LocalMainGit,
  SpecsEngineering,
  type SpecsMaintenanceOrder,
} from '@dsh-military/infrastructure'
import {
  defaultTemplates,
  defaultToolProfiles,
  departmentWorkspaceInstruction,
  MilitarySpecsControl,
  modelVisibleDepartmentTools,
} from '@dsh-military/plugin-host'
import { temporaryDirectory } from '@dsh-military/testkit'
import {
  taskGrantedTools,
  type DepartmentAgentSpawnRequest,
} from '@dsh-military/runtime'
import { task } from './helpers.js'

test('the 4844 Pro export remains a complete lightweight-model regression contract', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/4844-session-regression.json', 'utf8'),
  ) as {
    readonly source: {
      readonly archiveSha256: string
      readonly jsonlFiles: number
      readonly allJsonlValid: boolean
      readonly pathsSafe: boolean
      readonly lineCounts: {
        readonly root: number
        readonly children: readonly number[]
      }
    }
    readonly observed: {
      readonly models: readonly string[]
      readonly totalToolCalls: number
      readonly totalToolErrors: number
      readonly invalidJsonToolArguments: number
      readonly engineerRequestToolSchemas: number
      readonly metadataBlockedSpecsTransactions: number
      readonly metadataBlockedWorkerSpawns: number
      readonly successfulAtomicSpecsCommits: number
      readonly parentAutoWakeAndSettlementWorked: boolean
    }
    readonly rootCauses: readonly string[]
    readonly postFixContract: {
      readonly maximumEngineerRequestToolSchemas: number
      readonly engineerMutationTool: string
      readonly liveFlashProviderValidationStillRequired: boolean
    }
  }
  assert.equal(
    fixture.source.archiveSha256,
    '267d6b80bb9bb20417f0405443744e141ccfc584042a7c8a1483ecbd9b7ebc7a',
  )
  assert.equal(fixture.source.jsonlFiles, 6)
  assert.equal(fixture.source.allJsonlValid, true)
  assert.equal(fixture.source.pathsSafe, true)
  assert.equal(
    fixture.source.lineCounts.root
      + fixture.source.lineCounts.children.reduce((sum, value) => sum + value, 0),
    12_293,
  )
  assert.deepEqual(fixture.observed.models, ['deepseek-v4-pro'])
  assert.equal(fixture.observed.totalToolCalls, 73)
  assert.equal(fixture.observed.totalToolErrors, 10)
  assert.equal(fixture.observed.invalidJsonToolArguments, 0)
  assert.equal(fixture.observed.engineerRequestToolSchemas, 20)
  assert.equal(fixture.observed.metadataBlockedSpecsTransactions, 2)
  assert.equal(fixture.observed.metadataBlockedWorkerSpawns, 2)
  assert.equal(fixture.observed.successfulAtomicSpecsCommits, 1)
  assert.equal(fixture.observed.parentAutoWakeAndSettlementWorked, true)
  assert.ok(fixture.rootCauses.length >= 8)
  assert.equal(fixture.postFixContract.maximumEngineerRequestToolSchemas, 9)
  assert.equal(
    fixture.postFixContract.engineerMutationTool,
    'military_specs_apply_order',
  )
  assert.equal(fixture.postFixContract.liveFlashProviderValidationStillRequired, true)
})

test('Engineer first-request vocabulary is one nine-tool Specs workflow', () => {
  const template = requireTemplate('engineer-default')
  const profile = requireProfile('engineer-tools')
  const request = spawnRequest(template.templateId, '/tmp/military-project')
  const tools = modelVisibleDepartmentTools(request, template, profile)
  assert.deepEqual(tools, [
    'read',
    'glob',
    'grep',
    'military_get_context',
    'military_get_order',
    'military_specs_read',
    'military_specs_apply_order',
    'military_submit_blocker',
    'report',
  ])
  for (const hidden of [
    'write',
    'edit',
    'bash',
    'military_specs_validate',
    'military_git_local_commit',
    'military_submit_candidate',
  ]) {
    assert.equal(tools.includes(hidden), false, hidden)
  }
  const instruction = departmentWorkspaceInstruction(request, template)
  assert.match(instruction, /使用项目相对路径/u)
  assert.match(instruction, /完整最终内容一次性传给 military_specs_apply_order/u)
  assert.match(instruction, /创建还是修改文件/u)
  assert.doesNotMatch(instruction, /Use this exact root for every/u)
})

test('Worker receives file tools with an explicit isolated-worktree path contract', () => {
  const template = requireTemplate('worker-default')
  const profile = requireProfile('worker-tools')
  const request = spawnRequest(
    template.templateId,
    '/tmp/military-state/worktrees/lease-1',
  )
  const tools = modelVisibleDepartmentTools(request, template, profile)
  assert.equal(tools.includes('write'), true)
  assert.equal(tools.includes('edit'), true)
  assert.equal(tools.includes('bash'), false)
  assert.ok(tools.length <= 14)
  const instruction = departmentWorkspaceInstruction(request, template)
  assert.match(instruction, /分配的隔离执行工作树/u)
  assert.match(instruction, /严格位于该工作树内的绝对路径/u)
  assert.match(instruction, /只提交一个 Candidate/u)
})

test('Task allowedTools constrain both model vocabulary and capability grants', () => {
  const template = requireTemplate('worker-default')
  const profile = requireProfile('worker-tools')
  const order = {
    ...task(undefined, 'task-tool-ceiling', ['src']),
    allowedTools: ['read', 'write'],
  }
  const request = {
    ...spawnRequest(template.templateId, '/tmp/worktrees/tool-ceiling'),
    taskOrder: order,
  }
  assert.deepEqual(modelVisibleDepartmentTools(request, template, profile), [
    'read',
    'write',
    'military_get_context',
    'military_get_order',
    'military_submit_blocker',
    'report',
  ])
  assert.deepEqual(taskGrantedTools(profile, order), [
    'read',
    'report',
    'write',
    'military_get_context',
    'military_get_order',
    'military_submit_blocker',
  ])
})

test('Specs read accepts missing and directory paths without inventing a skeleton', async () => {
  const temp = await temporaryDirectory('military-4844-specs-read-')
  try {
    const control = new MilitarySpecsControl()
    const empty = await control.read({
      workspaceRoot: temp.path,
      paths: ['specs'],
      signal: new AbortController().signal,
    })
    assert.deepEqual(empty.files, {})
    assert.deepEqual(empty.missingPaths, ['specs'])

    await mkdir(`${temp.path}/specs/nested`, { recursive: true })
    await writeFile(`${temp.path}/specs/one.md`, '# One\n', 'utf8')
    await writeFile(`${temp.path}/specs/nested/two.md`, '# Two\n', 'utf8')
    const read = await control.read({
      workspaceRoot: temp.path,
      paths: ['specs'],
      signal: new AbortController().signal,
    })
    assert.deepEqual(Object.keys(read.files), [
      'specs/nested/two.md',
      'specs/one.md',
    ])
    assert.deepEqual(read.missingPaths, [])
    assert.deepEqual(await control.validate(
      temp.path,
      new AbortController().signal,
    ), {
      valid: true,
      files: 2,
      errors: [],
    })
  } finally {
    await temp.dispose()
  }
})

test('untracked desktop metadata survives but does not block an exact Specs commit', async () => {
  const temp = await temporaryDirectory('military-4844-metadata-')
  try {
    const git = new LocalMainGit(temp.path)
    await git.ensureRepository()
    await writeFile(`${temp.path}/README.md`, '# Base\n', 'utf8')
    await git.commitLocalMain({
      message: 'chore: base',
      allowedPaths: ['README.md'],
    })
    await writeFile(`${temp.path}/.DS_Store`, 'desktop metadata', 'utf8')
    assert.deepEqual(await git.statusPaths(), ['.DS_Store'])
    assert.deepEqual(await git.materialStatusPaths(), [])

    const specs = new SpecsEngineering(temp.path)
    const order: SpecsMaintenanceOrder = {
      schemaVersion: '1.0.0',
      orderId: '4844-single-spec',
      missionId: 'mission-4844',
      trigger: { kind: 'manual', ref: 'task-4844:1' },
      requiredUpdates: [{
        document: 'specs/only-required-document.md',
        purpose: 'Prove exact Task-scoped Specs delivery.',
      }],
      allowedPaths: ['specs/only-required-document.md'],
      validation: ['git diff --check'],
      commitPolicy: {
        branch: 'main',
        localOnly: true,
        messageTemplate: 'docs(specs): 4844 exact document',
        requireCleanNonSpecsPaths: true,
      },
      issuedAt: '2026-08-25T00:00:00.000Z',
    }
    const receipt = await specs.apply(order, {
      'specs/only-required-document.md': '# Exact Task Document\n',
    }, new AbortController().signal)
    assert.deepEqual(receipt.changedPaths, ['specs/only-required-document.md'])
    assert.equal(
      await readFile(`${temp.path}/specs/only-required-document.md`, 'utf8'),
      '# Exact Task Document\n',
    )
    assert.deepEqual(await git.statusPaths(), ['.DS_Store'])
    assert.deepEqual(await git.materialStatusPaths(), [])

    await writeFile(`${temp.path}/README.md`, '# Material change\n', 'utf8')
    assert.deepEqual(await git.materialStatusPaths(), ['README.md'])
    await assert.rejects(
      git.requireMaterialClean(),
      /material working-tree changes/u,
    )
  } finally {
    await temp.dispose()
  }
})

function requireTemplate(id: string) {
  const template = defaultTemplates().find(value => String(value.templateId) === id)
  assert.ok(template)
  return template
}

function requireProfile(id: string) {
  const profile = defaultToolProfiles().find(value => value.toolProfileId === id)
  assert.ok(profile)
  return profile
}

function spawnRequest(
  templateId: AgentTemplateId,
  executionCwd: string,
): DepartmentAgentSpawnRequest {
  return {
    tenantId: 'local',
    rootSessionId: brand<string, 'SessionId'>('session-root'),
    parentSessionId: brand<string, 'SessionId'>('session-root'),
    missionId: brand<string, 'MissionId'>('mission-4844'),
    templateId,
    presetGeneration: 'military@test',
    prompt: 'Perform the bounded Task.',
    label: '4844 regression',
    taskId: brand<string, 'TaskId'>('task-4844'),
    executionCwd,
    signal: new AbortController().signal,
  }
}
