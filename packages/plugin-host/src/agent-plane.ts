import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-token-meter'
import { registerAgentLifecycle } from './agent-lifecycle.js'
import { createAgentPlaneState } from './agent-plane-state.js'
import { registerCompletionInterlock } from './completion-interlock.js'
import { registerContextAudit } from './context-audit.js'
import { registerGeneralOutputGuard } from './general-output-guard.js'
import { registerRequestRouting } from './request-routing.js'
import { registerToolPipeline } from './tool-pipeline.js'

export const name = 'dsh-military-agent-plane'
export const inject = [
  'militaryHost',
  'agentPresets',
  'agents',
  'tools',
  'llm',
  'systemPrompt',
  'compaction',
  'tokenMeter',
] as const

/**
 * Agent-plane composition root. Each listener family owns one policy boundary;
 * this file intentionally contains no handler logic.
 */
export function apply(ctx: Context): void {
  const host = ctx.militaryHost
  const state = createAgentPlaneState()
  registerAgentLifecycle(ctx, host, state)
  registerContextAudit(ctx, host, state)
  registerRequestRouting(ctx, host, state)
  registerGeneralOutputGuard(ctx, state)
  registerToolPipeline(ctx, host, state)
  registerCompletionInterlock(ctx, host, state)
}
