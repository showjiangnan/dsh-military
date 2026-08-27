import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  compileEffectivePrompt,
  MilitaryError,
  resolveDepartmentRolePrompt,
  type AgentExecutionBinding,
  type AgentTemplateProfile,
  type ToolProfile,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'
import { defaultToolProfileRevision, rc2GeneralToolNames } from './defaults.js'
import { clearAgentPlaneState, type AgentPlaneState } from './agent-plane-state.js'
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
        () => phaseVisibleTools(host, agent, state),
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
      () => phaseVisibleTools(lifecycleHost, agent, state),
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

const TERMINAL_PHASE_TOOLS = new Set([
  'military_submit_candidate',
  'military_submit_blocker',
  'military_radio_request',
  'military_submit_decision_questions',
  'military_specs_apply_order',
  'military_radio_issue',
  'military_staff_issue_guidance',
  'military_submit_inspection',
  'military_submit_research_artifact',
  'report',
])

const GENERAL_BOOTSTRAP_TOOLS = new Set([
  'ask_user_question',
  'military_get_context',
  'military_mission_start',
  'military_tactical_ingest',
  'military_tactical_review',
  'military_status',
])

async function phaseVisibleTools(
  host: MilitaryHostRuntime,
  agent: Agent,
  state: AgentPlaneState,
): Promise<ReadonlySet<string> | undefined> {
  if (state.finalizationOnlyAgents.has(String(agent.id))) {
    return TERMINAL_PHASE_TOOLS
  }
  const identity = await host.identityFor(agent)
  if (identity.role !== 'general') return undefined
  const missionId = await host.application.runtime.missionForSession(identity.sessionId)
  return missionId === null ? GENERAL_BOOTSTRAP_TOOLS : undefined
}
