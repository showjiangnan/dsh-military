import {
  MilitaryError,
  type SemVer,
  type TacticalLifecycle,
  type TacticalSkillId,
  type TacticalSkillRef,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from './util.js'

export interface TacticalProcedure {
  readonly schemaVersion: '1.0.0'
  readonly skillId: TacticalSkillId
  readonly version: SemVer
  readonly title: string
  readonly lifecycle: TacticalLifecycle
  readonly scenarioTags: readonly string[]
  readonly preconditions: readonly string[]
  readonly exclusions: readonly string[]
  readonly steps: readonly { readonly id: string; readonly action: string; readonly expectedObservation?: string }[]
  readonly stopConditions: readonly string[]
  readonly verifierRequirements: readonly string[]
  readonly provenanceRefs: readonly string[]
  readonly contentHash: string
}

export interface TacticalProcedureStore {
  versions(skillId: TacticalSkillId): readonly TacticalProcedure[]
  replace(skillId: TacticalSkillId, versions: readonly TacticalProcedure[]): void
  all(): readonly TacticalProcedure[]
}

export class InMemoryTacticalProcedureStore implements TacticalProcedureStore {
  readonly #procedures = new Map<string, TacticalProcedure[]>()

  versions(skillId: TacticalSkillId): readonly TacticalProcedure[] {
    return cloneFrozen(this.#procedures.get(String(skillId)) ?? [])
  }

  replace(skillId: TacticalSkillId, versions: readonly TacticalProcedure[]): void {
    this.#procedures.set(String(skillId), cloneFrozen([...versions]))
  }

  all(): readonly TacticalProcedure[] {
    return cloneFrozen([...this.#procedures.values()].flatMap(items => items))
  }
}

export class InMemoryTacticalRegistry {
  readonly #procedures: TacticalProcedureStore
  readonly #listeners = new Set<() => void>()
  readonly #afterCommit: (callback: () => void) => void

  constructor(
    procedures?: TacticalProcedureStore,
    afterCommit?: (callback: () => void) => void,
  ) {
    this.#procedures = procedures ?? new InMemoryTacticalProcedureStore()
    this.#afterCommit = afterCommit ?? (callback => callback())
  }

  publish(procedure: TacticalProcedure): void {
    const versions = [...this.#procedures.versions(procedure.skillId)]
    const existing = versions.find(item => item.version === procedure.version)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(procedure)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    if (procedure.lifecycle === 'STABLE' && procedure.verifierRequirements.length === 0) {
      throw new MilitaryError('TACTICAL_REVIEW_REQUIRED', 'stable tactic requires verifier requirements')
    }
    versions.push(cloneFrozen(procedure))
    this.#procedures.replace(procedure.skillId, versions)
    this.#changed()
  }

  get(skillId: TacticalSkillId, version?: SemVer): TacticalProcedure {
    const versions = this.#procedures.versions(skillId)
    if (versions.length === 0) throw new MilitaryError('NOT_FOUND')
    const value = version === undefined ? versions.at(-1) : versions.find(item => item.version === version)
    if (value === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(value)
  }

  retrieve(input: {
    readonly tags: readonly string[]
    readonly includeTesting?: boolean
    readonly maxCandidates?: number
  }): readonly TacticalProcedure[] {
    const allowed = new Set<TacticalLifecycle>(input.includeTesting === true
      ? ['CANARY', 'TESTING', 'STABLE']
      : ['STABLE'])
    const scored = this.#procedures.all()
      .filter(item => allowed.has(item.lifecycle))
      .map(item => ({
        item,
        score: item.scenarioTags.filter(tag => input.tags.includes(tag)).length,
      }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
      .slice(0, input.maxCandidates ?? 5)
      .map(item => item.item)
    return cloneFrozen(scored)
  }

  /** List every exact version for governance and dynamic Skill providers. */
  list(): readonly TacticalProcedure[] {
    return cloneFrozen(this.#procedures.all())
  }

  refs(procedures: readonly TacticalProcedure[]): readonly TacticalSkillRef[] {
    return procedures.map(procedure => ({ skillId: procedure.skillId, version: procedure.version }))
  }

  quarantine(skillId: TacticalSkillId, version: SemVer): TacticalProcedure {
    return this.transition(skillId, version, 'QUARANTINED')
  }

  /**
   * Move one exact immutable content version through the governed lifecycle.
   * Content and SemVer never change here; only delivery eligibility changes.
   */
  transition(skillId: TacticalSkillId, version: SemVer, to: TacticalLifecycle): TacticalProcedure {
    const value = this.get(skillId, version)
    if (value.lifecycle === to) return value
    const allowed: Readonly<Record<TacticalLifecycle, readonly TacticalLifecycle[]>> = {
      DRAFT: ['SIMULATION', 'QUARANTINED', 'DEPRECATED'],
      SIMULATION: ['DRAFT', 'CANARY', 'QUARANTINED', 'DEPRECATED'],
      CANARY: ['SIMULATION', 'TESTING', 'QUARANTINED', 'DEPRECATED'],
      TESTING: ['STABLE', 'CANARY', 'QUARANTINED', 'DEPRECATED'],
      STABLE: ['TESTING', 'QUARANTINED', 'DEPRECATED'],
      QUARANTINED: ['DRAFT', 'DEPRECATED'],
      DEPRECATED: [],
    }
    if (!allowed[value.lifecycle].includes(to)) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        `invalid tactical lifecycle transition ${value.lifecycle} -> ${to}`,
      )
    }
    if (to === 'STABLE' && value.verifierRequirements.length === 0) {
      throw new MilitaryError('TACTICAL_REVIEW_REQUIRED', 'stable tactic requires verifier requirements')
    }
    const updated = cloneFrozen({ ...value, lifecycle: to })
    const versions = [...this.#procedures.versions(skillId)]
    if (versions.length === 0) throw new MilitaryError('NOT_FOUND')
    const index = versions.findIndex(item => item.version === version)
    versions[index] = updated
    this.#procedures.replace(skillId, versions)
    this.#changed()
    return updated
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #changed(): void {
    this.#afterCommit(() => {
      for (const listener of this.#listeners) {
        try { listener() } catch { /* observers cannot veto a committed lifecycle change */ }
      }
    })
  }
}

export function tacticalId(value: string): TacticalSkillId { return brand<string, 'TacticalSkillId'>(value) }
export function semver(value: string): SemVer { return brand<string, 'SemVer'>(value) }
