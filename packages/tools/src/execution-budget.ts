import {
  MilitaryError,
  brand,
  isoNow,
  type AgentIdentity,
  type MissionId,
  type ResourceBudgetReservation,
  type ResourceCounters,
  type TaskId,
} from '@dsh-military/contracts'
import { sha256, stableJson, zeroCounters } from '@dsh-military/core'
import type {
  MilitaryToolHostRuntime as MilitaryHostRuntime,
} from '@dsh-military/runtime'

export type CountedExecutionResource = 'radioRounds' | 'reworkAttempts'

export function countedExecutionReservationId(input: {
  readonly identity: AgentIdentity
  readonly missionId: MissionId
  readonly taskId?: TaskId
  readonly counter: CountedExecutionResource
  readonly idempotencyKey: string
}): string {
  return `execution-budget-${sha256(stableJson({
    agentId: String(input.identity.agentId),
    generation: input.identity.generation,
    sessionId: String(input.identity.sessionId),
    missionId: String(input.missionId),
    taskId: input.taskId === undefined ? null : String(input.taskId),
    counter: input.counter,
    idempotencyKey: input.idempotencyKey,
  })).slice(0, 32)}`
}

/**
 * Reserve a bounded workflow counter before the authoritative mutation, then
 * settle from that mutation's result. When called inside a SQLite Mission unit
 * of work, reservation, domain state, events, receipt and settlement share the
 * same commit boundary.
 */
export async function withCountedExecutionBudget<T>(
  host: MilitaryHostRuntime,
  input: {
    readonly identity: AgentIdentity
    readonly missionId: MissionId
    readonly taskId?: TaskId
    readonly counter: CountedExecutionResource
    readonly idempotencyKey: string
    readonly operation: () => Promise<T>
    readonly actual: (value: T) => 0 | 1
  },
): Promise<T> {
  const binding = input.identity.role === 'general'
    ? null
    : await host.application.executionBindings.forAgent(
        String(input.identity.agentId),
        input.identity.generation,
      )
  if (input.identity.role !== 'general' && binding === null) {
    throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
  }
  const policy = binding === null
    ? await host.application.policies.resourceBudgetPolicy('budget-default')
    : await host.application.policies.resourceBudgetPolicy(
        binding.resourceBudgetPolicy.id,
        Number(binding.resourceBudgetPolicy.revision),
      )
  const reservationId = countedExecutionReservationId(input)
  const reservedAt = isoNow()
  const requested: ResourceCounters = {
    ...zeroCounters(),
    [input.counter]: 1,
  }
  const reservation = await host.application.resourceBudgets.reserve({
    schemaVersion: '1.0.0',
    reservationId,
    tenantId: host.tenantId,
    scopeType: input.taskId === undefined ? 'MISSION' : 'TASK',
    scopeId: String(input.taskId ?? input.missionId),
    policyId: policy.policyId,
    policyRevision: policy.revision,
    ownerAgent: input.identity,
    requested,
    granted: zeroCounters(),
    state: 'RESERVED',
    idempotencyKey: `${reservationId}:reserve`,
    reservedAt,
    expiresAt: brand<string, 'IsoDateTime'>(
      new Date(Date.parse(reservedAt) + 30 * 60 * 1000).toISOString(),
    ),
  })
  if (reservation.state !== 'RESERVED') {
    throw new MilitaryError(
      'BUDGET_RESERVATION_REQUIRED',
      `${input.counter} reservation ${reservationId} is ${reservation.state}`,
    )
  }

  try {
    const value = await input.operation()
    await settle(host, reservation, input.counter, input.actual(value))
    return value
  } catch (error) {
    await host.application.resourceBudgets.revoke(
      reservationId,
      `${input.counter.toUpperCase()}_OPERATION_FAILED`,
    ).catch(() => undefined)
    throw error
  }
}

async function settle(
  host: MilitaryHostRuntime,
  reservation: ResourceBudgetReservation,
  counter: CountedExecutionResource,
  amount: 0 | 1,
): Promise<void> {
  const actual: ResourceCounters = {
    ...zeroCounters(),
    [counter]: amount,
  }
  const completedAt = isoNow()
  await host.application.resourceBudgets.settle({
    schemaVersion: '1.0.0',
    receiptId: `${reservation.reservationId}:usage`,
    reservationId: reservation.reservationId,
    scopeType: reservation.scopeType,
    scopeId: reservation.scopeId,
    actual,
    overages: zeroCounters(),
    disposition: 'SETTLED',
    sourceEventIds: [`workflow:${counter}:${reservation.idempotencyKey}`],
    idempotencyKey: `${reservation.reservationId}:settle`,
    startedAt: reservation.reservedAt,
    completedAt,
  })
}
