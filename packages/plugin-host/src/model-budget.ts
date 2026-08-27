import type { LlmCallConfig, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  MilitaryError,
  brand,
  isoNow,
  type AgentExecutionBinding,
  type AgentIdentity,
  type ArtifactDispatchPolicyReceipt,
  type IsoDateTime,
  type ResourceBudgetReservation,
  type ResourceCounters,
} from '@dsh-military/contracts'
import { sha256, stableJson, zeroCounters } from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'

export function modelBudgetReservationId(
  identity: AgentIdentity,
  turn: number,
  step: number,
): string {
  return `model-budget-${sha256(stableJson({
    agentId: String(identity.agentId),
    generation: identity.generation,
    sessionId: String(identity.sessionId),
    turn,
    step,
  })).slice(0, 32)}`
}

/** Authorize and reserve one complete model-attempt group before provider dispatch. */
export async function reserveModelRequestBudget(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  binding: AgentExecutionBinding | null,
  turn: number,
  step: number,
  config: LlmCallConfig,
): Promise<ResourceBudgetReservation> {
  const provider = config.provider
  const model = config.model
  if (provider === undefined || model === undefined) {
    throw new Error('Military model route must resolve provider and model before budget admission')
  }
  const authorityContext = await host.application.authorization.resolve(
    String(identity.agentId),
    host.tenantId,
  )
  const classification = binding?.dataClassification ?? 'internal'
  const authority = await host.application.authorization.authorize({
    context: authorityContext,
    action: 'model.execute',
    resource: `${provider}/${model}`,
    classification,
  })
  const scope = await modelScope(host, identity, binding)
  const missionId = scope.scopeType === 'MISSION'
    ? scope.scopeId
    : binding?.missionId ?? `tenant:${host.tenantId}`
  const dispatchReceiptId = `model-dispatch-policy-${sha256(stableJson({
    agentId: String(identity.agentId),
    generation: identity.generation,
    turn,
    step,
    provider,
    model,
  })).slice(0, 40)}`
  const policyRecords = new SqliteStateRecords(host.database, host.tenantId)
  const existingDispatchReceipt =
    policyRecords.readSync<ArtifactDispatchPolicyReceipt>(
      'model-dispatch-policy-receipt',
      dispatchReceiptId,
    )
  const dispatchObservedAt = isoNow()
  const dispatchReceipt: ArtifactDispatchPolicyReceipt =
    existingDispatchReceipt ?? {
    schemaVersion: '1.0.0',
    receiptId: dispatchReceiptId,
    referenceIds: [],
    tenantId: host.tenantId,
    missionId,
    ...(binding?.workspace === undefined
      ? {}
      : { taskId: binding.workspace.taskId }),
    provider,
    model,
    dispatch: {
      agentId: String(identity.agentId),
      agentGeneration: identity.generation,
      turn,
      step,
    },
    // DSH RC.2 does not expose an authoritative price/version contract.
    // Persist that absence at dispatch time rather than applying a mutable
    // UI/catalog price to historical usage after the fact.
    pricingSnapshot: {
      status: 'UNAVAILABLE',
      currency: 'USD',
      version: 'dsh-rc2-provider-pricing-unavailable@1',
      observedAt: dispatchObservedAt,
    },
    classification,
    residencyPolicyRef: binding?.dataResidencyPolicy.id
      ?? 'dsh-local-user-provider-policy@1',
    redactionPolicyRef: binding?.redactionPolicy.id
      ?? 'redaction-default@1',
    policyRevision: Number(
      binding?.dataResidencyPolicy.revision
      ?? binding?.redactionPolicy.revision
      ?? 0,
    ),
    disposition: authority.allowed ? 'ALLOWED' : 'DENIED',
    evidenceRefs: authority.receiptRef === undefined
      ? []
      : [authority.receiptRef],
    createdAt: dispatchObservedAt,
  }
  if (existingDispatchReceipt === null) {
    policyRecords.putSync(
      'model-dispatch-policy-receipt',
      dispatchReceipt.receiptId,
      dispatchReceipt,
      { createOnly: true },
    )
  } else if (
    existingDispatchReceipt.provider !== provider
    || existingDispatchReceipt.model !== model
    || (
      existingDispatchReceipt.dispatch !== undefined
      && (
        existingDispatchReceipt.dispatch.agentId !== String(identity.agentId)
        || existingDispatchReceipt.dispatch.agentGeneration !== identity.generation
        || existingDispatchReceipt.dispatch.turn !== turn
        || existingDispatchReceipt.dispatch.step !== step
      )
    )
    || existingDispatchReceipt.disposition
      !== (authority.allowed ? 'ALLOWED' : 'DENIED')
  ) {
    throw new MilitaryError(
      'IDEMPOTENCY_CONFLICT',
      'model dispatch policy receipt changed for the same step',
    )
  }
  if (!authority.allowed) {
    throw new Error(`model authority denied: ${authority.reason ?? 'no matching authority'}`)
  }
  const policy = binding === null
    ? await host.application.policies.resourceBudgetPolicy('budget-default')
    : await host.application.policies.resourceBudgetPolicy(
        binding.resourceBudgetPolicy.id,
        Number(binding.resourceBudgetPolicy.revision),
      )
  const reservationId = modelBudgetReservationId(identity, turn, step)
  const reservedAt = isoNow()
  const requested: ResourceCounters = {
    ...zeroCounters(),
    modelRequests: Math.min(4, policy.limits.modelRequests),
    reasoningTokens: Math.min(
      Math.max(0, config.maxTokens ?? 0),
      policy.limits.reasoningTokens,
    ),
    wallClockSeconds: Math.max(
      1,
      Math.min(
        600,
        Math.floor(
          policy.limits.wallClockSeconds
            / Math.max(1, policy.limits.modelRequests),
        ),
      ),
    ),
  }
  const accepted = await host.application.resourceBudgets.reserve({
    schemaVersion: '1.0.0',
    reservationId,
    tenantId: host.tenantId,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    policyId: policy.policyId,
    policyRevision: policy.revision,
    ownerAgent: identity,
    requested,
    granted: zeroCounters(),
    state: 'RESERVED',
    idempotencyKey: `${reservationId}:reserve`,
    reservedAt,
    expiresAt: brand<string, 'IsoDateTime'>(
      new Date(Date.parse(reservedAt) + 60 * 60 * 1000).toISOString(),
    ),
  })
  if (accepted.state !== 'RESERVED') {
    throw new Error(`model budget reservation ${reservationId} is ${accepted.state}`)
  }
  return accepted
}

export async function settleModelRequestBudget(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  input: {
    readonly turn: number
    readonly step: number
    readonly attempts: number
    readonly usage?: TokenUsage
    readonly completedAt?: IsoDateTime
    readonly cancelled?: boolean
  },
): Promise<void> {
  const reservationId = modelBudgetReservationId(identity, input.turn, input.step)
  const reservation = await host.application.resourceBudgets.getReservation(reservationId)
  if (reservation.state === 'SETTLED') return
  if (reservation.state !== 'RESERVED') {
    throw new Error(`model budget reservation ${reservationId} is ${reservation.state}`)
  }
  const completedAt = input.completedAt ?? isoNow()
  const actual: ResourceCounters = {
    ...zeroCounters(),
    modelRequests: Math.max(1, input.attempts),
    reasoningTokens: Math.max(0, input.usage?.reasoningTokens ?? 0),
    wallClockSeconds: Math.max(
      0,
      Math.ceil((Date.parse(completedAt) - Date.parse(reservation.reservedAt)) / 1000),
    ),
  }
  const overages = subtractCounters(actual, reservation.granted)
  await host.application.resourceBudgets.settle({
    schemaVersion: '1.0.0',
    receiptId: `${reservationId}:usage`,
    reservationId,
    scopeType: reservation.scopeType,
    scopeId: reservation.scopeId,
    actual,
    overages,
    disposition: input.cancelled === true
      ? 'CANCELLED'
      : Object.values(overages).some(value => value > 0)
        ? 'OVER_BUDGET'
        : 'SETTLED',
    sourceEventIds: [
      `model:${String(identity.sessionId)}:${input.turn}:${input.step}`,
    ],
    idempotencyKey: `${reservationId}:settle`,
    startedAt: reservation.reservedAt,
    completedAt,
  })
}

/**
 * Recover the crash window between a durable RC.2 Session event and budget
 * settlement. Retry count is not part of the RC.2 Session contract, so a
 * recovered successful step conservatively settles the full reserved request
 * count; live settlement retains the exact observed retry count.
 */
export async function reconcileModelRequestBudgets(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  events: readonly SessionEvent[],
): Promise<void> {
  const steps = new Map<string, { turn: number; step: number }>()
  for (const event of events) {
    if (event.type !== 'step/start') continue
    steps.set(`${event.data.turn}:${event.data.step}`, {
      turn: event.data.turn,
      step: event.data.step,
    })
  }
  for (const step of steps.values()) {
    let reservation: ResourceBudgetReservation
    try {
      reservation = await host.application.resourceBudgets.getReservation(
        modelBudgetReservationId(identity, step.turn, step.step),
      )
    } catch (error) {
      if (error instanceof MilitaryError && error.failure.code === 'NOT_FOUND') continue
      throw error
    }
    if (reservation.state !== 'RESERVED') continue
    const assistant = events.find(event => event.type === 'assistant/message'
      && event.data.turn === step.turn
      && event.data.step === step.step)
    if (assistant !== undefined && assistant.type === 'assistant/message') {
      await settleModelRequestBudget(host, identity, {
        turn: step.turn,
        step: step.step,
        attempts: Math.max(1, reservation.granted.modelRequests),
        ...(assistant.data.usage === undefined ? {} : { usage: assistant.data.usage }),
        completedAt: brand<string, 'IsoDateTime'>(
          new Date(assistant.time).toISOString(),
        ),
        cancelled: assistant.data.interrupted === true,
      })
      continue
    }
    const terminal = events.find(event => (event.type === 'step/end'
      && event.data.turn === step.turn
      && event.data.step === step.step)
      || (event.type === 'turn/end' && event.data.turn === step.turn))
    if (terminal === undefined) continue
    await settleModelRequestBudget(host, identity, {
      turn: step.turn,
      step: step.step,
      attempts: Math.max(1, reservation.granted.modelRequests),
      completedAt: brand<string, 'IsoDateTime'>(
        new Date(terminal.time).toISOString(),
      ),
      cancelled: true,
    })
  }
}

async function modelScope(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  binding: AgentExecutionBinding | null,
): Promise<Pick<ResourceBudgetReservation, 'scopeType' | 'scopeId'>> {
  if (binding?.workspace !== undefined) {
    return { scopeType: 'TASK', scopeId: binding.workspace.taskId }
  }
  if (binding !== null) return { scopeType: 'MISSION', scopeId: binding.missionId }
  const missionId = await host.application.runtime.missionForSession(identity.sessionId)
  return missionId === null
    ? { scopeType: 'TENANT', scopeId: host.tenantId }
    : { scopeType: 'MISSION', scopeId: String(missionId) }
}

function subtractCounters(actual: ResourceCounters, granted: ResourceCounters): ResourceCounters {
  return Object.fromEntries(
    (Object.keys(actual) as (keyof ResourceCounters)[])
      .map(key => [key, Math.max(0, actual[key] - granted[key])]),
  ) as unknown as ResourceCounters
}
