import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../packages/plugin-host/src/agent-plane.js'
import { createAgentPlaneState } from '../packages/plugin-host/src/agent-plane-state.js'
import { registerToolPipeline } from '../packages/plugin-host/src/tool-pipeline.js'

type Handler = (...args: unknown[]) => unknown

test('split Agent Plane registers each RC.2 boundary once and preserves completion interlock behavior', async () => {
  const handlers = new Map<string, Handler[]>()
  const steered: unknown[] = []
  const cancelled: unknown[] = []
  const frozen: unknown[] = []
  const aborted: unknown[] = []
  const agent = {
    id: 'worker-agent',
    session: {
      header: { parentSession: 'general-session' },
      events: [{ type: 'turn/start', data: { turn: 1 } }],
    },
    steer(message: unknown) { steered.push(message) },
    cancel(reason: unknown) { cancelled.push(reason) },
  }
  const identity = {
    agentId: 'worker-agent',
    sessionId: 'worker-session',
    role: 'worker',
    displayName: 'Worker',
    generation: 1,
  }
  const host = {
    isMilitaryAgent(candidate: unknown) { return candidate === agent },
    async identityFor() { return identity },
    oversightSettings() {
      return {
        completionInterlockEnabled: true,
        freezeOnSecondMissingSubmission: true,
        requireObservedToolEvidence: true,
        maximumNoProgressTurns: 3,
      }
    },
    async abortMilitaryAgent(_agent: unknown, reason: string) { aborted.push(reason) },
    application: {
      oversight: {
        freeze(input: unknown) { frozen.push(input) },
      },
    },
  }
  const ctx = {
    militaryHost: host,
    on(name: string, handler: Handler) {
      const entries = handlers.get(name) ?? []
      entries.push(handler)
      handlers.set(name, entries)
    },
  }

  apply(ctx as unknown as Parameters<typeof apply>[0])
  assert.deepEqual([...handlers.keys()].sort(), [
    'agent/disposed',
    'agent/pre-step',
    'agent/request',
    'agent/request-error',
    'agent/session-start',
    'agent/turn-stopping',
    'llm/stream',
    'session/event',
    'tools/execute',
    'tools/post-execute',
    'tools/pre-execute',
    'tools/result',
  ])
  for (const entries of handlers.values()) assert.equal(entries.length, 1)

  const turnStopping = requiredHandler(handlers, 'agent/turn-stopping')
  await turnStopping({ agent, turn: 1 })
  assert.equal(steered.length, 1)
  assert.equal(cancelled.length, 0)
  await turnStopping({ agent, turn: 1 })
  assert.equal(steered.length, 2)
  assert.equal(frozen.length, 0)
  assert.equal(cancelled.length, 0)
  await turnStopping({ agent, turn: 1 })
  assert.equal(frozen.length, 1)
  assert.equal(cancelled.length, 1)
  assert.deepEqual(aborted, ['NO_PROGRESS_LIMIT'])

  agent.session.events = [{ type: 'turn/start', data: { turn: 2 } }]
  const toolResult = requiredHandler(handlers, 'tools/result')
  toolResult({
    agent,
    name: 'military_submit_candidate',
    callId: 'call-1',
    rootCallId: 'call-1',
    arguments: {},
  }, { isError: false, value: {}, content: [] })
  await turnStopping({ agent, turn: 2 })
  assert.equal(steered.length, 2)
  assert.equal(cancelled.length, 1)

  const root = await readFile('packages/plugin-host/src/agent-plane.ts', 'utf8')
  for (const moduleName of [
    'agent-lifecycle',
    'context-audit',
    'general-output-guard',
    'request-routing',
    'tool-pipeline',
    'completion-interlock',
  ]) {
    assert.match(root, new RegExp(`register${moduleName
      .split('-')
      .map(value => value[0]?.toUpperCase() + value.slice(1))
      .join('')}`, 'u'))
  }
  assert.equal(root.includes("ctx.on('"), false)
})

test('a successful General workflow tool resets the no-progress interlock counter', () => {
  const handlers = new Map<string, Handler[]>()
  const state = createAgentPlaneState()
  const agent = {
    id: 'general-agent',
    session: {
      events: [{ type: 'turn/start', data: { turn: 4 } }],
    },
  }
  const key = 'general-agent:4'
  state.interlockNoProgress.set(key, 2)
  const ctx = {
    on(name: string, handler: Handler) {
      const entries = handlers.get(name) ?? []
      entries.push(handler)
      handlers.set(name, entries)
    },
  }
  const host = {
    isMilitaryAgent(candidate: unknown) { return candidate === agent },
  }
  registerToolPipeline(
    ctx as never,
    host as never,
    state,
  )
  const result = requiredHandler(handlers, 'tools/result')
  result({
    agent,
    name: 'military_mission_start',
    callId: 'mission-start',
    rootCallId: 'mission-start',
    arguments: {},
  }, {
    isError: false,
    value: { missionId: 'mission-1' },
    content: [],
  })
  assert.equal(state.interlockNoProgress.has(key), false)
  assert.deepEqual(
    [...(state.generalSuccessfulToolsByTurn.get(key) ?? [])],
    ['military_mission_start'],
  )
})

function requiredHandler(handlers: Map<string, Handler[]>, name: string): Handler {
  const handler = handlers.get(name)?.[0]
  if (handler === undefined) throw new Error(`missing handler ${name}`)
  return handler
}
