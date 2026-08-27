import type { Context } from '@deepseek-ai/cordis'
import type {
  PostToolDecision,
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  brand,
  isoNow,
  type ObservedToolCallReceipt,
  type ResourceUsageReceipt,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import type { MilitaryHostRuntime } from './context.js'
import type { AgentPlaneState } from './agent-plane-state.js'
import {
  authorizeDepartmentToolExecution,
  reserveToolExecutionBudget,
  toolBudgetReservationId,
  toolExecutionUsageReceipt,
  toolExecutionClassification,
} from './tool-authorization.js'
import { requireRoleWorkbenchApplied } from './role-workbench.js'
import { resolvePhaseVisibleTools } from './agent-lifecycle.js'
import {
  hostToolFailure,
  installedToolCorrection,
  roleRecoveryTool,
} from './tool-error.js'

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
    await requireRoleWorkbenchApplied(host)
    const identity = await host.identityFor(exec.agent)
    const step = currentAgentStep(exec.agent)
    const agentId = String(exec.agent.id)
    const concludedStep = state.concludedStepByAgent.get(agentId)
    if (concludedStep !== undefined && concludedStep !== step) {
      state.concludedStepByAgent.delete(agentId)
    } else if (step !== undefined && concludedStep === step) {
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'TURN_ALREADY_CONCLUDED',
          message: `a successful terminal action already concluded ${step}`,
          retryable: false,
          nextTool: 'WAIT_FOR_NEXT_MESSAGE',
          recovery: 'Do not call another tool from this assistant response. Wait for the next user, parent, or Host message.',
        }),
      }
    }
    if (state.finalizationOnlyAgents.has(String(exec.agent.id))
      && !FINALIZATION_ONLY_TOOLS.has(exec.name)) {
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'STEP_BUDGET_EXHAUSTED',
          message: `tool ${exec.name} is operational and unavailable in the terminal-only grace step`,
          retryable: false,
          nextTool: roleRecoveryTool(identity.role),
          recovery: 'Use the single nextTool with already observed facts; do not retry reads, searches, edits, writes, validation, or Specs application.',
        }),
      }
    }
    const resolvedPhaseTools = await resolvePhaseVisibleTools(
      host,
      exec.agent,
      state,
    )
    const phaseTools = resolvedPhaseTools === undefined
      ? undefined
      : installedPhaseTools(exec.agent, resolvedPhaseTools)
    if (phaseTools !== undefined && !phaseTools.has(exec.name)) {
      const exactNames = [...phaseTools].sort()
      const nextTool = preferredPhaseRecoveryTool(phaseTools)
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'PHASE_TOOL_NOT_VISIBLE',
          message: `tool ${exec.name} is outside the current Host-owned phase`,
          retryable: false,
          nextTool,
          details: { visibleTools: exactNames },
          recovery: `Call only ${nextTool} in a new assistant step.`,
        }),
      }
    }
    const callSignature = toolCallSignature(exec)
    const invalid = state.invalidToolCallByAgent.get(agentId)
    if (invalid?.signature === callSignature) {
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'REPEATED_INVALID_CALL',
          message: `the same invalid ${exec.name} arguments were already rejected`,
          retryable: false,
          nextTool: exec.name,
          recovery: 'Do not resend identical arguments. Call nextTool only with correctedShape; if a required fact cannot be observed, use the role-visible escalation tool.',
        }),
      }
    }
    host.application.oversight.requireAdmission(identity)
    if (identity.role !== 'general') {
      const binding = await host.application.executionBindings.forAgent(
        String(identity.agentId),
        identity.generation,
      )
      if (binding === null) {
        return {
          kind: 'deny',
          reason: hostToolFailure(exec.agent, {
            code: 'AGENT_EXECUTION_BINDING_MISSING',
            message: 'the immutable AgentExecutionBinding is unavailable',
            retryable: false,
            nextTool: roleRecoveryTool(identity.role),
            recovery: 'Stop execution and report the missing binding through nextTool; do not guess Task, workspace, grant, or profile identifiers.',
          }),
        }
      }
      const profile = await host.application.policies.toolProfile(
        binding.toolProfile.id,
        binding.toolProfile.revision,
      )
      const slot = acquireToolSlot(
        state,
        exec.agent,
        exec.name,
        String(exec.callId),
        profile.maxParallelCalls,
      )
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
            exec.agent,
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
        classification: toolExecutionClassification(exec, 'internal'),
      })
      if (!authority.allowed) {
        return {
          kind: 'deny',
          reason: hostToolFailure(exec.agent, {
            code: 'UNAUTHORIZED',
            message: `authority denied: ${authority.reason ?? 'no matching authority'}`,
            retryable: false,
            nextTool: 'military_status',
            recovery: 'Call military_status once to refresh the authoritative workflow; do not retry the denied mutation.',
          }),
        }
      }
    } catch (error) {
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'UNAUTHORIZED',
          message: `authority resolution failed: ${errorMessage(error)}`,
          retryable: false,
          nextTool: 'military_status',
          recovery: 'Call military_status once to refresh the authoritative workflow; do not retry the denied mutation.',
        }),
      }
    }
    const slot = acquireToolSlot(
      state,
      exec.agent,
      exec.name,
      String(exec.callId),
      profile.maxParallelCalls,
    )
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
        reason: hostToolFailure(exec.agent, {
          code: 'BUDGET_RESERVATION_REQUIRED',
          message: `resource budget admission failed: ${errorMessage(error)}`,
          retryable: false,
          nextTool: 'military_status',
          recovery: 'Call military_status once and wait for a Host budget or recovery decision; do not duplicate the blocked operation.',
        }),
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
    const binding = identity.role === 'general'
      ? null
      : await host.application.executionBindings.forAgent(
          String(identity.agentId),
          identity.generation,
        )
    const missionId = binding?.missionId
      ?? String(
        await host.application.runtime.missionForSession(identity.sessionId)
        ?? '',
      )
    return await host.application.production.telemetry.withSpan({
      name: `military.tool.${exec.name}`,
      tenantId: host.tenantId,
      ...(missionId === '' ? {} : { missionId }),
      ...(binding?.workspace === undefined
        ? {}
        : { taskId: binding.workspace.taskId }),
      ...(binding?.execution === undefined
        ? {}
        : {
            attemptId: binding.execution.attemptId,
            activationId: binding.execution.activationId,
            dispatchId: binding.execution.dispatchId,
          }),
      operationId: String(exec.callId),
      attributes: {
        toolName: exec.name,
        role: identity.role,
        profileId: String(profile.toolProfileId),
        profileRevision: Number(profile.revision),
      },
    }, async () => {
      const timeoutMs = profile.timeoutOverrides[exec.name]
      if (timeoutMs === undefined) return await next()
      if (!Number.isSafeInteger(timeoutMs)
        || timeoutMs < 1
        || timeoutMs > 3_600_000) {
        return toolProfileTimeoutResult(
          exec.name,
          exec.callId,
          timeoutMs,
          agent,
          identity.role,
          'TOOL_PROFILE_INVALID',
          'Tool timeout must be an integer between 1 and 3600000 milliseconds.',
        )
      }
      const upstream = exec.signal
      const timeoutController = new AbortController()
      const timer = setTimeout(() => {
        timeoutController.abort(
          new Error(`Military ToolProfile timeout after ${timeoutMs}ms`),
        )
      }, timeoutMs)
      exec.signal = AbortSignal.any([upstream, timeoutController.signal])
      try {
        const result = await next()
        return timeoutController.signal.aborted && !upstream.aborted
          ? toolProfileTimeoutResult(
              exec.name,
              exec.callId,
              timeoutMs,
              agent,
              identity.role,
              'MILITARY_TOOL_TIMEOUT',
              `Tool ${exec.name} exceeded its governed ${timeoutMs}ms timeout.`,
            )
          : result
      } catch (error) {
        if (timeoutController.signal.aborted && !upstream.aborted) {
          return toolProfileTimeoutResult(
            exec.name,
            exec.callId,
            timeoutMs,
            agent,
            identity.role,
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
  })

  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const agent = exec.agent
    if (agent === undefined || !host.isMilitaryAgent(agent)) return await next()
    let decision: PostToolDecision | undefined
    let downstreamError: unknown
    try {
      decision = await next()
    } catch (error) {
      downstreamError = error
    } finally {
      releaseToolSlot(state, String(agent.id), String(exec.callId))
    }
    const admitted = admittedCalls.delete(admittedCallKey(String(agent.id), String(exec.callId)))
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
      postDecision: decision ?? {
        kind: 'hook-error',
        error: errorMessage(downstreamError),
      },
    }
    const observedReceipt: ObservedToolCallReceipt = {
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
      isError: result.isError
        || decision?.kind === 'block'
        || downstreamError !== undefined,
      observedAt,
    }
    host.application.production.telemetry.recordMetric({
      name: 'military.tool.calls',
      kind: 'COUNTER',
      value: 1,
      unit: 'calls',
      attributes: {
        toolName: exec.name,
        role: identity.role,
        outcome: observedReceipt.isError ? 'error' : 'success',
      },
    })
    let usageReceipt: ResourceUsageReceipt | undefined
    let usageBuildError: unknown
    const usageIntent = admitted
      ? {
          identity,
          toolName: exec.name,
          callId: String(exec.callId),
          result: observedOutcome,
          completedAt: observedAt,
        }
      : undefined
    if (admitted) {
      try {
        usageReceipt = await toolExecutionUsageReceipt(
          host,
          identity,
          exec,
          observedOutcome,
          observedAt,
        )
      } catch (error) {
        const reservation = await host.application.resourceBudgets.getReservation(
          toolBudgetReservationId(identity, exec),
        ).catch(() => undefined)
        if (reservation?.state !== 'SETTLED') usageBuildError = error
      }
    }
    const settlementResults = await Promise.allSettled([
      host.application.observedEvidence.recordToolCall(observedReceipt),
      ...(usageReceipt === undefined
        ? []
        : [host.application.resourceBudgets.settle(usageReceipt)]),
    ])
    const settlementFailed = usageBuildError !== undefined
      || settlementResults.some(value => value.status === 'rejected')
    if (settlementFailed) {
      host.outbox.enqueue({
        topic: 'tool-execution.settle',
        partitionKey: String(identity.agentId),
        eventId: `tool-settlement:${String(exec.callId)}`,
        payload: {
          observedReceipt,
          ...(usageReceipt === undefined ? {} : { usageReceipt }),
          ...(usageIntent === undefined ? {} : { usageIntent }),
          failures: [
            ...(usageBuildError === undefined
              ? []
              : [settlementFailure(usageBuildError)]),
            ...settlementResults.flatMap(value =>
              value.status === 'rejected'
                ? [settlementFailure(value.reason)]
                : []),
          ],
        },
      })
    }
    if (downstreamError !== undefined) throw downstreamError
    if (decision === undefined) {
      throw new Error('Military post-tool hook returned no decision')
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
    if (result.isError
      && isMilitaryTimeout(result)
      && (exec.name === 'military_workspace_write'
        || exec.name === 'military_workspace_edit')) {
      state.departmentPhaseByAgent.set(String(agent.id), 'RECOVER')
      return
    }
    if (!result.isError) {
      advanceDepartmentPhase(state, String(agent.id), exec.name)
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

function preferredPhaseRecoveryTool(
  visibleTools: ReadonlySet<string>,
): string {
  const priority = [
    'military_get_order',
    'military_workspace_operation_status',
    'military_specs_read',
    'military_workspace_read',
    'military_status',
    'military_radio_poll',
    'military_decision_present',
    'ask_user_question',
    'military_workspace_write',
    'military_workspace_edit',
    'military_specs_apply_order',
    'military_submit_blocker',
    'military_submit_candidate',
    'report',
  ]
  return priority.find(value => visibleTools.has(value))
    ?? [...visibleTools].sort()[0]
    ?? 'military_status'
}

/**
 * The phase is a dynamic mask, while the scoped RC.2 registry already carries
 * the immutable ToolProfile plus Task-grant ceiling. Error correction must
 * name their exact intersection—the same schemas that prompt assembly sees.
 */
function installedPhaseTools(
  agent: ToolExecution['agent'],
  phaseTools: ReadonlySet<string>,
): ReadonlySet<string> {
  const scoped = agent as unknown as {
    readonly ctx?: {
      readonly tools?: {
        schemas?(scope?: unknown): readonly { readonly name: string }[]
      }
    }
  }
  const schemas = scoped.ctx?.tools?.schemas
  if (schemas === undefined) {
    // Narrow unit fixtures may use a structural Agent stub. A real RC.2 Agent
    // always has the scoped registry and therefore always takes the exact path.
    return phaseTools
  }
  const installed = new Set(
    schemas.call(scoped.ctx?.tools, agent).map(value => value.name),
  )
  return new Set([...phaseTools].filter(name => installed.has(name)))
}

function advanceDepartmentPhase(
  state: AgentPlaneState,
  agentId: string,
  toolName: string,
): void {
  const current = state.departmentPhaseByAgent.get(agentId) ?? 'ORDER'
  if (toolName === 'military_get_order') {
    state.departmentPhaseByAgent.set(agentId, 'DISCOVER')
    return
  }
  if (toolName === 'military_staff_read_mission') {
    state.departmentPhaseByAgent.set(agentId, 'MUTATE')
    return
  }
  if (READ_BEFORE_MUTATION_TOOLS.has(toolName)) {
    if (current === 'DISCOVER' || current === 'VERIFY') {
      state.departmentPhaseByAgent.set(agentId, 'MUTATE')
    }
    return
  }
  if (MUTATION_TOOLS.has(toolName)) {
    state.departmentPhaseByAgent.set(agentId, 'VERIFY')
    return
  }
  if (toolName === 'military_workspace_operation_status') {
    state.departmentPhaseByAgent.set(agentId, 'VERIFY')
  }
}

const READ_BEFORE_MUTATION_TOOLS = new Set([
  'military_workspace_read',
  'military_specs_read',
  'read',
])

const MUTATION_TOOLS = new Set([
  'military_workspace_write',
  'military_workspace_edit',
  'write',
  'edit',
])

/** One rejected hallucinated name must teach Flash the valid coordination route. */
export function generalToolProfileDenial(
  toolName: string,
  profileId: string,
  revision: number,
  agent?: ToolExecution['agent'],
): string {
  return hostToolFailure(agent, {
    code: 'POLICY_DENIED',
    message: `tool ${toolName} is not visible to General under ${profileId}@${revision}`,
    retryable: false,
    nextTool: 'military_status',
    recovery: 'Do not retry this tool or substitute another unlisted generic tool. Call military_status; if repository facts are required, the next authoritative stage will expose military_spawn_department_agent with advisor-generalist and without a taskId.',
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

function settlementFailure(value: unknown): string {
  const category = value instanceof MilitaryError
    ? `MILITARY_${value.failure.code}`
    : value instanceof Error
      ? value.name.replaceAll(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
      : 'UNKNOWN'
  return `${category};fingerprint=${sha256(errorMessage(value)).slice(0, 24)}`
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
  agent: NonNullable<ToolExecution['agent']>,
  toolName: string,
  callId: string,
  maximum: number,
): string | null {
  const agentId = String(agent.id)
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    return hostToolFailure(agent, {
      code: 'TOOL_PROFILE_INVALID',
      message: `maxParallelCalls must be a positive integer, received ${String(maximum)}`,
      retryable: false,
      nextTool: 'WAIT_FOR_HOST',
      recovery: 'Pause this Agent while the Host corrects its ToolProfile.',
    })
  }
  const active = state.activeToolCallsByAgent.get(agentId) ?? new Set<string>()
  if (active.has(callId)) {
    return hostToolFailure(agent, {
      code: 'DUPLICATE_TOOL_CALL_ID',
      message: 'the same Host-issued tool call is already executing',
      retryable: false,
      nextTool: 'WAIT_FOR_HOST',
      recovery: 'Wait for the existing call result; do not duplicate its call ID.',
    })
  }
  if (active.size >= maximum) {
    return hostToolFailure(agent, {
      code: 'TOOL_PARALLEL_LIMIT',
      message: `ToolProfile permits ${maximum} simultaneous call(s); ${active.size} are still running`,
      retryable: true,
      nextTool: toolName,
      recovery: 'Wait for one running call to finish, then call nextTool only if the operation remains necessary.',
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
  callId: unknown,
  timeoutMs: number,
  agent: NonNullable<ToolExecution['agent']>,
  role: Awaited<ReturnType<MilitaryHostRuntime['identityFor']>>['role'],
  code: string,
  message: string,
): ToolExecutionResult {
  const operationId = name === 'military_workspace_write'
    ? `workspace-write-${sha256(String(callId)).slice(0, 40)}`
    : name === 'military_workspace_edit'
      ? `workspace-edit-${sha256(String(callId)).slice(0, 40)}`
      : undefined
  const nextTool = operationId === undefined
    ? roleRecoveryTool(role)
    : 'military_workspace_operation_status'
  const failure = hostToolFailure(agent, {
    code,
    message,
    retryable: code === 'MILITARY_TOOL_TIMEOUT',
    nextTool,
    correctedShape: operationId === undefined
      ? installedToolCorrection(agent, nextTool)
      : {
          ...installedToolCorrection(agent, nextTool),
          arguments: { operationId },
        },
    recovery: code === 'MILITARY_TOOL_TIMEOUT'
      ? operationId === undefined
        ? 'The call reached quiescence. Use nextTool with observed facts; do not blindly duplicate a side effect.'
        : 'The call reached quiescence. Call nextTool once with correctedShape; do not repeat the write/edit.'
      : 'Wait while the Host corrects the ToolProfile before executing this tool.',
    details: {
      tool: name,
      timeoutMs,
      ...(operationId === undefined ? {} : { operationId }),
    },
  })
  return {
    content: [{
      type: 'text',
      text: failure,
    }],
    isError: true,
    error: {
      message,
      info: { name: 'MilitaryToolTimeoutError', code },
    },
  }
}

function isMilitaryTimeout(result: Readonly<ToolExecutionResult>): boolean {
  return typeof result.error === 'object'
    && result.error !== null
    && 'info' in result.error
    && typeof result.error.info === 'object'
    && result.error.info !== null
    && 'code' in result.error.info
    && result.error.info.code === 'MILITARY_TOOL_TIMEOUT'
}
