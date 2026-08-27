import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import { SqliteMilitaryDatabase } from '@dsh-military/storage-sqlite'
import { createAgentPlaneState } from '../packages/plugin-host/src/agent-plane-state.js'
import { registerToolPipeline } from '../packages/plugin-host/src/tool-pipeline.js'
import { testProductionPlane } from './helpers.js'

type Handler = (...args: unknown[]) => unknown

test('a pre-execution ToolProfile denial preserves its reason and skips settlement', async t => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  t.after(() => database.close())
  const handlers = new Map<string, Handler>()
  const evidence: unknown[] = []
  let settlementLookups = 0
  const agent = { id: 'general-denied-tool' }
  const identity = {
    agentId: 'general-denied-tool',
    sessionId: 'general-denied-session',
    role: 'general',
    displayName: 'General',
    generation: 1,
  }
  const host = {
    tenantId: 'tenant-test',
    database,
    isMilitaryAgent(candidate: unknown) { return candidate === agent },
    async identityFor() { return identity },
    application: {
      production: testProductionPlane('tenant-test'),
      oversight: { requireAdmission() {} },
      policies: {
        async toolProfile() {
          return {
            toolProfileId: 'general-tools',
            revision: 3,
            allowTools: ['military_get_context'],
            denyTools: [],
          }
        },
      },
      observedEvidence: {
        async toolCalls() { return [] },
        async recordToolCall(value: unknown) { evidence.push(value) },
      },
      resourceBudgets: {
        async getReservation() {
          settlementLookups += 1
          throw new Error('unknown reservation')
        },
      },
      executionBindings: { async forAgent() { return null } },
    },
  } as unknown as MilitaryHostRuntime
  const ctx = {
    on(name: string, handler: Handler) { handlers.set(name, handler) },
  } as unknown as Context
  const state = createAgentPlaneState()
  state.generalWorkflowStageByAgent.set(String(agent.id), 'START_MISSION')
  registerToolPipeline(ctx, host, state)

  const execution = {
    callId: 'denied-mission-start-call',
    rootCallId: 'denied-mission-start-call',
    name: 'military_mission_start',
    arguments: { title: 'ToolProfile denial' },
    agent,
  } as unknown as ToolExecution
  const pre = requiredHandler(handlers, 'tools/pre-execute')
  const denied = await pre(execution, async () => ({ kind: 'allow' })) as {
    readonly kind: string
    readonly reason: string
  }
  assert.equal(denied.kind, 'deny')
  assert.equal(typeof denied.reason, 'string')
  const failure = JSON.parse(denied.reason) as {
    readonly error: {
      readonly code: string
      readonly message: string
      readonly retryable: boolean
      readonly nextTool: string
      readonly correctedShape: {
        readonly tool: string
      }
      readonly recovery: string
    }
  }
  assert.equal(failure.error.code, 'POLICY_DENIED')
  assert.match(failure.error.message, /military_mission_start.*general-tools@3/u)
  assert.equal(failure.error.retryable, false)
  assert.equal(failure.error.nextTool, 'military_status')
  assert.equal(failure.error.correctedShape.tool, 'military_status')
  assert.match(failure.error.recovery, /military_status.*military_spawn_department_agent/u)

  const post = requiredHandler(handlers, 'tools/post-execute')
  const result = {
    isError: true,
    error: denied,
    content: [],
  } as unknown as ToolExecutionResult
  await post(execution, result, async () => ({ kind: 'allow' }))
  assert.equal(evidence.length, 1)
  assert.equal(settlementLookups, 0)
})

test('the post-budget grace step admits only terminal coordination tools', async t => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  t.after(() => database.close())
  const handlers = new Map<string, Handler>()
  const agent = { id: 'engineer-finalization-only' }
  const host = {
    tenantId: 'tenant-test',
    database,
    isMilitaryAgent(candidate: unknown) { return candidate === agent },
    async identityFor() {
      return {
        agentId: 'engineer-finalization-only',
        sessionId: 'session-finalization-only',
        role: 'engineer',
        displayName: 'Engineer',
        generation: 1,
      }
    },
    application: {
      production: testProductionPlane('tenant-test'),
      oversight: { requireAdmission() {} },
    },
  } as unknown as MilitaryHostRuntime
  const ctx = {
    on(name: string, handler: Handler) { handlers.set(name, handler) },
  } as unknown as Context
  const state = createAgentPlaneState()
  state.finalizationOnlyAgents.add(String(agent.id))
  registerToolPipeline(ctx, host, state)
  const pre = requiredHandler(handlers, 'tools/pre-execute')
  const denied = await pre({
    callId: 'late-specs-read',
    rootCallId: 'late-specs-read',
    name: 'military_specs_read',
    arguments: {},
    agent,
  } as unknown as ToolExecution, async () => ({ kind: 'allow' })) as {
    readonly kind: string
    readonly reason: string
  }
  assert.equal(denied.kind, 'deny')
  const failure = JSON.parse(denied.reason) as {
    readonly error: { readonly code: string; readonly retryable: boolean }
  }
  assert.equal(failure.error.code, 'STEP_BUDGET_EXHAUSTED')
  assert.equal(failure.error.retryable, false)
})

test('ToolProfile parallelism, timeout, terminal latch and repeated-invalid recovery are executable', async t => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  t.after(() => database.close())
  const handlers = new Map<string, Handler>()
  const reservations = new Map<string, Record<string, unknown>>()
  const evidence: unknown[] = []
  const agent = {
    id: 'general-governed-tools',
    session: {
      events: [{ type: 'step/start', data: { turn: 1, step: 1 } }],
    },
  }
  const identity = {
    agentId: 'general-governed-tools',
    sessionId: 'general-governed-session',
    role: 'general',
    displayName: 'General',
    generation: 1,
  }
  const profile = {
    toolProfileId: 'general-tools',
    revision: 5,
    allowTools: ['ask_user_question', 'military_status'],
    denyTools: [],
    maxParallelCalls: 1,
    timeoutOverrides: { military_status: 5 },
  }
  const host = {
    tenantId: 'tenant-test',
    database,
    config: { tenantId: 'tenant-test' },
    isMilitaryAgent(candidate: unknown) { return candidate === agent },
    async identityFor() { return identity },
    application: {
      production: testProductionPlane('tenant-test'),
      oversight: { requireAdmission() {} },
      policies: {
        async toolProfile() { return profile },
        async resourceBudgetPolicy() {
          return {
            policyId: 'budget-default',
            revision: 1,
            limits: {
              wallClockSeconds: 3_600,
              toolCalls: 100,
              storageBytes: 1_000_000,
            },
          }
        },
      },
      authorization: {
        async resolve() { return {} },
        async authorize() { return { allowed: true } },
      },
      runtime: { async missionForSession() { return null } },
      resourceBudgets: {
        async reserve(value: Record<string, unknown>) {
          reservations.set(String(value.reservationId), value)
          return value
        },
        async getReservation(id: string) {
          const value = reservations.get(id)
          if (value === undefined) throw new Error(`unknown reservation ${id}`)
          return value
        },
        async settle(value: Record<string, unknown>) {
          const current = reservations.get(String(value.reservationId))
          assert.ok(current)
          reservations.set(String(value.reservationId), { ...current, state: 'SETTLED' })
        },
      },
      observedEvidence: {
        async toolCalls() { return [] },
        async recordToolCall(value: unknown) { evidence.push(value) },
      },
      executionBindings: { async forAgent() { return null } },
    },
  } as unknown as MilitaryHostRuntime
  const ctx = {
    on(name: string, handler: Handler) { handlers.set(name, handler) },
  } as unknown as Context
  const state = createAgentPlaneState()
  registerToolPipeline(ctx, host, state)
  const pre = requiredHandler(handlers, 'tools/pre-execute')
  const around = requiredHandler(handlers, 'tools/execute')
  const post = requiredHandler(handlers, 'tools/post-execute')

  const first = execution(agent, 'parallel-1', 'military_status')
  assert.equal((await pre(first, async () => ({ kind: 'allow' })) as { kind: string }).kind, 'allow')
  const parallel = execution(agent, 'parallel-2', 'military_status')
  const parallelDenied = await pre(parallel, async () => ({ kind: 'allow' })) as {
    readonly kind: string
    readonly reason: string
  }
  assert.equal(parallelDenied.kind, 'deny')
  assert.equal(JSON.parse(parallelDenied.reason).error.code, 'TOOL_PARALLEL_LIMIT')

  const timeout = await around(first, async () => await new Promise<ToolExecutionResult>((resolve) => {
    ;(first.signal as AbortSignal).addEventListener('abort', () => resolve({
      isError: true,
      error: { message: 'aborted by signal' },
      content: [],
    } as ToolExecutionResult), { once: true })
  })) as ToolExecutionResult
  assert.equal(timeout.isError, true)
  assert.equal((timeout.error?.info as { code?: string } | undefined)?.code, 'MILITARY_TOOL_TIMEOUT')
  const timeoutFailure = JSON.parse(
    (timeout.content[0] as { readonly text: string }).text,
  ) as {
    readonly error: {
      readonly nextTool: string
      readonly correctedShape: { readonly tool: string }
    }
  }
  assert.equal(timeoutFailure.error.nextTool, 'military_status')
  assert.equal(timeoutFailure.error.correctedShape.tool, 'military_status')
  await post(first, timeout, async () => ({ kind: 'accept' }))

  const terminal = execution(agent, 'terminal-1', 'ask_user_question')
  assert.equal((await pre(terminal, async () => ({ kind: 'allow' })) as { kind: string }).kind, 'allow')
  await post(terminal, {
    isError: false,
    value: { dispatchAccepted: true },
    content: [],
  } as unknown as ToolExecutionResult, async () => ({ kind: 'accept' }))
  const afterTerminal = await pre(
    execution(agent, 'terminal-sibling', 'military_status'),
    async () => ({ kind: 'allow' }),
  ) as { readonly kind: string; readonly reason: string }
  assert.equal(afterTerminal.kind, 'deny')
  assert.equal(JSON.parse(afterTerminal.reason).error.code, 'TURN_ALREADY_CONCLUDED')

  agent.session.events = [{ type: 'step/start', data: { turn: 1, step: 2 } }]
  const invalid = execution(agent, 'invalid-1', 'military_status', { unexpected: true })
  await post(invalid, {
    isError: true,
    error: { message: 'INVALID_ARGUMENT: unexpected is not allowed' },
    content: [],
  } as unknown as ToolExecutionResult, async () => ({ kind: 'accept' }))
  const repeated = await pre(
    execution(agent, 'invalid-2', 'military_status', { unexpected: true }),
    async () => ({ kind: 'allow' }),
  ) as { readonly kind: string; readonly reason: string }
  assert.equal(repeated.kind, 'deny')
  const repeatedFailure = JSON.parse(repeated.reason).error
  assert.equal(repeatedFailure.code, 'REPEATED_INVALID_CALL')
  assert.equal(repeatedFailure.nextTool, 'military_status')
  assert.equal(repeatedFailure.correctedShape.tool, 'military_status')
  assert.ok(evidence.length >= 3)
})

function execution(
  agent: unknown,
  callId: string,
  name: string,
  args: Record<string, unknown> = {},
): ToolExecution {
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  } as unknown as ToolExecution
}

function requiredHandler(handlers: Map<string, Handler>, name: string): Handler {
  const handler = handlers.get(name)
  if (handler === undefined) throw new Error(`missing handler ${name}`)
  return handler
}
