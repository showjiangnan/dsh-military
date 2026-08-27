import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-military-general-model-default'
export const inject = ['agentPresets'] as const

export interface Config {
  readonly requiredPresetId: 'military'
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: Exclude<ReasoningEffortId, 'off'>
  readonly maxTokens: number
}

export const Config = z.object({
  requiredPresetId: z.const('military'),
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.union(['low', 'high', 'max'] as const).default('high'),
  maxTokens: z.number().min(1).step(1).default(65_536),
})

/** Supply the preset-owned General route until the user explicitly changes the session model. */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/request', async (
    payload: { readonly agent: Agent },
    next: () => Promise<LlmCallConfig>,
  ): Promise<LlmCallConfig> => {
    const resolved = await next()
    const agent = payload.agent
    if (agent.session.header.parentSession !== undefined) return resolved
    if (ctx.agentPresets?.composedPreset(agent.ctx) !== config.requiredPresetId) return resolved
    if (agent.session.events.some(event => event.type === 'request/header')) return resolved
    const userChangedBeforeFirstRequest = (resolved.provider !== undefined && resolved.provider !== agent.options.provider)
      || (resolved.model !== undefined && resolved.model !== agent.options.model)
    if (userChangedBeforeFirstRequest) return resolved
    return Object.freeze({
      ...resolved,
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      maxTokens: config.maxTokens,
    })
  })
}
