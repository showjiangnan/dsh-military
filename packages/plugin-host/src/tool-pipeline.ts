import type { Context } from '@deepseek-ai/cordis'
import type {
  PostToolDecision,
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import {
  brand,
  isoNow,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import type { MilitaryHostRuntime } from './context.js'
import type { AgentPlaneState } from './agent-plane-state.js'
import {
  authorizeDepartmentToolExecution,
  reserveToolExecutionBudget,
  settleToolExecutionBudget,
} from './tool-authorization.js'

/** Register tool admission, budget settlement, host-observed evidence, and terminal submission tracking. */
export function registerToolPipeline(
  ctx: Context,
  host: MilitaryHostRuntime,
  state: AgentPlaneState,
): void {
  const admittedCalls = new Set<string>()
  ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    if (exec.agent === undefined || !host.isMilitaryAgent(exec.agent)) return await next()
    const step = currentAgentStep(exec.agent)
    const agentId = String(exec.agent.id)
    const concludedStep = state.concludedStepByAgent.get(agentId)
    if (concludedStep !== undefined && concludedStep !== step) {
      state.concludedStepByAgent.delete(agentId)
    } else if (step !== undefined && concludedStep === step) {
      return {
        kind: 'deny',
        reason: JSON.stringify({
          error: {
            code: 'TURN_ALREADY_CONCLUDED',
            message: `a successful terminal action already concluded ${step}`,
            retryable: false,
            recovery: 'Do not call another tool from this assistant response. Wait for the next user, parent, or Host message.',
          },
        }),
      }
    }
    const identity = await host.identityFor(exec.agent)
    const callSignature = toolCallSignature(exec)
    const invalid = state.invalidToolCallByAgent.get(agentId)
    if (invalid?.signature === callSignature) {
      return {
        kind: 'deny',
        reason: JSON.stringify({
          error: {
            code: 'REPEATED_INVALID_CALL',
            message: `the same invalid ${exec.name} arguments were already rejected`,
            retryable: false,
            recovery: 'Do not resend identical arguments. Apply the first error’s exact correction; if the missing fact cannot be observed, use the role-visible blocker or decision tool.',
          },
        }),
      }
    }
    host.application.oversight.requireAdmission(identity)
    if (state.finalizationOnlyAgents.has(String(exec.agent.id))
      && !FINALIZATION_ONLY_TOOLS.has(exec.name)) {
      return {
        kind: 'deny',
        reason: JSON.stringify({
          error: {
            code: 'STEP_BUDGET_EXHAUSTED',
            message: `tool ${exec.name} is operational and unavailable in the terminal-only grace step`,
            retryable: false,
            recovery: 'Use one visible terminal Military submission tool or report with already observed facts; do not retry reads, searches, edits, writes, validation, or Specs application.',
          },
        }),
      }
    }
    if (identity.role !== 'general') {
      const binding = await host.application.executionBindings.forAgent(
        String(identity.agentId),
        identity.generation,
      )
      if (binding === null) {
        return { kind: 'deny', reason: 'missing immutable AgentExecutionBinding' }
      }
      const profile = await host.application.policies.toolProfile(
        binding.toolProfile.id,
        binding.toolProfile.revision,
      )
      const slot = acquireToolSlot(state, agentId, String(exec.callId), profile.maxParallelCalls)
      if (slot !== null) return { kind: 'deny', reason: slot }
      try {
        const decision = await authorizeDepartmentToolExecution(host, binding, exec, next)
        if (decision.kind === 'allow') {
          admittedCalls.add(admittedCallKey(agentId, String(exec.callId)))
        } else {
          releaseToolSlot(state, agentId, String(exec.callId))
        }
        return decision
      } catch (error) {
        releaseToolSlot(state, agentId, String(exec.callId))
        throw error
      }
    }

    let profile: Awaited<ReturnType<typeof host.application.policies.toolProfile>>
    try {
      profile = await host.application.policies.toolProfile('general-tools')
      if (profile.denyTools.includes(exec.name) || !profile.allowTools.includes(exec.name)) {
        return {
          kind: 'deny',
          reason: generalToolProfileDenial(
            exec.name,
            profile.toolProfileId,
            Number(profile.revision),
          ),
        }
      }
      const authorityContext = await host.application.authorization.resolve(
        String(identity.agentId),
        host.config.tenantId,
      )
      const authority = await host.application.authorization.authorize({
        context: authorityContext,
        action: 'tool.execute',
        resource: exec.name,
        classification: 'internal',
      })
      if (!authority.allowed) {
        return {
          kind: 'deny',
          reason: `authority denied: ${authority.reason ?? 'no matching authority'}`,
        }
      }
    } catch (error) {
      return { kind: 'deny', reason: `authority denied: ${errorMessage(error)}` }
    }
    const slot = acquireToolSlot(state, agentId, String(exec.callId), profile.maxParallelCalls)
    if (slot !== null) return { kind: 'deny', reason: slot }
    let downstream: PreToolDecision
    try {
      downstream = await next()
    } catch (error) {
      releaseToolSlot(state, agentId, String(exec.callId))
      throw error
    }
    if (downstream.kind !== 'allow') {
      releaseToolSlot(state, agentId, String(exec.callId))
      return downstream
    }
    try {
      await reserveToolExecutionBudget(host, identity, null, exec)
    } catch (error) {
      releaseToolSlot(state, agentId, String(exec.callId))
      return {
        kind: 'deny',
        reason: `resource budget denied: ${errorMessage(error)}`,
      }
    }
    admittedCalls.add(admittedCallKey(agentId, String(exec.callId)))
    return downstream
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const agent = exec.agent
    if (agent === undefined || !host.isMilitaryAgent(agent)) return await next()
    const identity = await host.identityFor(agent)
    const profile = identity.role === 'general'
      ? await host.application.policies.toolProfile('general-tools')
      : await profileForDepartmentAgent(host, identity)
    const timeoutMs = profile.timeoutOverrides[exec.name]
    if (timeoutMs === undefined) return await next()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
      return toolProfileTimeoutResult(
        exec.name,
        timeoutMs,
        'TOOL_PROFILE_INVALID',
        'Tool timeout must be an integer between 1 and 3600000 milliseconds.',
      )
    }
    const upstream = exec.signal
    const timeoutController = new AbortController()
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Military ToolProfile timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    exec.signal = AbortSignal.any([upstream, timeoutController.signal])
    try {
      const result = await next()
      return timeoutController.signal.aborted && !upstream.aborted
        ? toolProfileTimeoutResult(
            exec.name,
            timeoutMs,
            'MILITARY_TOOL_TIMEOUT',
            `Tool ${exec.name} exceeded its governed ${timeoutMs}ms timeout.`,
          )
        : result
    } catch (error) {
      if (timeoutController.signal.aborted && !upstream.aborted) {
        return toolProfileTimeoutResult(
          exec.name,
          timeoutMs,
          'MILITARY_TOOL_TIMEOUT',
          `Tool ${exec.name} exceeded its governed ${timeoutMs}ms timeout.`,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
      exec.signal = upstream
    }
  })

  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const agent = exec.agent
    if (agent === undefined || !host.isMilitaryAgent(agent)) return await next()
    let decision: PostToolDecision
    try {
      decision = await next()
    } catch (error) {
      admittedCalls.delete(admittedCallKey(String(agent.id), String(exec.callId)))
      releaseToolSlot(state, String(agent.id), String(exec.callId))
      throw error
    }
    const admitted = admittedCalls.delete(admittedCallKey(String(agent.id), String(exec.callId)))
    releaseToolSlot(state, String(agent.id), String(exec.callId))
    const identity = await host.identityFor(agent)
    const binding = identity.role === 'general'
      ? null
      : await host.application.executionBindings.forAgent(
          String(identity.agentId),
          identity.generation,
        )
    const previous = await host.application.observedEvidence.toolCalls([String(exec.callId)])
    const observedAt = previous[0]?.observedAt ?? isoNow()
    const observedOutcome = {
      isError: result.isError,
      outcome: result.isError ? result.error : result.value,
      content: result.content,
      meta: result.meta,
      postDecision: decision,
    }
    await host.application.observedEvidence.recordToolCall({
      schemaVersion: '1.0.0',
      callId: String(exec.callId),
      rootCallId: String(exec.rootCallId),
      agent: identity,
      ...(binding === null ? {} : {
        bindingId: binding.bindingId,
        missionId: binding.missionId,
        ...(binding.workspace === undefined ? {} : {
          taskId: binding.workspace.taskId,
          taskVersion: binding.workspace.taskVersion,
        }),
      }),
      toolName: exec.name,
      argumentsHash: brand<string, 'Sha256'>(sha256(stableJson(exec.arguments))),
      outcomeHash: brand<string, 'Sha256'>(sha256(stableJson(observedOutcome))),
      isError: result.isError || decision.kind === 'block',
      observedAt,
    })
    if (admitted) {
      await settleToolExecutionBudget(host, identity, exec, observedOutcome, observedAt)
    }
    if (result.isError && isInvalidArgumentFailure(result.error)) {
      state.invalidToolCallByAgent.set(String(agent.id), {
        signature: toolCallSignature(exec),
        errorHash: sha256(stableJson(result.error)),
      })
    } else if (!result.isError) {
      state.invalidToolCallByAgent.delete(String(agent.id))
    }
    if (!result.isError
      && decision.kind === 'accept'
      && TERMINAL_MILITARY_TOOLS.has(exec.name)) {
      const step = currentAgentStep(agent)
      if (step !== undefined) state.concludedStepByAgent.set(String(agent.id), step)
    }
    return decision
  })

  ctx.on('tools/result', (
    exec: Readonly<ToolExecution>,
    result: Readonly<ToolExecutionResult>,
  ) => {
    const agent = exec.agent
    if (agent === undefined || !host.isMilitaryAgent(agent)) return
    if (!result.isError) {
      const turn = currentTurn(agentEvents(agent))
      if (turn !== undefined) {
        const key = `${String(agent.id)}:${turn}`
        const tools = state.generalSuccessfulToolsByTurn.get(key) ?? new Set<string>()
        tools.add(exec.name)
        state.generalSuccessfulToolsByTurn.set(key, tools)
        // A successful governed tool is observable progress. Reset the
        // stop-interlock counter so Flash can advance through several compact
        // Mission stages without three valid one-tool steps being mistaken
        // for three no-progress attempts.
        state.interlockNoProgress.delete(key)
      }
    }
    if (!result.isError && TERMINAL_MILITARY_TOOLS.has(exec.name)) {
      const turn = currentTurn(agentEvents(agent))
      if (turn !== undefined) {
        state.terminalSubmissionTurns.add(`${String(agent.id)}:${turn}`)
      }
    }
  })
}

/** One rejected hallucinated name must teach Flash the valid coordination route. */
export function generalToolProfileDenial(
  toolName: string,
  profileId: string,
  revision: number,
): string {
  return JSON.stringify({
    error: {
      code: 'POLICY_DENIED',
      message: `tool ${toolName} is not visible to General under ${profileId}@${revision}`,
      retryable: false,
      recovery: 'Do not retry this tool or substitute another unlisted generic tool. Call only a name in the current request header. For repository facts, call military_status and then military_spawn_department_agent with advisor-generalist and without a taskId.',
    },
  })
}

const TERMINAL_MILITARY_TOOLS = new Set([
  'ask_user_question',
  'military_spawn_department_agent',
  'military_submit_candidate',
  'military_submit_blocker',
  'military_radio_request',
  'military_radio_issue',
  'military_staff_issue_guidance',
  'military_submit_decision_questions',
  'military_specs_apply_order',
  'military_submit_inspection',
  'military_submit_research_artifact',
  'report',
])

const FINALIZATION_ONLY_TOOLS = new Set([
  ...TERMINAL_MILITARY_TOOLS,
])

function currentTurn(
  events: readonly { readonly type: string; readonly data: unknown }[],
): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end') return undefined
    if (event?.type !== 'turn/start') continue
    const turn = (event.data as { turn?: unknown }).turn
    return Number.isSafeInteger(turn) ? turn as number : undefined
  }
  return undefined
}

function currentStep(
  events: readonly { readonly type: string; readonly data: unknown }[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'step/end' || event?.type === 'turn/end') return undefined
    if (event?.type !== 'step/start') continue
    const data = event.data as { turn?: unknown; step?: unknown }
    if (!Number.isSafeInteger(data.turn) || !Number.isSafeInteger(data.step)) return undefined
    return `turn:${String(data.turn)}:step:${String(data.step)}`
  }
  return undefined
}

function currentAgentStep(agent: {
  readonly session?: {
    readonly events?: readonly { readonly type: string; readonly data: unknown }[]
  }
}): string | undefined {
  return currentStep(agentEvents(agent))
}

function agentEvents(agent: {
  readonly session?: {
    readonly events?: readonly { readonly type: string; readonly data: unknown }[]
  }
}): readonly { readonly type: string; readonly data: unknown }[] {
  return agent.session?.events ?? []
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function toolCallSignature(exec: Readonly<ToolExecution>): string {
  return sha256(stableJson({ name: exec.name, arguments: exec.arguments }))
}

function admittedCallKey(agentId: string, callId: string): string {
  return `${agentId}\u0000${callId}`
}

function isInvalidArgumentFailure(value: unknown): boolean {
  const serialized = stableJson(value)
  return serialized.includes('INVALID_ARGUMENT')
    || serialized.includes('violates canonical')
    || serialized.includes('must be a')
    || serialized.includes('is required')
}

async function profileForDepartmentAgent(
  host: MilitaryHostRuntime,
  identity: Awaited<ReturnType<MilitaryHostRuntime['identityFor']>>,
) {
  const binding = await host.application.executionBindings.forAgent(
    String(identity.agentId),
    identity.generation,
  )
  if (binding === null) throw new Error('missing immutable AgentExecutionBinding')
  return await host.application.policies.toolProfile(
    binding.toolProfile.id,
    binding.toolProfile.revision,
  )
}

function acquireToolSlot(
  state: AgentPlaneState,
  agentId: string,
  callId: string,
  maximum: number,
): string | null {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    return JSON.stringify({
      error: {
        code: 'TOOL_PROFILE_INVALID',
        message: `maxParallelCalls must be a positive integer, received ${String(maximum)}`,
        retryable: false,
        recovery: 'Pause this Agent and correct its ToolProfile before retrying.',
      },
    })
  }
  const active = state.activeToolCallsByAgent.get(agentId) ?? new Set<string>()
  if (active.has(callId)) {
    return JSON.stringify({
      error: {
        code: 'DUPLICATE_TOOL_CALL_ID',
        message: `tool call ${callId} is already executing`,
        retryable: false,
        recovery: 'Wait for the existing call result; do not duplicate its call ID.',
      },
    })
  }
  if (active.size >= maximum) {
    return JSON.stringify({
      error: {
        code: 'TOOL_PARALLEL_LIMIT',
        message: `ToolProfile permits ${maximum} simultaneous call(s); ${active.size} are still running`,
        retryable: true,
        recovery: 'Wait for one running call to finish, then issue only the still-needed call in a new step.',
      },
    })
  }
  active.add(callId)
  state.activeToolCallsByAgent.set(agentId, active)
  return null
}

function releaseToolSlot(
  state: AgentPlaneState,
  agentId: string,
  callId: string,
): void {
  const active = state.activeToolCallsByAgent.get(agentId)
  if (active === undefined) return
  active.delete(callId)
  if (active.size === 0) state.activeToolCallsByAgent.delete(agentId)
}

function toolProfileTimeoutResult(
  name: string,
  timeoutMs: number,
  code: string,
  message: string,
): ToolExecutionResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code,
          message,
          retryable: code === 'MILITARY_TOOL_TIMEOUT',
          recovery: code === 'MILITARY_TOOL_TIMEOUT'
            ? 'The call reached quiescence. Use the role-visible blocker tool with observed facts, or retry once in a new step if the operation is idempotent.'
            : 'Correct the ToolProfile before executing this tool.',
          tool: name,
          timeoutMs,
        },
      }),
    }],
    isError: true,
    error: {
      message,
      info: { name: 'MilitaryToolTimeoutError', code },
    },
  }
}
