import assert from 'node:assert/strict'
import test from 'node:test'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import {
  departmentWallClockExhaustion,
  effectiveMaximumSteps,
} from '../packages/plugin-host/src/context-audit.js'
import { identity, task } from './helpers.js'

test('the model loop uses the strictest General, strategy, and Task step fence', async () => {
  const department = identity('worker')
  const order = {
    ...task(undefined, 'step-fenced-task', ['src']),
    budget: {
      modelSteps: 4,
      toolCalls: 32,
      guidanceRequests: 2,
      wallClockSeconds: 300,
    },
  }
  const host = {
    application: {
      generalRouting: {
        async policy() { return { maximumSteps: 16 } },
      },
      executionBindings: {
        async forAgent() {
          return {
            executionStrategy: { maximumSteps: 8 },
            workspace: {
              taskId: String(order.taskId),
            },
          }
        },
      },
      runtime: {
        async getTask() { return order },
      },
    },
  } as unknown as MilitaryHostRuntime
  assert.equal(await effectiveMaximumSteps(host, identity('general')), 16)
  assert.equal(await effectiveMaximumSteps(host, department), 4)
})

test('department model steps stop at the durable child wall-clock deadline', async () => {
  const department = identity('worker', 'wall-clock-fenced-worker')
  const expiresAt = '2026-08-25T01:02:03.000Z'
  const host = {
    application: {
      executionBindings: {
        async forAgent() {
          return { concurrencyReservationId: 'wall-clock-reservation' }
        },
      },
      resourceBudgets: {
        async getReservation() {
          return { state: 'RESERVED', expiresAt }
        },
      },
    },
  } as unknown as MilitaryHostRuntime
  assert.equal(
    await departmentWallClockExhaustion(
      host,
      department,
      Date.parse('2026-08-25T01:02:02.999Z'),
    ),
    null,
  )
  assert.equal(
    await departmentWallClockExhaustion(
      host,
      department,
      Date.parse(expiresAt),
    ),
    `WALL_CLOCK_BUDGET_EXHAUSTED:${expiresAt}`,
  )
})
