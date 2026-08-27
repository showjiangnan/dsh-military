import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  compileEffectivePrompt,
  MilitaryError,
  resolveDepartmentRolePrompt,
  type AgentExecutionBinding,
  type AgentTemplateProfile,
  type MilitaryRole,
  type ToolProfile,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'
import { defaultToolProfileRevision, rc2GeneralToolNames } from './defaults.js'
import {
  clearAgentPlaneState,
  type AgentPlaneState,
  type DepartmentToolPhase,
  type GeneralWorkflowStage,
} from './agent-plane-state.js'
import { reconcileModelRequestBudgets } from './model-budget.js'
import { installMilitaryPromptSurface } from './prompt-surface.js'

/** Register session admission, restart reconciliation, capacity recovery, and teardown. */
export function registerAgentLifecycle(
  ctx: Context,
  host: MilitaryHostRuntime,
  state: AgentPlaneState,
): void {
  ctx.on('agent/session-start', ({ agent }: { readonly agent: Agent }) => {
    if (!host.isMilitaryAgent(agent)) return
    if (agent.session.header.parentSession === undefined) {
      // Snapshot the fully composed preset before the General visibility mask
      // hides department-only contracts. This is the last synchronous point
      // where Host can observe the exact RC.2 schemas without broadening any
      // model's actual tool surface.
      host.registerRoleToolSchemas(agent.ctx.tools.schemas(agent))
      // `agent/session-start` does not await listener promises. Install the
      // root model's visibility mask before the first await so its first prompt
      // cannot observe the union catalog.
      restrictToolVisibility(
        agent,
        rc2GeneralToolNames,
        `general-tools@${Number(defaultToolProfileRevision)}`,
        () => resolvePhaseVisibleTools(host, agent, state),
        () => generalPersona(host.generalRolePrompt()),
      )
    }
    return initializeMilitaryAgent(ctx, host, agent)
  })

  ctx.on('agent/disposed', ({ agent }: { readonly agent: Agent }) => {
    const agentId = String(agent.id)
    const isDepartmentChild = agent.session.header.parentSession !== undefined
      && host.identities.get(agentId)?.role !== 'general'
    host.identities.unbind(agentId)
    clearAgentPlaneState(state, agentId, String(agent.session.id))
    if (!isDepartmentChild) return
    void host.forgetDepartmentChild(agentId).catch(error => {
      ctx.logger.error(`dsh-military child lifecycle cleanup failed for ${agentId}`, error)
    })
  })

  async function initializeMilitaryAgent(
    lifecycleContext: Context,
    lifecycleHost: MilitaryHostRuntime,
    agent: Agent,
  ): Promise<void> {
    const identity = await lifecycleHost.identityFor(agent)
    await lifecycleHost.ensureSessionBinding(agent)
    await reconcileModelRequestBudgets(lifecycleHost, identity, agent.session.events)
    if (identity.role === 'general') return

    const binding = await lifecycleHost.application.executionBindings.forAgent(
      String(identity.agentId),
      identity.generation,
    )
    if (binding === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
    const profile = await lifecycleHost.application.policies.toolProfile(
      binding.toolProfile.id,
      Number(binding.toolProfile.revision),
    )
    const template = await lifecycleHost.application.templates.get(
      binding.agent.templateId!,
      binding.agent.templateRevision,
    )
    restrictMilitaryToolVisibility(
      agent,
      profile,
      () => resolvePhaseVisibleTools(lifecycleHost, agent, state),
      () => departmentPersona(template, binding, profile.allowTools),
    )
    const concurrency = await lifecycleHost.application.resourceBudgets.getReservation(
      binding.concurrencyReservationId,
    )
    if (concurrency.state !== 'RESERVED' || Date.now() >= Date.parse(concurrency.expiresAt)) {
      throw new MilitaryError(
        'CAPACITY_EXHAUSTED',
        `department Agent concurrency reservation is ${concurrency.state}`,
      )
    }
    const parentId = agent.session.header.parentSession
    const parent = parentId === undefined ? undefined : lifecycleContext.agents?.get(parentId)
    if (parent !== undefined) lifecycleHost.trackDepartmentChild(parent, String(agent.id))
  }
}

/**
 * Keep each model's visible Military vocabulary equal to its immutable role
 * profile. Execution guards remain the authority boundary; this mask prevents
 * small models from selecting structurally valid but role-invalid tools.
 */
export function restrictMilitaryToolVisibility(
  agent: Agent,
  profile: ToolProfile,
  resolveVisibleTools?: () => Promise<ReadonlySet<string> | undefined>,
  resolveRolePrompt?: () => string | undefined | Promise<string | undefined>,
): void {
  const deniedByProfile = new Set(profile.denyTools)
  restrictToolVisibility(
    agent,
    profile.allowTools.filter(name => !deniedByProfile.has(name)),
    `${profile.toolProfileId}@${Number(profile.revision)}`,
    resolveVisibleTools,
    resolveRolePrompt,
  )
}

function restrictToolVisibility(
  agent: Agent,
  allowedNames: readonly string[],
  profileRef: string,
  resolveVisibleTools?: () => Promise<ReadonlySet<string> | undefined>,
  resolveRolePrompt?: () => string | undefined | Promise<string | undefined>,
): void {
  agent.ctx.tools.restrict({ allow: [...allowedNames] })
  installMilitaryPromptSurface(agent, profileRef, resolveVisibleTools, resolveRolePrompt)
}

/** Editable prose is followed by a Host-owned boundary that settings cannot remove. */
export function generalPersona(
  rolePrompt: string,
  toolNames: readonly string[] = rc2GeneralToolNames,
): string {
  return compileEffectivePrompt({
    roleId: 'general',
    rolePrompt,
    displayName: 'General 总指挥',
    templateRevision: 0,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    maxOutputTokens: 16_384,
    contextBudgetTokens: 128_000,
    toolNames,
    permissionProfileId: 'general-host-authority',
  }).text
}

/** Freeze one immutable department template revision into its system persona. */
export function departmentPersona(
  template: AgentTemplateProfile,
  binding: Pick<AgentExecutionBinding, 'bindingId' | 'capabilityGrantId'>,
  toolNames: readonly string[] = [],
): string {
  return compileEffectivePrompt({
    roleId: String(template.templateId),
    rolePrompt: resolveDepartmentRolePrompt(template),
    displayName: template.displayName,
    templateRevision: Number(template.revision),
    provider: template.modelPolicy.provider,
    model: template.modelPolicy.model,
    reasoningEffort: template.modelPolicy.reasoningEffort,
    maxOutputTokens: template.modelPolicy.maxOutputTokens,
    contextBudgetTokens: template.contextPolicy.contextBudgetTokens,
    toolNames,
    permissionProfileId: template.capabilities.permissionProfileId,
    bindingId: binding.bindingId,
    capabilityGrantId: binding.capabilityGrantId,
  }).text
}

const GENERAL_IDLE_TOOLS = new Set([
  'ask_user_question',
  'military_tactical_ingest',
  'military_tactical_review',
  'military_status',
])

const GENERAL_WORKFLOW_STAGE_TOOLS: Readonly<
  Record<GeneralWorkflowStage, ReadonlySet<string>>
> = Object.freeze({
  START_MISSION: new Set(['military_mission_start']),
  CREATE_TASK: new Set(['military_task_create']),
  READ_DEPARTMENT_STATUS: new Set(['military_status']),
  SPAWN_DEPARTMENT: new Set(['military_spawn_department_agent']),
  POLL_TACTICAL_REQUEST: new Set(['military_radio_poll']),
  ISSUE_TACTICAL_GUIDANCE: new Set(['military_radio_issue']),
  PRESENT_DECISION: new Set(['military_decision_present']),
  ASK_USER_DECISION: new Set(['ask_user_question']),
  RECORD_DECISION: new Set(['military_decision_answer']),
})

/**
 * Synchronous first-request surface used while a continuable child is still
 * unpublished. RC.2 may start that request before the asynchronous binding
 * lookup settles, so this safe role-derived phase cannot depend on SQLite.
 */
export function initialPhaseVisibleTools(
  role: MilitaryRole | undefined,
): ReadonlySet<string> {
  if (role === 'worker') return WORKER_PHASE_TOOLS.ORDER
  if (role === 'engineer') return ENGINEER_PHASE_TOOLS.ORDER
  if (role === 'advisor' || role === 'chief-of-staff') {
    return STAFF_PHASE_TOOLS.DISCOVER
  }
  if (role === 'inspector') return INSPECTOR_PHASE_TOOLS
  if (role === 'trajectory'
    || role === 'effectiveness'
    || role === 'museum'
    || role === 'evaluation-examiner'
    || role === 'evaluation-chair') {
    return RESEARCH_PHASE_TOOLS
  }
  if (role === 'general') return GENERAL_IDLE_TOOLS
  return HARNESS_PHASE_TOOLS
}

export async function resolvePhaseVisibleTools(
  host: MilitaryHostRuntime,
  agent: Agent,
  state: AgentPlaneState,
): Promise<ReadonlySet<string> | undefined> {
  const identity = await host.identityFor(agent)
  if (state.finalizationOnlyAgents.has(String(agent.id))) {
    return TERMINAL_PHASE_TOOLS_BY_ROLE[identity.role]
  }
  if (identity.role === 'worker') {
    const phase = state.departmentPhaseByAgent.get(String(agent.id)) ?? 'ORDER'
    return WORKER_PHASE_TOOLS[phase]
  }
  if (identity.role === 'engineer') {
    const phase = state.departmentPhaseByAgent.get(String(agent.id)) ?? 'ORDER'
    return ENGINEER_PHASE_TOOLS[phase]
  }
  if (identity.role === 'advisor' || identity.role === 'chief-of-staff') {
    const phase = state.departmentPhaseByAgent.get(String(agent.id)) ?? 'DISCOVER'
    return STAFF_PHASE_TOOLS[phase]
  }
  if (identity.role !== 'general') {
    return initialPhaseVisibleTools(identity.role)
  }
  const stage = state.generalWorkflowStageByAgent.get(String(agent.id))
  return stage === undefined
    ? GENERAL_IDLE_TOOLS
    : GENERAL_WORKFLOW_STAGE_TOOLS[stage]
}

export const WORKER_PHASE_TOOLS: Readonly<
  Record<DepartmentToolPhase, ReadonlySet<string>>
> = Object.freeze({
  ORDER: new Set([
    'military_get_order',
    'military_get_tactical_directive',
    'military_submit_blocker',
    'military_submit_decision_questions',
  ]),
  DISCOVER: new Set([
    'military_workspace_read',
    'military_workspace_list',
    'military_workspace_search',
    'military_submit_blocker',
  ]),
  MUTATE: new Set([
    'military_workspace_write',
    'military_workspace_edit',
    'military_submit_candidate',
    'military_submit_blocker',
  ]),
  VERIFY: new Set([
    'military_workspace_read',
    'military_workspace_search',
    'military_submit_candidate',
    'military_submit_blocker',
  ]),
  RECOVER: new Set([
    'military_workspace_operation_status',
    'military_submit_blocker',
  ]),
})

export const ENGINEER_PHASE_TOOLS: Readonly<
  Record<DepartmentToolPhase, ReadonlySet<string>>
> = Object.freeze({
  ORDER: new Set([
    'military_get_order',
    'military_get_tactical_directive',
    'military_submit_blocker',
    'military_submit_decision_questions',
  ]),
  DISCOVER: new Set([
    'military_specs_read',
    'read',
    'grep',
    'military_submit_blocker',
  ]),
  MUTATE: new Set([
    'military_specs_read',
    'military_specs_stage_chunk',
    'military_specs_apply_order',
    'military_submit_blocker',
  ]),
  VERIFY: new Set([
    'military_specs_read',
    'military_specs_apply_order',
    'military_submit_blocker',
  ]),
  RECOVER: new Set([
    'military_specs_read',
    'military_submit_blocker',
  ]),
})

export const STAFF_PHASE_TOOLS: Readonly<
  Record<DepartmentToolPhase, ReadonlySet<string>>
> = Object.freeze({
  ORDER: new Set([
    'military_staff_read_mission',
    'military_staff_retrieve_tactics',
    'military_read_artifact',
    'military_get_context',
  ]),
  DISCOVER: new Set([
    'military_staff_read_mission',
    'military_staff_retrieve_tactics',
    'military_read_artifact',
    'military_get_context',
  ]),
  MUTATE: new Set([
    'military_staff_retrieve_tactics',
    'military_staff_issue_guidance',
    'military_staff_chief_advice',
    'military_submit_decision_questions',
  ]),
  VERIFY: new Set([
    'military_staff_read_mission',
    'military_staff_issue_guidance',
    'military_staff_chief_advice',
    'military_submit_decision_questions',
  ]),
  RECOVER: new Set([
    'military_staff_read_mission',
    'military_submit_decision_questions',
    'report',
  ]),
})

export const INSPECTOR_PHASE_TOOLS = new Set([
  'military_inspect_agent',
  'military_submit_inspection',
  'military_read_artifact',
  'military_get_context',
])

export const RESEARCH_PHASE_TOOLS = new Set([
  'military_read_accepted_ledger',
  'military_submit_research_artifact',
  'military_read_artifact',
  'web_search',
])

const HARNESS_PHASE_TOOLS = new Set(['report'])

const TERMINAL_PHASE_TOOLS_BY_ROLE = Object.freeze({
  general: GENERAL_IDLE_TOOLS,
  advisor: new Set([
    'military_staff_issue_guidance',
    'military_staff_chief_advice',
    'military_submit_decision_questions',
    'report',
  ]),
  'chief-of-staff': new Set([
    'military_staff_issue_guidance',
    'military_staff_chief_advice',
    'military_submit_decision_questions',
    'report',
  ]),
  worker: new Set([
    'military_submit_candidate',
    'military_submit_blocker',
    'military_radio_request',
    'military_submit_decision_questions',
  ]),
  engineer: new Set([
    'military_specs_apply_order',
    'military_submit_blocker',
    'military_radio_request',
    'military_submit_decision_questions',
  ]),
  inspector: new Set(['military_submit_inspection', 'report']),
  trajectory: new Set(['military_submit_research_artifact', 'report']),
  effectiveness: new Set(['military_submit_research_artifact', 'report']),
  museum: new Set(['military_submit_research_artifact', 'report']),
  'evaluation-examiner': new Set(['military_submit_research_artifact', 'report']),
  'evaluation-chair': new Set(['military_submit_research_artifact', 'report']),
  harness: HARNESS_PHASE_TOOLS,
} as const)
