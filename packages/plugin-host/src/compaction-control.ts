import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-token-meter'
import {
  MilitaryError,
  isoNow,
  type AgentContextPolicy,
  type AgentIdentity,
  type CompactionAttempt,
  type SessionId,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'

/** Apply the per-turn RC.2 pressure threshold and persist every compaction outcome. */
export async function compactAtThreshold(
  ctx: Context,
  host: MilitaryHostRuntime,
  agent: Agent,
  identity: AgentIdentity,
  turn: number,
  signal: AbortSignal,
  attempted: Set<string>,
): Promise<void> {
  const key = `${String(agent.id)}:${turn}`
  if (attempted.has(key)) return
  const policy = await contextPolicy(host, identity)
  const measured = ctx.tokenMeter.measure(agent.session).totalTokens
  const meterTokens = Math.max(
    0,
    Math.floor(measured ?? estimateFallback(agent)),
  )
  const thresholdTokens = Math.floor(
    policy.contextBudgetTokens * policy.compactionTriggerPercent / 100,
  )
  if (meterTokens < thresholdTokens) return
  attempted.add(key)
  const rootSessionId = await rootSession(host, identity.sessionId)
  const missionId = await host.application.runtime.missionForSession(rootSessionId)
  const route = await executionModel(host, identity)
  const base: CompactionAttempt = {
    schemaVersion: '1.0.0',
    attemptId: crypto.randomUUID(),
    agent: identity,
    rootSessionId: String(rootSessionId),
    ...(identity.templateId === undefined ? {} : { templateId: String(identity.templateId) }),
    ...(identity.templateRevision === undefined
      ? {}
      : { templateRevision: Number(identity.templateRevision) }),
    pressureGeneration: turn,
    contextBudgetTokens: policy.contextBudgetTokens,
    thresholdTokens,
    meterTokens,
    trigger: 'PRESSURE',
    safeBoundary: {
      toolPairsBalanced: true,
      candidateTransactionIdle: true,
      gitTransactionIdle: true,
      freezeStateStable: true,
    },
    outcome: 'PENDING',
    createdAt: isoNow(),
  }
  await host.application.compactionAttempts.require(base)
  if (missionId !== null) {
    await host.application.runtime.recordEvent({
      missionId,
      actor: identity,
      type: 'context/compaction-attempted',
      payload: {
        attemptId: base.attemptId,
        agentId: String(identity.agentId),
        trigger: base.trigger,
        provider: route.provider,
        model: route.model,
      },
      idempotencyKey: `context-compaction-attempted:${base.attemptId}`,
    })
  }

  let deferredError: unknown
  try {
    const result = await ctx.compaction.compactIfNeeded(agent, 'pressure', signal)
    const outcome = result === null ? 'NO_SAFE_RANGE' as const : 'SUCCEEDED' as const
    await host.application.compactionAttempts.complete({
      ...base,
      outcome,
      ...(result === null ? {} : { dshCompactionId: String(result.compactionId) }),
      completedAt: isoNow(),
    })
    if (missionId !== null) {
      await host.application.runtime.recordEvent({
        missionId,
        actor: identity,
        type: 'context/compaction-completed',
        payload: { attemptId: base.attemptId, outcome },
        idempotencyKey: `context-compaction-completed:${base.attemptId}`,
      })
    }
    if (result === null && policy.onCompactionFailure === 'PAUSE_AND_ESCALATE') {
      deferredError = new MilitaryError(
        'COMPACTION_ATTEMPT_FAILED',
        'no safe compaction range',
      )
    }
  } catch (error) {
    const outcome = signal.aborted ? 'CANCELLED' as const : 'FAILED' as const
    await host.application.compactionAttempts.complete({
      ...base,
      outcome,
      errorCode: error instanceof MilitaryError
        ? error.failure.code
        : 'COMPACTION_ATTEMPT_FAILED',
      completedAt: isoNow(),
    }).catch(() => undefined)
    if (missionId !== null) {
      await host.application.runtime.recordEvent({
        missionId,
        actor: identity,
        type: 'context/compaction-completed',
        payload: {
          attemptId: base.attemptId,
          outcome,
          errorCode: error instanceof MilitaryError
            ? error.failure.code
            : 'COMPACTION_ATTEMPT_FAILED',
        },
        idempotencyKey: `context-compaction-completed:${base.attemptId}`,
      }).catch(() => undefined)
    }
    if (policy.onCompactionFailure === 'PAUSE_AND_ESCALATE') throw error
  }
  if (deferredError !== undefined) throw deferredError
}

export async function rootSession(
  host: MilitaryHostRuntime,
  sessionId: SessionId,
): Promise<SessionId> {
  let binding = await host.application.sessionGate.requireMilitarySession(sessionId)
  while (binding.parentSessionId !== undefined) {
    binding = await host.application.sessionGate.requireMilitarySession(binding.parentSessionId)
  }
  return binding.sessionId
}

async function contextPolicy(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
): Promise<AgentContextPolicy> {
  if (identity.role === 'general') {
    const policy = await host.application.generalRouting.policy()
    const selected = host.application.generalRouting.current(identity.sessionId)
    if (selected === undefined) return policy.contextPolicy
    try {
      const capability = await host.application.policies.modelCapability(
        selected.provider,
        selected.model,
      )
      const contextBudgetTokens = Math.min(
        policy.contextPolicy.contextBudgetTokens,
        capability.contextWindowTokens,
      )
      return {
        ...policy.contextPolicy,
        contextBudgetTokens,
        retainedTailTokens: Math.min(
          policy.contextPolicy.retainedTailTokens,
          Math.max(0, contextBudgetTokens - 1),
        ),
      }
    } catch {
      return policy.contextPolicy
    }
  }
  const binding = await host.application.executionBindings.forAgent(
    String(identity.agentId),
    identity.generation,
  )
  if (binding === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
  return binding.contextPolicy
}

async function executionModel(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
): Promise<{ readonly provider: string; readonly model: string }> {
  if (identity.role === 'general') {
    const policy = await host.application.generalRouting.policy()
    const selected = host.application.generalRouting.current(identity.sessionId)
    return selected === undefined
      ? { provider: policy.defaultModel.provider, model: policy.defaultModel.model }
      : { provider: selected.provider, model: selected.model }
  }
  const binding = await host.application.executionBindings.forAgent(
    String(identity.agentId),
    identity.generation,
  )
  if (binding === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
  return { provider: binding.provider, model: binding.model }
}

function estimateFallback(agent: Agent): number {
  return agent.session.events.reduce(
    (sum, event) => sum + JSON.stringify(event).length / 3.5,
    0,
  )
}
