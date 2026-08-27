import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId as DshSessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  type AgentExecutionBinding,
  type AgentIdentity,
} from '@dsh-military/contracts'
import {
  defineJsonTool,
  text,
  registerTools,
  requireCallingAgent,
  identityFor,
  requireRole,
  asInteger,
  asString,
  asStringArray,
  reportTerminalOutcome,
  runDurableTerminalMutation,
} from './common.js'

export function inspectorTools(ctx: Context): readonly ToolDefinition[] {
  return [
    defineJsonTool({
      name: 'military_inspect_agent', description: 'Read-only inspect a Military Agent tool evidence and current freeze state.',
      parameters: {
        agentId: { type: 'string', required: true },
        sessionId: { type: 'string', required: true },
        generation: { type: 'integer', required: true },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const caller = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, caller), ['inspector'])
        const { target, binding } = await resolveInspectionTarget(ctx.militaryHost, {
          agentId: args.agentId,
          sessionId: args.sessionId,
          generation: args.generation,
        })
        return { target, frozen: ctx.militaryHost.application.oversight.isFrozen(target), binding }
      },
    }),
    defineJsonTool({
      name: 'military_submit_inspection', description: 'Submit anomaly findings; deterministic Harness policy decides whether to freeze.',
      parameters: {
        targetAgentId: { type: 'string', required: true },
        targetSessionId: { type: 'string', required: true },
        generation: { type: 'integer', required: true },
        reasonCodes: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'Deterministic anomaly reason codes. Pass an empty array for NO_ACTION.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const caller = requireCallingAgent(exec.agent)
        const callerIdentity = identityFor(ctx, caller)
        requireRole(callerIdentity, ['inspector'])
        const { target } = await resolveInspectionTarget(ctx.militaryHost, {
          agentId: args.targetAgentId,
          sessionId: args.targetSessionId,
          generation: args.generation,
        })
        const reasons = asStringArray(args.reasonCodes, 'reasonCodes')
        const terminal = await runDurableTerminalMutation(ctx, {
          identity: callerIdentity,
          actionKey: `inspection:${String(target.agentId)}:${target.generation}:${reasons.join(',') || 'none'}`,
          draft: {
            targetAgentId: String(target.agentId),
            targetSessionId: String(target.sessionId),
            generation: target.generation,
            reasonCodes: reasons,
          },
          operation: async () => {
            if (reasons.length > 0) {
              await ctx.militaryHost.application.runtime.freezeAgent(target, reasons)
              const live = ctx.agents?.get(String(target.sessionId) as DshSessionId)
              live?.cancel({ kind: 'hook', reason: `dsh-military oversight: ${reasons.join(',')}` }, { keepInbox: true })
            }
            return { disposition: reasons.length > 0 ? 'FROZEN' as const : 'NO_ACTION' as const }
          },
        })
        const { disposition } = terminal.value
        const parentReport = await reportTerminalOutcome(ctx, caller, {
          kind: 'INSPECTION',
          idempotencyKey: `inspection-terminal:${String(target.agentId)}:${target.generation}:${reasons.join(',') || 'none'}`,
          summary: `Inspection completed with disposition ${disposition}.`,
          details: { targetAgentId: String(target.agentId), generation: target.generation, reasonCodes: reasons },
          priority: reasons.length > 0 ? 'critical' : 'ordinary',
          signal: exec.signal,
        })
        exec.concludeTurn()
        return {
          target,
          disposition,
          parentReport,
          replayedMutation: terminal.replayed,
          concludesTurn: true,
        }
      },
    }),
  ]
}

/** Resolve the exact immutable execution identity; never infer Session from Agent id. */
export async function resolveInspectionTarget(
  host: MilitaryHostRuntime,
  input: {
    readonly agentId: unknown
    readonly sessionId: unknown
    readonly generation: unknown
  },
): Promise<{ readonly target: AgentIdentity; readonly binding: AgentExecutionBinding }> {
  const agentId = asString(input.agentId, 'agentId')
  const sessionId = asString(input.sessionId, 'sessionId')
  const generation = asInteger(input.generation, 'generation')
  if (generation < 1) throw new MilitaryError('INVALID_ARGUMENT', 'generation must be positive')
  const binding = await host.application.executionBindings.forAgent(agentId, generation)
  if (binding === null) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISSING',
      `no immutable execution binding for ${agentId}@${generation}`,
    )
  }
  if (String(binding.agent.sessionId) !== sessionId
    || String(binding.agent.agentId) !== agentId
    || binding.agent.generation !== generation) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISMATCH',
      'inspection target does not match the immutable Agent/Session/generation tuple',
    )
  }
  return { target: binding.agent, binding }
}

export function apply(ctx: Context): void { registerTools(ctx, inspectorTools(ctx)) }
export const name = 'dsh-military-tools-inspector'
export const inject = ['tools', 'militaryHost', 'militaryAgentIdentities']
