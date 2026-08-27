import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  brand,
  flashReadiness,
  type AgentIdentity,
  type MissionId,
  type SessionId,
  type TaskId,
  type TaskVersion,
} from '@dsh-military/contracts'
import {
  AdaptiveExecutionRouter,
  ExecutionLifecycleCoordinator,
} from '@dsh-military/core'
import {
  createAgentPlaneState,
} from '../packages/plugin-host/src/agent-plane-state.js'
import {
  generalWorkflowInstruction,
  inferDshCatalogModelCapability,
  isContinuation,
  nextGeneralWorkflowStage,
  rememberGeneralWorkflowTurn,
  resolveDshReasoningEffort,
  requiresMilitaryExecution,
  shouldSuppressGeneralOutput,
  suppressGeneralImplementationText,
} from '@dsh-military/plugin-host'
import type { MilitaryHostRuntime } from '../packages/plugin-host/src/context.js'
import { task } from './helpers.js'

test('the 71fe export remains an exact General orchestration regression contract', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/71fe-session-regression.json', 'utf8'),
  ) as {
    readonly source: {
      readonly archiveSha256: string
      readonly jsonlFiles: number
      readonly lineCount: number
      readonly allJsonlValid: boolean
      readonly pathsSafe: boolean
    }
    readonly observed: {
      readonly agentPreset: string
      readonly provider: string
      readonly model: string
      readonly turns: number
      readonly maxTokenTurns: number
      readonly toolCalls: number
      readonly missionStartCalls: number
      readonly taskCreateCalls: number
      readonly departmentSpawnCalls: number
      readonly assistantImplementationTextCharacters: number
      readonly assistantHtmlCodeFences: number
    }
    readonly rootCauses: readonly string[]
    readonly postFixContract: {
      readonly projectExecutionSequence: readonly string[]
      readonly assistantImplementationBeforeVerifiedDepartmentResult: string
      readonly generalNoProgressLimit: number
      readonly plainExplanationWithoutProjectMutation: string
    }
  }
  assert.equal(
    fixture.source.archiveSha256,
    'bfa0fac26170470edb38e36a97097a60c67f2ef78e917a29c3dafec69207e2c1',
  )
  assert.equal(fixture.source.jsonlFiles, 1)
  assert.equal(fixture.source.lineCount, 2482)
  assert.equal(fixture.source.allJsonlValid, true)
  assert.equal(fixture.source.pathsSafe, true)
  assert.equal(fixture.observed.agentPreset, 'military')
  assert.equal(fixture.observed.provider, 'deepseek-official')
  assert.equal(fixture.observed.model, 'deepseek-v4-flash')
  assert.equal(fixture.observed.turns, 4)
  assert.equal(fixture.observed.maxTokenTurns, 4)
  assert.equal(fixture.observed.toolCalls, 1)
  assert.equal(fixture.observed.missionStartCalls, 1)
  assert.equal(fixture.observed.taskCreateCalls, 0)
  assert.equal(fixture.observed.departmentSpawnCalls, 0)
  assert.equal(fixture.observed.assistantImplementationTextCharacters, 37_362)
  assert.equal(fixture.observed.assistantHtmlCodeFences, 2)
  assert.ok(fixture.rootCauses.length >= 4)
  assert.equal(
    fixture.postFixContract.assistantImplementationBeforeVerifiedDepartmentResult,
    'DENY_AND_STEER',
  )
  assert.equal(fixture.postFixContract.generalNoProgressLimit, 3)
})

test('project execution intent is compiled into one stage at a time for General', async () => {
  const original = '创建一个html页面，使用svg画一个美军阿帕奇武装直升机的可视化页面，精美的3d视图，带有UI交互'
  assert.equal(requiresMilitaryExecution(original), true)
  assert.equal(requiresMilitaryExecution('解释一下 SVG viewBox 的作用'), false)
  assert.equal(isContinuation('继续'), true)

  const state = createAgentPlaneState()
  const agent = {
    id: 'general-71fe',
    session: {
      events: [{
        type: 'user/message',
        data: createUserMessage({
          content: [{ type: 'text', text: original }],
          source: { kind: 'user', rpcId: '71fe-user' },
        }),
      }],
    },
  }
  const identity: AgentIdentity = {
    agentId: brand<string, 'AgentId'>('general-71fe'),
    sessionId: brand<string, 'SessionId'>('session-71fe'),
    role: 'general',
    displayName: 'General',
    generation: 1,
  }
  let missionId: MissionId | null = null
  const tasks = new Map<TaskId, {
    taskVersion: TaskVersion
    state: 'READY' | 'ACCEPTED'
  }>()
  const host = workflowHost(identity.sessionId, () => missionId, tasks)

  const direct = createUserMessage({
    content: [{ type: 'text', text: original }],
    source: { kind: 'user', rpcId: '71fe-direct' },
  })
  assert.equal(
    rememberGeneralWorkflowTurn(state, agent, 1, [direct]),
    'USER_EXECUTION',
  )
  assert.equal(await nextGeneralWorkflowStage({
    host,
    state,
    agent,
    identity,
    turn: 1,
  }), 'START_MISSION')

  missionId = brand<string, 'MissionId'>('mission-71fe')
  assert.equal(await nextGeneralWorkflowStage({
    host,
    state,
    agent,
    identity,
    turn: 1,
  }), 'CREATE_TASK')

  tasks.set(brand<string, 'TaskId'>('task-71fe'), {
    taskVersion: brand<number, 'TaskVersion'>(1),
    state: 'READY',
  })
  assert.equal(await nextGeneralWorkflowStage({
    host,
    state,
    agent,
    identity,
    turn: 1,
  }), 'READ_DEPARTMENT_STATUS')
  state.generalSuccessfulToolsByTurn.set(
    'general-71fe:1',
    new Set(['military_status']),
  )
  assert.equal(await nextGeneralWorkflowStage({
    host,
    state,
    agent,
    identity,
    turn: 1,
  }), 'SPAWN_DEPARTMENT')

  const directive = generalWorkflowInstruction('SPAWN_DEPARTMENT')
  assert.match(directive, /Mission → Task → 部门执行/u)
  assert.match(directive, /禁止在助手正文输出实现代码/u)
  assert.match(directive, /military_spawn_department_agent/u)
})

test('General implementation prose is removed while governed tool calls remain executable', async () => {
  const source: readonly StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'I will bypass the department.' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'reasoning', text: 'I will bypass the department.' },
    },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '```html\\n<html>direct implementation</html>\\n```' },
    {
      type: 'block-end',
      index: 1,
      block: {
        type: 'text',
        text: '```html\\n<html>direct implementation</html>\\n```',
      },
    },
    { type: 'block-start', index: 2, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 2,
      id: CallId('task-create'),
      name: 'military_task_create',
      argumentsDelta: '{"objective":"创建页面"}',
    },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  async function* stream(): AsyncIterable<StreamChunk> {
    yield* source
  }
  const retained: StreamChunk[] = []
  for await (const chunk of suppressGeneralImplementationText(stream())) {
    retained.push(chunk)
  }
  assert.deepEqual(retained.map(chunk => chunk.type), [
    'block-start',
    'tool-call-delta',
    'usage',
    'finish',
  ])
  assert.equal(
    retained.some(chunk =>
      chunk.type === 'text-delta'
      || chunk.type === 'reasoning-delta'),
    false,
  )
  assert.equal(
    retained.find(chunk => chunk.type === 'tool-call-delta')?.name,
    'military_task_create',
  )
})

test('General output guard applies only to the live agent loop, not Session auxiliary calls', () => {
  const state = createAgentPlaneState()
  state.generalWorkflowSessions.add('session-71fe')
  const auxiliary = {
    provider: 'provider',
    model: 'model',
    sessionId: 'session-71fe',
    messages: [],
    purpose: 'compaction',
  } as unknown as GenerateOptions
  assert.equal(shouldSuppressGeneralOutput(auxiliary, state), false)
  assert.equal(
    shouldSuppressGeneralOutput(markAgentLoopRequest({
      provider: 'provider',
      model: 'model',
      sessionId: 'session-71fe',
      messages: [],
    } as unknown as GenerateOptions), state),
    true,
  )
})

test('a terse continuation inherits the prior project obligation but not a completed task', async () => {
  const original = '修复项目中的配置保存问题'
  const agent = {
    id: 'general-continuation',
    session: {
      events: [{
        type: 'user/message',
        data: createUserMessage({
          content: [{ type: 'text', text: original }],
          source: { kind: 'user', rpcId: 'prior-user' },
        }),
      }],
    },
  }
  const state = createAgentPlaneState()
  const continuation = createUserMessage({
    content: [{ type: 'text', text: '继续' }],
    source: { kind: 'user', rpcId: 'continue-user' },
  })
  assert.equal(
    rememberGeneralWorkflowTurn(state, agent, 2, [continuation]),
    'CONTINUATION',
  )
  const identity: AgentIdentity = {
    agentId: brand<string, 'AgentId'>('general-continuation'),
    sessionId: brand<string, 'SessionId'>('session-continuation'),
    role: 'general',
    displayName: 'General',
    generation: 1,
  }
  const tasks = new Map<TaskId, {
    taskVersion: TaskVersion
    state: 'READY' | 'ACCEPTED'
  }>([[
    brand<string, 'TaskId'>('task-complete'),
    {
      taskVersion: brand<number, 'TaskVersion'>(1),
      state: 'ACCEPTED',
    },
  ]])
  const host = workflowHost(
    identity.sessionId,
    () => brand<string, 'MissionId'>('mission-complete'),
    tasks,
  )
  assert.equal(await nextGeneralWorkflowStage({
    host,
    state,
    agent,
    identity,
    turn: 2,
  }), null)
})

test('catalog presence remains separate from protocol and performance evidence', async () => {
  const capability = inferDshCatalogModelCapability({
    provider: 'third-party-provider',
    model: 'economy-flash-compatible',
    registeredAt: '2026-08-27T00:00:00.000Z',
  })
  assert.equal(capability.provider, 'third-party-provider')
  assert.equal(capability.model, 'economy-flash-compatible')
  assert.equal(capability.status, 'DRAFT')
  assert.equal(capability.catalogPresence, 'PRESENT')
  assert.equal(capability.protocolCompatibility, 'DSH_TOOL_REQUEST_AVAILABLE')
  assert.equal(capability.policyEligibility, 'ELIGIBLE_UNVERIFIED')
  assert.equal(capability.performanceEvidence, 'UNASSESSED')
  assert.equal(capability.toolCalling, false)
  assert.equal(capability.capabilityEvidence?.toolCalling, 'UNVERIFIED')
  assert.deepEqual(capability.supportedReasoning, ['off'])
  assert.ok(capability.contextWindowTokens >= 4_096)
  assert.ok(capability.maxOutputTokens >= 1_024)

  const readiness = flashReadiness({
    roleId: 'worker-default',
    prompt: '你是执行角色。只执行明确任务；完成后通过唯一终态工具提交证据并立即停止。',
    modelStatus: 'UNVERIFIED',
    toolSchemas: [{
      name: 'military_submit_candidate',
      available: true,
      propertyCount: 3,
      requiredCount: 2,
      maximumDepth: 2,
      schemaBytes: 400,
      terminal: true,
    }],
    maxOutputTokens: 8_192,
    contextBudgetTokens: 64_000,
  }, '2026-08-27T00:00:00.000Z')
  assert.equal(
    readiness.issues.find(value => value.code === 'MODEL_UNVERIFIED')?.severity,
    'INFO',
  )
  assert.equal(
    readiness.issues.some(value =>
      value.code === 'MODEL_NOT_RUNNABLE'
      && value.severity === 'ERROR'),
    false,
  )
})

test('an explicitly selected catalog model is routable regardless of historical validation status', async () => {
  const router = new AdaptiveExecutionRouter()
  const strategy = await router.route({
    task: task(
      brand<string, 'MissionId'>('mission-catalog-route'),
      'task-catalog-route',
      ['src'],
    ),
    capability: {
      schemaVersion: '1.0.0',
      profileId: 'capability-catalog-route',
      semanticCapabilities: ['implementation'],
      toolCapabilities: ['read', 'write'],
      minimumReasoning: 'high',
      minimumContextTokens: 4_096,
      inputModalities: ['text'],
      requiredVerificationTier: 'V2',
      riskClass: 'low',
      parallelismInputs: {
        independentSubproblems: 1,
        independentEvidenceSources: 1,
        sharedContext: 0,
        writeConflict: 0,
        temporalDependency: 0,
        joinCost: 0,
        integrationRisk: 0,
      },
    },
    candidateModels: [{
      ...inferDshCatalogModelCapability({
        provider: 'third-party-provider',
        model: 'legacy-labelled-model',
        registeredAt: '2026-08-27T00:00:00.000Z',
      }),
      status: 'DEPRECATED',
      supportedReasoning: ['off'],
    }],
    allowCanary: false,
  })
  assert.equal(strategy.provider, 'third-party-provider')
  assert.equal(strategy.model, 'legacy-labelled-model')
  assert.equal(strategy.reasoningEffort, 'high')
})

test('Military workload intent adapts to every DSH reasoning vocabulary', async () => {
  const withoutReasoning = await resolveDshReasoningEffort({
    ctx: reasoningContext(undefined),
    provider: 'provider-without-reasoning',
    model: 'plain-model',
    requested: 'high',
  })
  assert.equal(withoutReasoning.effort, undefined)
  assert.equal(withoutReasoning.adapted, true)

  const providerDefault = await resolveDshReasoningEffort({
    ctx: reasoningContext({
      efforts: [
        { id: 'economy', name: 'Economy' },
        { id: 'deliberate', name: 'Deliberate' },
      ],
      defaultEffort: 'economy',
    }),
    provider: 'provider-custom-vocabulary',
    model: 'custom-model',
    requested: 'high',
  })
  assert.equal(String(providerDefault.effort), 'economy')
  assert.equal(providerDefault.adapted, true)

  const exact = await resolveDshReasoningEffort({
    ctx: reasoningContext({
      efforts: [
        { id: 'off', name: 'Off' },
        { id: 'high', name: 'High' },
      ],
    }),
    provider: 'provider-standard-vocabulary',
    model: 'reasoning-model',
    requested: 'high',
  })
  assert.equal(String(exact.effort), 'high')
  assert.equal(exact.adapted, false)
})

function workflowHost(
  sessionId: SessionId,
  mission: () => MissionId | null,
  tasks: ReadonlyMap<TaskId, {
    readonly taskVersion: TaskVersion
    readonly state: 'READY' | 'ACCEPTED'
  }>,
): MilitaryHostRuntime {
  return {
    tenantId: 'tenant-workflow-test',
    application: {
      executionLifecycle: new ExecutionLifecycleCoordinator(),
      runtime: {
        async missionForSession(rootSessionId: SessionId) {
          assert.equal(rootSessionId, sessionId)
          return mission()
        },
      },
      ledger: {
        async readMission(missionId: MissionId) {
          return {
            missionId,
            revision: brand<number, 'Revision'>(1),
            activeWaveIds: [],
            tasks,
          }
        },
      },
    },
  } as unknown as MilitaryHostRuntime
}

function reasoningContext(
  reasoning: {
    readonly efforts: readonly {
      readonly id: string
      readonly name: string
    }[]
    readonly defaultEffort?: string
  } | undefined,
): Context {
  return {
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      },
    },
  } as unknown as Context
}
