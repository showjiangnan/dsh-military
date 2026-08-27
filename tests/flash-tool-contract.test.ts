import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  brand,
  generalMilitaryToolNames,
  type MilitaryRole,
  workerMilitaryToolNames,
} from '@dsh-military/contracts'
import {
  defaultModelProfiles,
  defaultToolProfiles,
  ENGINEER_PHASE_TOOLS,
  INSPECTOR_PHASE_TOOLS,
  RESEARCH_PHASE_TOOLS,
  resolvePhaseVisibleTools,
  STAFF_PHASE_TOOLS,
  WORKER_PHASE_TOOLS,
} from '@dsh-military/plugin-host'
import {
  compileTaskDraft,
  engineerTools,
  generalTools,
  inspectorTools,
  militaryArtifactTool,
  missionSnapshotValue,
  parseTaskOrder,
  requireTaskGuidanceBudget,
  researchTools,
  staffTools,
  workerTools,
} from '@dsh-military/tools'
import { createAgentPlaneState } from '../packages/plugin-host/src/agent-plane-state.js'

const context = {} as Context

test('every model-facing Military argument has an explicit non-empty schema', () => {
  const definitions = [
    ...generalTools(context),
    ...workerTools(context),
    ...staffTools(context),
    ...engineerTools(context),
    ...inspectorTools(context),
    ...researchTools(context),
    militaryArtifactTool(context),
  ]
  const byName = new Map(definitions.map(definition => [definition.name, definition]))
  assert.ok(byName.size >= 32)
  for (const definition of byName.values()) {
    assertExplicitSchema(definition.parameters, `${definition.name}.parameters`)
  }
})

test('Flash receives a shallow Task draft while Host owns canonical identity and fencing', () => {
  const general = generalTools(context)
  const missionStart = general.find(tool => tool.name === 'military_mission_start')
  assert.ok(missionStart)
  const missionStartProperties = missionStart.parameters['properties']
  assert.ok(isRecord(missionStartProperties))
  assert.deepEqual(Object.keys(missionStartProperties), ['title'])

  const definition = general.find(tool => tool.name === 'military_task_create')
  assert.ok(definition)
  const parameters = definition.parameters as {
    readonly properties: Record<string, unknown>
    readonly required: readonly string[]
  }
  for (const required of [
    'objective',
    'assignedRole',
    'writePaths',
    'acceptanceCriteria',
  ]) {
    assert.ok(parameters.required.includes(required), `missing required draft field ${required}`)
  }
  for (const hostOwned of [
    'missionId',
    'directionId',
    'waveId',
    'taskId',
    'taskVersion',
    'taskKey',
    'direction',
    'wave',
    'scope',
    'dependencies',
    'stopConditions',
    'escalationConditions',
    'contextFootprint',
    'budget',
    'complexity',
    'requiredEvidence',
    'acceptance',
    'environmentSnapshotRef',
  ]) {
    assert.equal(Object.hasOwn(parameters.properties, hostOwned), false, `${hostOwned} leaked to model`)
  }

  const input = {
    objective: 'Create the initial sustainable specs.',
    whyItMatters: 'Workers need a canonical implementation contract.',
    taskType: 'specs',
    assignedRole: 'engineer',
    writePaths: ['specs', 'docs'],
    acceptanceCriteria: ['All specs references resolve.', 'A local-main commit receipt exists.'],
  }
  const missionId = brand<string, 'MissionId'>('mission-flash-contract')
  const first = compileTaskDraft({
    value: input,
    missionId,
    environmentSnapshotRef: 'workspace-snapshot-1',
  })
  const retry = compileTaskDraft({
    value: input,
    missionId,
    environmentSnapshotRef: 'workspace-snapshot-1',
  })
  assert.deepEqual(retry, first)
  assert.deepEqual(parseTaskOrder(first.order), first.order)
  assert.match(String(first.taskId), /^task-[0-9a-f]{32}$/u)
  assert.equal(Number(first.order.taskVersion), 1)
  assert.deepEqual(first.order.requiredEvidence, ['objective', 'tests', 'scope'])
  assert.match(first.order.objective, /Acceptance criteria:\n1\. All specs references resolve\./u)
  assert.ok(first.order.scope.forbiddenPaths.includes('.git'))
  assert.ok(first.order.allowedTools.includes('military_specs_apply_order'))
  assert.deepEqual(first.order.budget, {
    modelSteps: 16,
    toolCalls: 64,
    guidanceRequests: 4,
    wallClockSeconds: 7_200,
    maxOutputTokens: 16_384,
  })
  assert.deepEqual(first.order.scope, {
    readPaths: ['.'],
    writePaths: ['specs', 'docs'],
    forbiddenPaths: ['.git', '.dsh-military/control', '.dsh-military/secrets'],
  })
  assert.throws(
    () => compileTaskDraft({
      value: {
        ...input,
        taskKey: 'advanced-invalid-budget',
        scope: {
          readPaths: ['.'],
          writePaths: ['specs', 'docs'],
        },
        budget: { modelSteps: 65 },
      },
      missionId,
      environmentSnapshotRef: 'workspace-snapshot-1',
    }),
    /budget\.modelSteps must be an integer in \[1, 64\]/u,
  )
})

test('Task Tactical Request budget counts unique requests for the exact Task version', async () => {
  const missionId = brand<string, 'MissionId'>('mission-guidance-budget')
  const compiled = compileTaskDraft({
    value: {
      taskKey: 'guidance-budget',
      objective: 'Prove the Tactical Request fence.',
      assignedRole: 'worker',
      scope: { readPaths: ['src'], writePaths: ['src'] },
      acceptanceCriteria: ['The exact Task-version limit is enforced.'],
      budget: { guidanceRequests: 2 },
    },
    missionId,
    environmentSnapshotRef: 'workspace-snapshot-guidance',
  })
  const events = [
    {
      type: 'radio/requested',
      payload: {
        requestId: 'request-1',
        taskId: String(compiled.taskId),
        taskVersion: 1,
      },
    },
    {
      type: 'radio/requested',
      payload: {
        requestId: 'request-1',
        taskId: String(compiled.taskId),
        taskVersion: 1,
      },
    },
    {
      type: 'radio/requested',
      payload: {
        requestId: 'request-old-version',
        taskId: String(compiled.taskId),
        taskVersion: 0,
      },
    },
  ]
  const host = {
    application: {
      ledger: {
        async readEvents() { return events },
      },
    },
  } as unknown as Parameters<typeof requireTaskGuidanceBudget>[0]
  await requireTaskGuidanceBudget(host, compiled.order)
  events.push({
    type: 'radio/requested',
    payload: {
      requestId: 'request-2',
      taskId: String(compiled.taskId),
      taskVersion: 1,
    },
  })
  await assert.rejects(
    requireTaskGuidanceBudget(host, compiled.order),
    /Tactical Request budget is exhausted \(2\/2\); do not retry/u,
  )
})

test('Flash receives a shallow Specs apply draft and no Host-owned order fields', () => {
  const definition = engineerTools(context)
    .find(tool => tool.name === 'military_specs_apply_order')
  assert.ok(definition)
  const parameters = definition.parameters as {
    readonly properties: Record<string, unknown>
    readonly required: readonly string[]
  }
  assert.deepEqual(parameters.required, ['draft'])
  const draft = parameters.properties['draft'] as {
    readonly properties: Record<string, unknown>
    readonly required: readonly string[]
  }
  assert.deepEqual(draft.required, ['updates'])
  const updates = draft.properties['updates'] as {
    readonly items: {
      readonly properties: Record<string, unknown>
      readonly required: readonly string[]
    }
  }
  assert.deepEqual(updates.items.required, ['document', 'purpose'])
  assert.ok(Object.hasOwn(updates.items.properties, 'content'))
  assert.ok(Object.hasOwn(updates.items.properties, 'contentArtifactIds'))
  for (const hostOwned of [
    'schemaVersion',
    'orderId',
    'missionId',
    'trigger',
    'requiredUpdates',
    'allowedPaths',
    'validation',
    'commitPolicy',
    'issuedAt',
  ]) {
    assert.equal(Object.hasOwn(draft.properties, hostOwned), false)
  }
})

test('complex terminal tools expose shallow Flash contracts while Host owns canonical fields', () => {
  const definitions = [
    ...generalTools(context),
    ...workerTools(context),
    ...staffTools(context),
    ...engineerTools(context),
  ]
  const byName = new Map(definitions.map(definition => [definition.name, definition]))
  assertTopLevelRequired(byName.get('military_submit_candidate'), ['summary', 'evidenceRefs'])
  assertTopLevelRequired(byName.get('military_radio_request'), ['blocker', 'evidenceRefs', 'requestedDecision'])
  assertTopLevelRequired(byName.get('military_staff_issue_guidance'), [
    'requestId', 'diagnosis', 'steps', 'expectedObservations',
  ])
  for (const [name, forbidden] of [
    ['military_submit_candidate', ['identity', 'location', 'candidateId', 'idempotencyKey']],
    ['military_radio_request', ['identity', 'location', 'requestId', 'budget']],
    ['military_staff_issue_guidance', ['advisorIdentity', 'expectedTaskVersion', 'guidanceId']],
  ] as const) {
    const definition = byName.get(name)
    assert.ok(definition)
    const properties = definition.parameters['properties']
    assert.ok(isRecord(properties))
    for (const field of forbidden) {
      assert.equal(Object.hasOwn(properties, field), false, `${name}.${field}`)
    }
  }
})

test('progressive private Skill disclosure reuses one shallow Task tool and keeps exact versions Host-owned', () => {
  const getOrder = workerTools(context).find(tool => tool.name === 'military_get_order')
  assert.ok(getOrder)
  const properties = getOrder.parameters['properties']
  assert.ok(isRecord(properties))
  assert.deepEqual(Object.keys(properties), ['skillId'])
  const required = getOrder.parameters['required']
  assert.ok(required === undefined || Array.isArray(required))
  assert.equal(Array.isArray(required) && required.includes('skillId'), false)
  assert.match(
    getOrder.description,
    /Host derives its exact frozen version/u,
  )
})

test('canonical rejection returns one bounded correction packet for lightweight models', () => {
  assert.throws(
    () => parseTaskOrder({ schemaVersion: '1.0.0' }),
    error => {
      const message = String(error)
      assert.match(message, /missionId is required/u)
      assert.match(message, /directionId is required/u)
      assert.match(message, /waveId is required/u)
      assert.match(message, /taskId is required/u)
      assert.match(message, /more violation\(s\)/u)
      assert.ok(message.length < 420)
      return true
    },
  )
})

test('Mission snapshots cross the RC.2 JSON boundary without leaking Map values', () => {
  const value = missionSnapshotValue({
    missionId: brand<string, 'MissionId'>('mission-json-boundary'),
    revision: brand<number, 'Revision'>(3),
    activeWaveIds: [brand<string, 'WaveId'>('wave-json-boundary')],
    tasks: new Map([
      [
        brand<string, 'TaskId'>('task-json-boundary'),
        {
          taskVersion: brand<number, 'TaskVersion'>(2),
          state: 'EXECUTING',
        },
      ],
    ]),
  })
  assert.deepEqual(value, {
    missionId: 'mission-json-boundary',
    revision: 3,
    activeWaveIds: ['wave-json-boundary'],
    tasks: [{
      taskId: 'task-json-boundary',
      taskVersion: 2,
      state: 'EXECUTING',
    }],
  })
})

test('immutable ToolProfiles expose only the Military vocabulary for each role', () => {
  const profiles = new Map(defaultToolProfiles().map(profile => [profile.toolProfileId, profile]))
  const general = profiles.get('general-tools')
  const worker = profiles.get('worker-tools')
  assert.ok(general)
  assert.ok(worker)
  assert.deepEqual(
    generalMilitaryToolNames.filter(name => !general.allowTools.includes(name)),
    [],
  )
  assert.deepEqual(
    workerMilitaryToolNames.filter(name => !worker.allowTools.includes(name)),
    [],
  )
  assert.equal(general.allowTools.includes('military_specs_read'), false)
  assert.equal(general.allowTools.includes('ask_user_question'), true)
  assert.equal(general.allowTools.includes('bash'), false)
  assert.equal(general.allowTools.includes('military_submit_candidate'), false)
  assert.equal(worker.allowTools.includes('military_mission_start'), false)
  assert.equal(worker.allowTools.includes('military_specs_read'), false)
  for (const profile of profiles.values()) {
    if (profile.toolProfileId !== 'general-tools') {
      assert.equal(profile.allowTools.includes('report'), true, profile.toolProfileId)
    }
    assert.equal(Number(profile.revision), 7)
  }
})

test('every Host-owned model phase exposes one to four ToolProfile-authorized tools', async () => {
  const profiles = new Map(defaultToolProfiles().map(profile => [profile.toolProfileId, profile]))
  const assertPhaseMap = (
    profileId: string,
    phases: Readonly<Record<string, ReadonlySet<string>>>,
  ): void => {
    const profile = profiles.get(profileId)
    assert.ok(profile)
    for (const [phase, tools] of Object.entries(phases)) {
      assert.ok(tools.size >= 1 && tools.size <= 4, `${profileId}.${phase} has ${tools.size} tools`)
      for (const name of tools) {
        assert.ok(profile.allowTools.includes(name), `${profileId}.${phase} leaks ${name}`)
      }
    }
  }
  assertPhaseMap('worker-tools', WORKER_PHASE_TOOLS)
  assertPhaseMap('engineer-tools', ENGINEER_PHASE_TOOLS)
  assertPhaseMap('staff-tools', STAFF_PHASE_TOOLS)
  assertPhaseMap('inspector-tools', { ACTIVE: INSPECTOR_PHASE_TOOLS })
  assertPhaseMap('research-tools', { ACTIVE: RESEARCH_PHASE_TOOLS })

  const roles: readonly MilitaryRole[] = [
    'general',
    'advisor',
    'chief-of-staff',
    'worker',
    'engineer',
    'inspector',
    'trajectory',
    'effectiveness',
    'museum',
    'evaluation-examiner',
    'evaluation-chair',
    'harness',
  ]
  for (const role of roles) {
    const agent = { id: `phase-${role}` } as unknown as Agent
    const state = createAgentPlaneState()
    const host = {
      async identityFor() {
        return {
          agentId: `phase-${role}`,
          sessionId: `session-${role}`,
          role,
          displayName: role,
          generation: 1,
        }
      },
    } as unknown as Parameters<typeof resolvePhaseVisibleTools>[0]
    const visible = await resolvePhaseVisibleTools(host, agent, state)
    assert.ok(visible)
    assert.ok(visible.size >= 1 && visible.size <= 4, `${role} has ${visible.size} tools`)
  }
})

test('anonymized Flash failure baseline remains attached to an unpromoted capability profile', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/flash-session-regression.json', 'utf8'),
  ) as {
    readonly observed: {
      readonly militaryCalls: number
      readonly militaryErrors: number
      readonly visibleMilitaryTools: number
      readonly opaqueStructuredFields: number
    }
    readonly postFixContract: {
      readonly maximumVisibleGeneralMilitaryTools: number
      readonly opaqueStructuredFields: number
      readonly taskIdentityOwner: string
    }
  }
  assert.equal(fixture.observed.militaryCalls, 11)
  assert.equal(fixture.observed.militaryErrors, 7)
  assert.equal(fixture.observed.visibleMilitaryTools, 34)
  assert.equal(fixture.observed.opaqueStructuredFields, 17)
  assert.equal(fixture.postFixContract.maximumVisibleGeneralMilitaryTools, 15)
  assert.equal(fixture.postFixContract.opaqueStructuredFields, 0)
  assert.equal(fixture.postFixContract.taskIdentityOwner, 'HOST')

  const flash = defaultModelProfiles().find(
    profile => profile.provider === 'deepseek-official'
      && profile.model === 'deepseek-v4-flash',
  )
  assert.ok(flash)
  assert.equal(flash.status, 'CANARY')
  assert.deepEqual(flash.benchmarks, [{
    taskType: 'pre-fix-brainstorm-tool-contract',
    reasoning: 'max',
    sampleCount: 1,
    finalAcceptanceRate: 0,
    falseCompletionRate: 0,
  }])
})

function assertTopLevelRequired(
  definition: { readonly parameters: Record<string, unknown> } | undefined,
  expected: readonly string[],
): void {
  assert.ok(definition)
  const required = definition.parameters['required']
  assert.ok(Array.isArray(required))
  assert.deepEqual(required, expected)
}

function assertExplicitSchema(value: unknown, path: string): void {
  assert.ok(isRecord(value), `${path} must be a schema object`)
  assert.ok(Object.keys(value).length > 0, `${path} is an empty schema`)
  if (value['type'] === 'object') {
    const properties = value['properties']
    assert.ok(isRecord(properties), `${path}.properties must be explicit`)
    if (Object.keys(properties).length === 0 && !path.endsWith('.parameters')) {
      assert.equal(value['additionalProperties'], true, `${path} must declare an intentional open object`)
    }
    for (const [key, property] of Object.entries(properties)) {
      assertExplicitSchema(property, `${path}.properties.${key}`)
    }
  }
  if (value['type'] === 'array' && value['items'] !== undefined) {
    assertExplicitSchema(value['items'], `${path}.items`)
  }
  if (Array.isArray(value['oneOf'])) {
    for (const [index, branch] of value['oneOf'].entries()) {
      assertExplicitSchema(branch, `${path}.oneOf[${index}]`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
