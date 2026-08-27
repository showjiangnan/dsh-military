import type {} from '@dsh-military/plugin-host'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { brand } from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import {
  defineJsonTool,
  text,
  registerTools,
  requireCallingAgent,
  identityFor,
  requireRole,
  asString,
  reportTerminalOutcome,
  runDurableTerminalMutation,
} from './common.js'

export function researchTools(ctx: Context): readonly ToolDefinition[] {
  return [defineJsonTool({
    name: 'military_read_accepted_ledger', description: 'Read accepted and committed Mission facts only for memory or evaluation research.',
    parameters: { missionId: { type: 'string', required: true } }, output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute({ missionId }, exec) {
      const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['trajectory', 'effectiveness', 'museum', 'evaluation-examiner', 'evaluation-chair'])
      const events = await ctx.militaryHost.application.ledger.readEvents(brand<string, 'MissionId'>(String(missionId)))
      return { events: events.filter((event: { readonly type: string }) => ['task/accepted', 'task/integrated', 'wave/barrier-satisfied', 'mission/completed'].includes(event.type)) }
    },
  }), defineJsonTool({
    name: 'military_submit_research_artifact', description: 'Store a sourced research result and conclude the current research turn.',
    parameters: {
      title: { type: 'string', required: true }, content: { type: 'string', required: true },
      mediaType: { type: 'string' }, classification: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const agent = requireCallingAgent(exec.agent); const identity = identityFor(ctx, agent)
      requireRole(identity, ['trajectory', 'effectiveness', 'museum', 'evaluation-examiner', 'evaluation-chair'])
      const classification = String(args.classification ?? 'confidential')
      if (!['public', 'internal', 'confidential', 'restricted'].includes(classification)) throw new Error('invalid classification')
      const title = asString(args.title, 'title')
      const content = asString(args.content, 'content')
      const mediaType = String(args.mediaType ?? 'text/markdown')
      const terminal = await runDurableTerminalMutation(ctx, {
        identity,
        actionKey: `research:${sha256(stableJson({
          agentId: String(identity.agentId),
          generation: identity.generation,
          title,
          content,
          mediaType,
          classification,
        })).slice(0, 40)}`,
        draft: { title, content, mediaType, classification },
        operation: async () => await ctx.militaryHost.application.artifacts.put({
          bytes: new TextEncoder().encode(content),
          mediaType,
          classification: classification as 'public' | 'internal' | 'confidential' | 'restricted',
          description: title,
        }),
      })
      const artifact = terminal.value
      const parentReport = await reportTerminalOutcome(ctx, agent, {
        kind: 'RESEARCH_ARTIFACT',
        idempotencyKey: `research-terminal:${String(artifact.artifactId)}`,
        summary: `Research artifact “${title}” is ready.`,
        details: { artifactId: String(artifact.artifactId), mediaType: artifact.mediaType },
        signal: exec.signal,
      })
      exec.concludeTurn()
      return {
        artifact,
        parentReport,
        replayedMutation: terminal.replayed,
        concludesTurn: true,
      }
    },
  })]
}
export function apply(ctx: Context): void { registerTools(ctx, researchTools(ctx)) }
export const name = 'dsh-military-tools-research'
export const inject = ['tools', 'militaryHost', 'militaryAgentIdentities']
