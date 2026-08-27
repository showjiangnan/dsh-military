import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MilitaryError } from '@dsh-military/contracts'
import { reportTerminalOutcome } from '@dsh-military/tools'
import { identity } from './helpers.js'

test('a department terminal action cannot conclude before its parent receipt is durable', async () => {
  const child = {} as Agent
  const worker = identity('worker', 'terminal-child')
  let attempts = 0
  const ctx = {
    militaryHost: {
      identities: {
        require(candidate: Agent) {
          assert.equal(candidate, child)
          return worker
        },
      },
      departmentAgents: {
        async report() {
          attempts += 1
          throw new Error('injected parent delivery outage')
        },
      },
    },
  } as unknown as Context

  await assert.rejects(
    reportTerminalOutcome(ctx, child, {
      kind: 'CANDIDATE_SUBMITTED',
      idempotencyKey: 'terminal:task-1@1',
      summary: 'Candidate is durable.',
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof MilitaryError
      && error.failure.code === 'PERSISTENCE_FAILED'
      && error.failure.retryable
      && error.failure.details?.idempotencyKey === 'terminal:task-1@1',
  )
  assert.equal(attempts, 1)
})

test('a root General terminal action has no parent receipt dependency', async () => {
  const general = {} as Agent
  const ctx = {
    militaryHost: {
      identities: { require: () => identity('general', 'terminal-general') },
      departmentAgents: {
        async report() {
          throw new Error('must not be called')
        },
      },
    },
  } as unknown as Context

  assert.deepEqual(await reportTerminalOutcome(ctx, general, {
    kind: 'MISSION_COMPLETED',
    idempotencyKey: 'terminal:mission-1',
    summary: 'Mission is complete.',
    signal: new AbortController().signal,
  }), { state: 'NOT_APPLICABLE' })
})
