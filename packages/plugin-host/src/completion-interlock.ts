import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MilitaryHostRuntime } from './context.js'
import type { AgentPlaneState } from './agent-plane-state.js'
import {
  generalWorkflowInstruction,
  nextGeneralWorkflowStage,
} from './general-workflow-guard.js'

/** Register the role-scoped turn-stopping interlock. */
export function registerCompletionInterlock(
  ctx: Context,
  host: MilitaryHostRuntime,
  state: AgentPlaneState,
): void {
  ctx.on('agent/turn-stopping', async (
    { agent, turn }: { readonly agent: Agent; readonly turn: number },
  ) => {
    if (!host.isMilitaryAgent(agent)) return
    const identity = await host.identityFor(agent)
    const policy = host.oversightSettings()
    if (!policy.completionInterlockEnabled) return
    const key = `${String(agent.id)}:${turn}`
    if (hasTerminalSubmission(state.terminalSubmissionTurns, key)) {
      state.interlockNoProgress.delete(key)
      return
    }
    if (identity.role === 'general') {
      const stage = await nextGeneralWorkflowStage({
        host,
        state,
        agent,
        identity,
        turn,
      })
      if (stage === null) {
        state.generalWorkflowStageByAgent.delete(String(agent.id))
        state.interlockNoProgress.delete(key)
        return
      }
      state.generalWorkflowStageByAgent.set(String(agent.id), stage)
      await rejectMissingTerminalSubmission({
        host,
        state,
        agent,
        identity,
        key,
        maximumAttempts: policy.maximumNoProgressTurns,
        freezeOnExhaustion: policy.freezeOnSecondMissingSubmission,
        instruction: attempts => generalWorkflowInstruction(stage, {
          current: attempts,
          maximum: policy.maximumNoProgressTurns,
        }),
      })
      return
    }
    if (identity.role !== 'worker' && identity.role !== 'engineer') return
    await rejectMissingTerminalSubmission({
      host,
      state,
      agent,
      identity,
      key,
      maximumAttempts: policy.maximumNoProgressTurns,
      freezeOnExhaustion: policy.freezeOnSecondMissingSubmission,
      instruction: attempts =>
        `Completion interlock ${attempts}/${policy.maximumNoProgressTurns}: do not finish with prose. Submit a Candidate, structured blocker, radio request, decision question set, or another role-authorized terminal artifact through a Military tool.`,
    })
  })
}

async function rejectMissingTerminalSubmission(input: {
  readonly host: MilitaryHostRuntime
  readonly state: AgentPlaneState
  readonly agent: Agent
  readonly identity: Awaited<ReturnType<MilitaryHostRuntime['identityFor']>>
  readonly key: string
  readonly maximumAttempts: number
  readonly freezeOnExhaustion: boolean
  readonly instruction: (attempts: number) => string
}): Promise<void> {
  const {
    host,
    state,
    agent,
    identity,
    key,
    maximumAttempts,
    freezeOnExhaustion,
    instruction,
  } = input
  const attempts = (state.interlockNoProgress.get(key) ?? 0) + 1
  state.interlockNoProgress.set(key, attempts)
  if (attempts < maximumAttempts) {
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: instruction(attempts),
      }],
      source: {
        kind: 'plugin',
        plugin: '@dsh-military/plugin-host',
        form: 'instructions',
      },
    }))
    return
  }
  if (freezeOnExhaustion) {
    host.application.oversight.freeze({
      agent: identity,
      reasonCodes: ['MISSING_TERMINAL_SUBMISSION', 'NO_PROGRESS_LIMIT'],
    })
  }
  agent.cancel(
    { kind: 'hook', reason: 'dsh-military completion interlock' },
    { keepInbox: true },
  )
  await host.abortMilitaryAgent(agent, 'NO_PROGRESS_LIMIT')
}

function hasTerminalSubmission(submissions: Set<string>, key: string): boolean {
  return submissions.delete(key)
}
