import { MilitaryError, type AgentTemplateProfile, type MilitaryAgentTemplates, type TacticalSkillRef } from '@dsh-military/contracts'
import { cloneFrozen } from '@dsh-military/core'

export interface StaffConsultationContext {
  readonly taskType: string
  readonly domainTagIds: readonly string[]
  readonly requiredTools: readonly string[]
  readonly classification: 'public' | 'internal' | 'confidential' | 'restricted'
  readonly maxAdvisors: number
}

export interface StaffSelection {
  readonly lead: AgentTemplateProfile
  readonly consultants: readonly AgentTemplateProfile[]
  readonly coverage: readonly string[]
  readonly uncovered: readonly string[]
}

/** Deterministic qualification and set-cover selector for Staff templates. */
export class StaffCouncilSelector {
  readonly #templates: MilitaryAgentTemplates
  constructor(templates: MilitaryAgentTemplates) { this.#templates = templates }

  async select(context: StaffConsultationContext): Promise<StaffSelection> {
    const candidates = (await this.#templates.list({ department: 'staff', includeInactive: false }))
      .filter(value => value.status === 'ACTIVE' || value.status === 'CANARY')
      .filter(value => value.taskTypes.includes(context.taskType) || value.taskTypes.includes('*'))
      .filter(value => context.requiredTools.every(tool => value.capabilities.tacticalSkillPatterns.includes('*') || value.capabilities.tacticalSkillPatterns.some(pattern => wildcard(pattern, tool))))
    if (candidates.length === 0) throw new MilitaryError('CAPACITY_EXHAUSTED', 'no qualified staff advisor')
    const remaining = new Set(context.domainTagIds)
    const selected: AgentTemplateProfile[] = []
    const ordered = [...candidates].sort((left, right) => {
      const leftCoverage = left.domainTagIds.filter(id => remaining.has(String(id))).length
      const rightCoverage = right.domainTagIds.filter(id => remaining.has(String(id))).length
      return rightCoverage - leftCoverage || left.displayName.localeCompare(right.displayName)
    })
    while (selected.length < Math.max(1, context.maxAdvisors) && ordered.length > 0) {
      const advisor = ordered.shift()
      if (advisor === undefined) break
      selected.push(advisor)
      for (const id of advisor.domainTagIds) remaining.delete(String(id))
      ordered.sort((left, right) => {
        const a = left.domainTagIds.filter(id => remaining.has(String(id))).length
        const b = right.domainTagIds.filter(id => remaining.has(String(id))).length
        return b - a || left.displayName.localeCompare(right.displayName)
      })
      if (remaining.size === 0) break
    }
    const lead = selected[0]
    if (lead === undefined) throw new MilitaryError('CAPACITY_EXHAUSTED')
    return cloneFrozen({
      lead,
      consultants: selected.slice(1),
      coverage: context.domainTagIds.filter(id => !remaining.has(id)),
      uncovered: [...remaining],
    })
  }
}

export function compileTacticalDirective(input: {
  readonly candidateSkills: readonly TacticalSkillRef[]
  readonly selectedSkills: readonly TacticalSkillRef[]
  readonly recommendations: readonly string[]
}): readonly string[] {
  if (input.selectedSkills.length > 3) throw new MilitaryError('INVALID_ARGUMENT', 'at most three skills may be compiled')
  if (input.selectedSkills.some(selected => !input.candidateSkills.some(candidate => candidate.skillId === selected.skillId && candidate.version === selected.version))) {
    throw new MilitaryError('INVALID_ARGUMENT', 'selected skill is outside the recalled candidates')
  }
  return cloneFrozen(input.recommendations.map(value => value.trim()).filter(Boolean))
}

function wildcard(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === value
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`, 'u').test(value)
}
