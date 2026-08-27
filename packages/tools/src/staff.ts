import type {} from '@dsh-military/plugin-host'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MilitaryError, brand } from '@dsh-military/contracts'
import {
  defineJsonTool,
  text,
  registerTools,
  requireCallingAgent,
  identityFor,
  requireRole,
  asStringArray,
  missionSnapshotValue,
  reportTerminalOutcome,
  runDurableTerminalMutation,
} from './common.js'
import {
  compileTacticalGuidanceDraft,
  tacticalGuidanceDraftParameters,
} from './lightweight-drafts.js'

export function staffTools(ctx: Context): readonly ToolDefinition[] {
  return [
    defineJsonTool({
      name: 'military_staff_read_mission',
      description: 'Staff/General only. Read the JSON-safe Mission projection and event stream for analysis. Use the missionId returned by military_get_context.',
      parameters: { missionId: { type: 'string', required: true }, afterSeq: { type: 'integer' } },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['advisor', 'chief-of-staff', 'general'])
        const id = brand<string, 'MissionId'>(String(args.missionId))
        return {
          snapshot: missionSnapshotValue(
            await ctx.militaryHost.application.ledger.readMission(id),
          ),
          events: await ctx.militaryHost.application.ledger.readEvents(
            id,
            Number(args.afterSeq ?? 0),
          ),
        }
      },
    }),
    defineJsonTool({
      name: 'military_staff_retrieve_tactics', description: 'Retrieve a small Host-bounded set of versioned tactic candidates from one to five scene tags. The Host reports whether the result meets the configured sufficiency floor.',
      parameters: {
        tags: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'One to five concrete scene tags.',
        },
        includeTesting: { type: 'boolean' },
        maxCandidates: { type: 'integer' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['advisor', 'chief-of-staff', 'general'])
        const tags = asStringArray(args.tags, 'tags')
        if (tags.length < 1 || tags.length > 5) {
          throw new MilitaryError('INVALID_ARGUMENT', 'tags must contain between one and five scene tags')
        }
        const settings = ctx.militaryHost.featureSettings()
        const requestedMaximum = Number(args.maxCandidates ?? settings.tactics.candidateRecallMaximum)
        if (!Number.isSafeInteger(requestedMaximum) || requestedMaximum < 1) {
          throw new MilitaryError('INVALID_ARGUMENT', 'maxCandidates must be a positive integer')
        }
        const maximum = Math.min(requestedMaximum, settings.tactics.candidateRecallMaximum)
        const candidates = ctx.militaryHost.tactics.retrieve({
          tags,
          includeTesting: args.includeTesting === true && settings.tactics.allowCanaryDelivery,
          maxCandidates: maximum,
        })
        const sufficient = candidates.length >= settings.tactics.candidateRecallMinimum
        return {
          candidates,
          sufficient,
          configuredMinimum: settings.tactics.candidateRecallMinimum,
          configuredMaximum: settings.tactics.candidateRecallMaximum,
          nextAction: sufficient
            ? 'SYNTHESIZE_FROM_RETURNED_CANDIDATES'
            : settings.staff.chiefOfStaffFallbackEnabled
              ? 'CALL_MILITARY_STAFF_CHIEF_ADVICE'
              : 'SUBMIT_A_BOUNDED_BLOCKER_OR_DECISION_QUESTION',
        }
      },
    }),
    defineJsonTool({
      name: 'military_staff_chief_advice', description: 'Use the Chief of Staff fallback when private tactics are insufficient or conflicted.',
      parameters: {
        context: {
          type: 'object',
          required: true,
          properties: {},
          additionalProperties: true,
          description: 'Open JSON context packet containing only the evidence needed for advice.',
        },
        sufficiency: {
          type: 'string',
          required: true,
          enum: ['PARTIAL', 'INSUFFICIENT', 'CONFLICTED', 'UNKNOWN'],
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['advisor', 'chief-of-staff', 'general'])
        if (!ctx.militaryHost.featureSettings().staff.chiefOfStaffFallbackEnabled) {
          throw new MilitaryError(
            'POLICY_DENIED',
            'Chief of Staff fallback is disabled in Military settings',
          )
        }
        const disposition = String(args.sufficiency)
        if (!['PARTIAL', 'INSUFFICIENT', 'CONFLICTED', 'UNKNOWN'].includes(disposition)) throw new Error('invalid tactical sufficiency')
        const packet = await ctx.militaryHost.application.artifacts.put({
          bytes: new TextEncoder().encode(JSON.stringify(args.context, null, 2)), mediaType: 'application/json',
          classification: 'confidential', description: 'Chief of Staff fallback context packet',
        })
        return await ctx.militaryHost.application.chiefOfStaff.advise({
          contextPacket: packet, sufficiency: disposition as 'PARTIAL' | 'INSUFFICIENT' | 'CONFLICTED' | 'UNKNOWN', signal: exec.signal,
        })
      },
    }),
    defineJsonTool({
      name: 'military_staff_issue_guidance', description: 'Terminal Staff action. Supply the leased requestId, diagnosis, steps and expected observations; the Host compiles authority, Task/version and directive identity, issues it through Radio, reports the parent and concludes this turn.',
      parameters: tacticalGuidanceDraftParameters,
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const identity = identityFor(ctx, agent)
        requireRole(identity, ['advisor', 'chief-of-staff', 'general'])
        const request = await ctx.militaryHost.application.radio.leased(
          brand<string, 'TacticalRequestId'>(String(args.requestId)),
          identity,
        )
        const value = compileTacticalGuidanceDraft({
          value: args,
          identity,
          request,
        })
        const terminal = await runDurableTerminalMutation(ctx, {
          identity,
          actionKey: `guidance:${String(value.guidanceId)}`,
          draft: {
            arguments: args,
            requestId: String(request.requestId),
            taskVersion: Number(request.location.taskVersion),
          },
          operation: async () => {
            await ctx.militaryHost.application.radio.issue(value)
            return { guidanceId: String(value.guidanceId), state: 'READY' as const }
          },
        })
        const parentReport = await reportTerminalOutcome(ctx, agent, {
          kind: 'TACTICAL_GUIDANCE',
          idempotencyKey: `guidance-terminal:${String(value.guidanceId)}`,
          summary: `Tactical guidance ${String(value.guidanceId)} is ready for request ${String(value.requestId)}.`,
          details: {
            expectedTaskVersion: Number(value.expectedTaskVersion),
            directiveSteps: value.directive.length,
          },
          signal: exec.signal,
        })
        exec.concludeTurn()
        return {
          ...terminal.value,
          parentReport,
          replayedMutation: terminal.replayed,
          concludesTurn: true,
        }
      },
    }),
  ]
}

export function apply(ctx: Context): void { registerTools(ctx, staffTools(ctx)) }
export const name = 'dsh-military-tools-staff'
export const inject = ['tools', 'militaryHost', 'militaryAgentIdentities']
