import {
  MilitaryError,
  type AgentTemplateId,
  type AgentTemplateProfile,
  type MilitaryAgentTemplates,
  type Revision,
} from '@dsh-military/contracts'
import { cloneFrozen } from './util.js'

export class InMemoryAgentTemplateRegistry implements MilitaryAgentTemplates {
  readonly #profiles = new Map<string, AgentTemplateProfile[]>()

  async list(options?: {
    readonly department?: string
    readonly role?: string
    readonly includeInactive?: boolean
  }): Promise<readonly AgentTemplateProfile[]> {
    const result = [...this.#profiles.values()].flatMap(items => items)
      .filter(profile => options?.department === undefined || profile.department === options.department)
      .filter(profile => options?.role === undefined || profile.role === options.role)
      .filter(profile => options?.includeInactive === true || profile.status === 'ACTIVE' || profile.status === 'CANARY')
      .sort((left, right) => String(left.templateId).localeCompare(String(right.templateId)) || Number(left.revision) - Number(right.revision))
    return cloneFrozen(result)
  }

  async get(templateId: AgentTemplateId, revision?: Revision): Promise<AgentTemplateProfile> {
    const versions = this.#profiles.get(String(templateId))
    if (versions === undefined || versions.length === 0) throw new MilitaryError('NOT_FOUND', `unknown template ${String(templateId)}`)
    const result = revision === undefined ? versions.at(-1) : versions.find(profile => Number(profile.revision) === Number(revision))
    if (result === undefined) throw new MilitaryError('NOT_FOUND', `unknown template revision ${String(templateId)}@${Number(revision)}`)
    return cloneFrozen(result)
  }

  async create(profile: AgentTemplateProfile): Promise<void> {
    const id = String(profile.templateId)
    if (this.#profiles.has(id)) throw new MilitaryError('REVISION_CONFLICT', `template ${id} already exists`)
    validate(profile)
    this.#profiles.set(id, [cloneFrozen(profile)])
  }

  async revise(profile: AgentTemplateProfile, expectedRevision: Revision): Promise<void> {
    const id = String(profile.templateId)
    const versions = this.#profiles.get(id)
    if (versions === undefined) throw new MilitaryError('NOT_FOUND')
    const latest = versions.at(-1)
    if (latest === undefined || Number(latest.revision) !== Number(expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
    if (Number(profile.revision) !== Number(expectedRevision) + 1) {
      throw new MilitaryError('REVISION_CONFLICT', 'new template revision must increment by exactly one')
    }
    validate(profile)
    versions.push(cloneFrozen(profile))
  }

  async reviseBatch(
    revisions: readonly {
      readonly profile: AgentTemplateProfile
      readonly expectedRevision: Revision
    }[],
  ): Promise<void> {
    const seen = new Set<string>()
    for (const change of revisions) {
      const id = String(change.profile.templateId)
      if (seen.has(id)) throw new MilitaryError('INVALID_ARGUMENT', `duplicate template ${id}`)
      seen.add(id)
      const versions = this.#profiles.get(id)
      const latest = versions?.at(-1)
      if (latest === undefined
        || Number(latest.revision) !== Number(change.expectedRevision)
        || Number(change.profile.revision) !== Number(change.expectedRevision) + 1) {
        throw new MilitaryError('REVISION_CONFLICT')
      }
      validate(change.profile)
    }
    for (const change of revisions) {
      this.#profiles.get(String(change.profile.templateId))!
        .push(cloneFrozen(change.profile))
    }
  }

  async setStatus(templateId: AgentTemplateId, status: AgentTemplateProfile['status']): Promise<void> {
    const latest = await this.get(templateId)
    const next = cloneFrozen({ ...latest, status })
    const versions = this.#profiles.get(String(templateId))
    if (versions === undefined) throw new MilitaryError('NOT_FOUND')
    versions[versions.length - 1] = next
  }

  async resolveForInstantiation(templateId: AgentTemplateId): Promise<AgentTemplateProfile> {
    const profile = await this.get(templateId)
    if (profile.status !== 'ACTIVE' && profile.status !== 'CANARY') {
      throw new MilitaryError('AGENT_TEMPLATE_INACTIVE', `template ${String(templateId)} is ${profile.status}`)
    }
    validate(profile)
    return profile
  }
}

function validate(profile: AgentTemplateProfile): void {
  if (profile.modelPolicy.reasoningEffort === undefined) throw new MilitaryError('CONTEXT_POLICY_INVALID')
  const context = profile.contextPolicy
  if (!Number.isSafeInteger(context.contextBudgetTokens) || context.contextBudgetTokens < 4096) throw new MilitaryError('CONTEXT_POLICY_INVALID')
  if (!Number.isSafeInteger(context.compactionTriggerPercent)
    || context.compactionTriggerPercent < 50 || context.compactionTriggerPercent > 99) throw new MilitaryError('CONTEXT_POLICY_INVALID')
  if (context.retainedTailTokens < 0 || context.retainedTailTokens >= context.contextBudgetTokens) throw new MilitaryError('CONTEXT_POLICY_INVALID')
  if (profile.concurrencyLimit < 1 || !Number.isSafeInteger(profile.concurrencyLimit)) throw new MilitaryError('INVALID_ARGUMENT')
}
