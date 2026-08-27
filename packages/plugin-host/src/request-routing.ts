import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'
import { modelAttemptKey, type AgentPlaneState } from './agent-plane-state.js'
import {
  reserveModelRequestBudget,
  settleModelRequestBudget,
} from './model-budget.js'
import { recordRoleRevisionUse } from './role-usage.js'
import { resolveDshReasoningEffort } from './dsh-call-controls.js'

const COMPILED_GENERAL_PRESET = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'high',
})

/** Register General/department model routing and durable request-budget settlement. */
export function registerRequestRouting(
  ctx: Context,
  host: MilitaryHostRuntime,
  state: AgentPlaneState,
): void {
  ctx.on('agent/request', async (
    payload: { readonly agent: Agent; readonly turn: number; readonly step: number; readonly signal: AbortSignal },
    next: () => Promise<LlmCallConfig>,
  ): Promise<LlmCallConfig> => {
    const base = await next()
    if (!host.isMilitaryAgent(payload.agent)) return base
    const identity = await host.identityFor(payload.agent)
    host.application.oversight.requireAdmission(identity)

    let binding: AgentExecutionBinding | null = null
    let routed: LlmCallConfig
    if (identity.role !== 'general') {
      binding = await host.application.executionBindings.forAgent(
        String(identity.agentId),
        identity.generation,
      )
      if (binding === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
      const template = await host.application.templates.get(
        binding.agent.templateId!,
        binding.agent.templateRevision,
      )
      const taskMaxOutputTokens = binding.workspace === undefined
        ? template.modelPolicy.maxOutputTokens
        : (await host.application.runtime.getTask(
            brand<string, 'TaskId'>(binding.workspace.taskId),
          )).budget.maxOutputTokens ?? template.modelPolicy.maxOutputTokens
      const capability = await host.application.policies.modelCapability(
        binding.provider,
        binding.model,
      )
      const reasoning = await resolveDshReasoningEffort({
        ctx,
        provider: binding.provider,
        model: binding.model,
        requested: binding.reasoningEffort,
        signal: payload.signal,
      })
      const { reasoningEffort: _inheritedReasoning, ...baseWithoutReasoning } = base
      routed = Object.freeze({
        ...baseWithoutReasoning,
        provider: binding.provider,
        model: binding.model,
        ...(reasoning.effort === undefined
          ? {}
          : { reasoningEffort: reasoning.effort }),
        maxTokens: Math.min(
          template.modelPolicy.maxOutputTokens,
          taskMaxOutputTokens,
          capability.maxOutputTokens,
          capability.contextWindowTokens,
        ),
      })
    } else {
      const policy = await host.application.generalRouting.policy()
      const hasPriorRequest = payload.agent.session.events.some(event => event.type === 'request/header')
      const provider = base.provider ?? policy.defaultModel.provider
      const model = base.model ?? policy.defaultModel.model
      const requestedReasoningEffort = base.reasoningEffort === undefined
        ? policy.defaultModel.reasoningEffort
        : String(base.reasoningEffort)
      const reasoningEffort = requestedReasoningEffort === 'max'
        ? 'max'
        : 'high'
      const isPresetDefault = !hasPriorRequest
        && provider === COMPILED_GENERAL_PRESET.provider
        && model === COMPILED_GENERAL_PRESET.model
        && reasoningEffort === COMPILED_GENERAL_PRESET.reasoningEffort
      // DSH's live adapter catalog is the availability authority. A model
      // selected in DSH must not be rejected merely because Military has no
      // historical benchmark/profile for that provider route yet.
      const capability = await host.ensureDshModelCapability(
        provider,
        model,
        payload.signal,
      )
      const receipt = isPresetDefault
        ? await host.application.generalRouting.applyPresetDefault(identity.sessionId)
        : await host.application.generalRouting.validateUserSelection({
            sessionId: identity.sessionId,
            provider,
            model,
            reasoningEffort,
            selectedBy: hasPriorRequest
              ? 'dsh-session-model-selector-or-resume'
              : 'dsh-session-model-selector-before-first-request',
          })
      const routeKey = `${receipt.provider}/${receipt.model}/${receipt.reasoningEffort}`
      if (state.generalRoutes.get(String(payload.agent.id)) !== routeKey) {
        state.generalRoutes.set(String(payload.agent.id), routeKey)
        ctx.logger.debug(
          `dsh-military General model route ${String(payload.agent.id)} -> ${routeKey}`,
        )
      }
      const reasoning = await resolveDshReasoningEffort({
        ctx,
        provider: receipt.provider,
        model: receipt.model,
        requested: requestedReasoningEffort,
        signal: payload.signal,
      })
      const { reasoningEffort: _inheritedReasoning, ...baseWithoutReasoning } = base
      routed = Object.freeze({
        ...baseWithoutReasoning,
        provider: receipt.provider,
        model: receipt.model,
        ...(reasoning.effort === undefined
          ? {}
          : { reasoningEffort: reasoning.effort }),
        maxTokens: isPresetDefault
          ? Math.min(
              policy.defaultModel.maxOutputTokens,
              capability.maxOutputTokens,
              capability.contextWindowTokens,
            )
          : Math.min(
              base.maxTokens ?? policy.defaultModel.maxOutputTokens,
              capability.maxOutputTokens,
              capability.contextWindowTokens,
            ),
      })
    }
    await reserveModelRequestBudget(
      host,
      identity,
      binding,
      payload.turn,
      payload.step,
      routed,
    )
    try {
      recordRoleRevisionUse({
        ctx,
        host,
        identity,
        binding,
        turn: payload.turn,
        step: payload.step,
        provider: String(routed.provider),
        model: String(routed.model),
        reasoningEffort: String(routed.reasoningEffort ?? 'unknown'),
      })
    } catch (error) {
      ctx.logger.warn(
        `dsh-military role revision usage audit unavailable for ${String(identity.sessionId)}`,
        error,
      )
    }
    return routed
  })

  ctx.on('agent/request-error', async (payload, next) => {
    if (!host.isMilitaryAgent(payload.agent)) return await next()
    const identity = await host.identityFor(payload.agent)
    const key = modelAttemptKey(String(payload.agent.id), payload.turn, payload.step)
    const attempts = (state.modelFailureAttempts.get(key) ?? 0) + 1
    state.modelFailureAttempts.set(key, attempts)
    const action = await next()
    if (action?.kind !== 'retry') {
      await settleModelRequestBudget(host, identity, {
        turn: payload.turn,
        step: payload.step,
        attempts,
        cancelled: payload.signal.aborted,
      })
      state.modelFailureAttempts.delete(key)
    }
    return action
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const agent = ctx.agents?.get(session.id)
    if (agent === undefined || !host.isMilitaryAgent(agent)) return
    if (event.type === 'turn/end'
      && event.data.reason.kind === 'aborted'
      && event.data.reason.reason.kind === 'user') {
      if (agent.session.header.parentSession !== undefined) {
        state.userCancelledChildren.add(String(agent.id))
      }
      void host.abortMilitaryAgent(agent, 'USER_CANCELLED').catch(error => {
        ctx.logger.error(
          `dsh-military user-abort convergence failed for ${String(session.id)}`,
          error,
        )
      })
      return
    }
    if (event.type !== 'assistant/message') return
    const key = modelAttemptKey(String(agent.id), event.data.turn, event.data.step)
    const attempts = (state.modelFailureAttempts.get(key) ?? 0) + 1
    state.modelFailureAttempts.delete(key)
    void (async () => {
      const identity = await host.identityFor(agent)
      await settleModelRequestBudget(host, identity, {
        turn: event.data.turn,
        step: event.data.step,
        attempts,
        ...(event.data.usage === undefined ? {} : { usage: event.data.usage }),
        completedAt: brand<string, 'IsoDateTime'>(new Date(event.time).toISOString()),
        cancelled: event.data.interrupted === true,
      })
    })().catch(error => {
      ctx.logger.error(
        `dsh-military model budget settlement failed for ${String(session.id)}:${event.data.turn}:${event.data.step}`,
        error,
      )
    })
  })
}
