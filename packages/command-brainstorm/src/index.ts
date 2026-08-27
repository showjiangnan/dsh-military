import type {} from '@dsh-military/runtime'
import { assertModelInputCapability, createMissionCommand } from '@dsh-military/core'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { ContentBlock, LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MilitaryError, brand, type MissionId } from '@dsh-military/contracts'

export interface Config {
  readonly command?: string
  readonly displayName?: string
  /** Allow RC.2 command image admission for sketches, screenshots and diagrams. */
  readonly allowImages?: boolean
}

export const name = 'dsh-military-command-brainstorm'
export const inject = ['commands', 'militaryHost'] as const

export function apply(ctx: Context, config: Config = {}): void {
  const command = config.command ?? 'brainstorm'
  const displayName = config.displayName ?? '头脑风暴'
  const allowImages = config.allowImages ?? true
  if (ctx.commands === undefined) throw new Error('dsh-military /brainstorm requires ctx.commands')
  ctx.commands.register({
    name: command,
    description: `${displayName}：由将军和参谋部通过多轮选择辅助明确需求，并交给工兵维护 specs。`,
    input: { hint: '可选：本次希望讨论的目标或背景', images: allowImages },
    recordInput: true,
    async handler({ agent, rawInput, attachments, signal }) {
      try {
        signal.throwIfAborted()
        if (!ctx.militaryHost.isMilitaryAgent(agent)) {
          return { kind: 'error', text: '该命令只在新建会话时选择了 Military preset 的会话中可用。' }
        }
        await ctx.militaryHost.ensureSessionBinding(agent)
        const identity = ctx.militaryHost.identity(agent)
        if (identity.role !== 'general') return { kind: 'error', text: '只有根 General 会话可以启动头脑风暴。' }
        const binding = await ctx.militaryHost.application.sessionGate.requireMilitarySession(identity.sessionId)
        if (attachments.length > 0) await requireImageCapableGeneral(ctx, agent, attachments)
        const missionId = await ensureMission(ctx, agent, rawInput.trim())
        const order = await ctx.militaryHost.application.brainstorm.active(binding.sessionId)
          ?? await ctx.militaryHost.application.runtime.startBrainstorm(binding.sessionId)
        if (String(order.missionId) !== String(missionId)) throw new MilitaryError('MILITARY_BINDING_MISMATCH', 'Brainstorm mission changed during admission')
        agent.followup(brainstormPrompt(order, rawInput.trim(), attachments))
        return {
          kind: 'success',
          text: `已启动${displayName}（${String(order.orderId)}）。General 将通过 ask_user_question 分阶段协助决策。`,
        }
      } catch (error) {
        const text = error instanceof MilitaryError ? `${error.failure.code}: ${error.message}` : String(error)
        return { kind: 'error', text }
      }
    },
  })
}

async function ensureMission(ctx: Context, agent: Agent, topic: string): Promise<MissionId> {
  const identity = ctx.militaryHost.identity(agent)
  const binding = await ctx.militaryHost.application.sessionGate.requireMilitarySession(identity.sessionId)
  const existing = await ctx.militaryHost.application.runtime.missionForSession(binding.sessionId)
  if (existing !== null) return existing
  const missionId = brand<string, 'MissionId'>(`brainstorm:${String(binding.sessionId)}`)
  const authorityContext = await ctx.militaryHost.application.authorization.resolve(
    String(identity.agentId),
    ctx.militaryHost.tenantId,
  )
  const authority = await ctx.militaryHost.application.authorization.authorize({
    context: authorityContext,
    action: 'mission.command.mission.start',
    resource: String(missionId),
    classification: 'internal',
  })
  if (!authority.allowed) {
    throw new MilitaryError(
      'UNAUTHORIZED',
      `mission start authority denied: ${authority.reason ?? 'no matching authority'}`,
    )
  }
  const snapshot = await ctx.militaryHost.application.ledger.readMission(missionId)
  const command = createMissionCommand({
    tenantId: ctx.militaryHost.tenantId, missionId, expectedRevision: snapshot.revision,
    actor: identity,
    actorAuthorityRef: authority.receiptRef ?? authorityContext.authorityContextId,
    type: 'mission.start', payload: { title: topic === '' ? 'Brainstorm mission' : topic.slice(0, 160), rootSessionId: String(binding.sessionId) },
    idempotencyKey: `brainstorm-mission:${String(binding.sessionId)}`,
  })
  await ctx.militaryHost.application.missionKernel.execute(command, () => ctx.militaryHost.application.runtime.registerMission({
    missionId,
    rootSessionId: binding.sessionId,
    general: identity,
    title: topic === '' ? 'Brainstorm mission' : topic.slice(0, 160),
    authorityContextRef: authority.receiptRef ?? authorityContext.authorityContextId,
  }))
  return missionId
}

async function requireImageCapableGeneral(ctx: Context, agent: Agent, attachments: readonly ContentBlock[]): Promise<void> {
  const policy = await ctx.militaryHost.application.generalRouting.policy()
  const header = (agent.session as Agent['session'] & { requestHeader?(): { config: LlmCallConfig } | undefined }).requestHeader?.()
  const provider = header?.config.provider ?? policy.defaultModel.provider
  const model = header?.config.model ?? policy.defaultModel.model
  const capability = await ctx.militaryHost.application.policies.modelCapability(provider, model)
  assertModelInputCapability(capability, { modalities: ['text', 'image'], totalImageBytes: attachmentBytes(attachments) })
}


function attachmentBytes(attachments: readonly ContentBlock[]): number {
  let total = 0
  for (const block of attachments) {
    if (block.type !== 'image') continue
    const attachment = 'attachment' in block ? block.attachment : undefined
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'RC.2 image block lacks a durable attachment reference')
    }
    const bytes = (attachment as { readonly bytes?: unknown }).bytes
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new MilitaryError('INVALID_ARGUMENT', 'RC.2 image attachment byte length is invalid')
    }
    total += bytes
    if (!Number.isSafeInteger(total)) throw new MilitaryError('INVALID_ARGUMENT', 'aggregate image byte length exceeds the safe integer range')
  }
  return total
}

function brainstormPrompt(
  order: {
    readonly orderId: unknown
    readonly missionId: unknown
    readonly projectStage: string
    readonly questionPolicy: {
      readonly maxRounds: number
      readonly maxQuestionsPerRound: number
    }
  },
  topic: string,
  attachments: readonly ContentBlock[],
): UserMessage {
  const text = [
    `Brainstorm Order ${String(order.orderId)} is active for project stage ${order.projectStage}.`,
    `Authoritative Mission ${String(order.missionId)} is already ACTIVE. Call military_get_context first and use every returned ID verbatim. Do not call military_mission_start.`,
    topic === '' ? 'The user supplied no extra topic; begin by discovering the desired outcome.' : `Initial topic: ${topic}`,
    'Use ask_user_question frequently for user-owned choices. Put the recommended option first and mark it “(Recommended)”.',
    `Ask at most ${order.questionPolicy.maxQuestionsPerRound} concise questions per round and at most ${order.questionPolicy.maxRounds} rounds.`,
    'General has no direct repository filesystem or shell tools. When repository facts are needed, call military_status, then spawn the exact ACTIVE "advisor-generalist" template without a taskId and give it a bounded read-only discovery prompt; use its report instead of asking the user where code lives.',
    'Progress through discovery, goals, constraints, user experience, technology, operations, staff review, and specs handoff.',
    'General may call only exact tool names visible in this turn. Never emit an unlisted generic or role-specific tool name, and never attempt Engineer-only military_specs_* tools from General.',
    'When decisions are sufficient, call military_task_create with its flat semantic fields: taskKey, direction, wave, objective, whyItMatters, taskType, assignedRole, scope, and acceptanceCriteria. The Host creates all IDs, version fences, complexity and evidence clauses; never construct a nested canonical order.',
    'Use the returned taskId unchanged when calling military_spawn_department_agent. For a specs handoff use the built-in templateId "engineer-default" (or copy an exact ACTIVE templateId from military_status), pass that taskId, and require the Engineer to validate and locally commit the specs.',
  ].join('\n')
  return {
    id: crypto.randomUUID() as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text', text }, ...attachments],
    source: { kind: 'plugin', plugin: '@dsh-military/command-brainstorm', form: 'instructions' },
  }
}
