import {
  MilitaryError,
  type MilitaryPolicyRegistry,
  type ModelCapabilityProfile,
  type PermissionProfile,
  type ResourceBudgetPolicy,
  type Revision,
  type ToolProfile,
  type VerifierProfile,
} from '@dsh-military/contracts'
import { cloneFrozen } from './util.js'

interface Versioned<T> {
  readonly id: string
  readonly revision: number
  readonly value: T
}

export class InMemoryMilitaryPolicyRegistry implements MilitaryPolicyRegistry {
  readonly #tools = new Map<string, Versioned<ToolProfile>[]>()
  readonly #permissions = new Map<string, Versioned<PermissionProfile>[]>()
  readonly #models = new Map<string, Versioned<ModelCapabilityProfile>[]>()
  readonly #verifiers = new Map<string, Versioned<VerifierProfile>[]>()
  readonly #budgets = new Map<string, Versioned<ResourceBudgetPolicy>[]>()

  registerTool(profile: ToolProfile): void { put(this.#tools, profile.toolProfileId, Number(profile.revision), profile) }
  registerPermission(profile: PermissionProfile): void { put(this.#permissions, profile.permissionProfileId, Number(profile.revision), profile) }
  registerModel(profile: ModelCapabilityProfile): void { put(this.#models, `${profile.provider}\u0000${profile.model}`, Number(profile.revision), profile) }
  registerVerifier(profile: VerifierProfile): void { put(this.#verifiers, profile.verifierProfileId, Number(profile.revision), profile) }
  registerBudget(profile: ResourceBudgetPolicy): void { put(this.#budgets, profile.policyId, Number(profile.revision), profile) }

  async toolProfile(id: string, revision?: number): Promise<ToolProfile> {
    return get(this.#tools, id, revision)
  }

  async permissionProfile(id: string, revision?: number): Promise<PermissionProfile> {
    return get(this.#permissions, id, revision)
  }

  async modelCapability(provider: string, model: string): Promise<ModelCapabilityProfile> {
    return get(this.#models, `${provider}\u0000${model}`)
  }

  async verifierProfile(id: string, revision?: number): Promise<VerifierProfile> {
    return get(this.#verifiers, id, revision)
  }

  async resourceBudgetPolicy(id: string, revision?: number): Promise<ResourceBudgetPolicy> {
    return get(this.#budgets, id, revision)
  }
}

function put<T>(store: Map<string, Versioned<T>[]>, id: string, revision: number, value: T): void {
  const values = store.get(id) ?? []
  if (values.some(item => item.revision === revision)) throw new MilitaryError('REVISION_CONFLICT', `duplicate revision ${revision} for ${id}`)
  values.push({ id, revision, value: cloneFrozen(value) })
  values.sort((left, right) => left.revision - right.revision)
  store.set(id, values)
}

function get<T>(store: Map<string, Versioned<T>[]>, id: string, revision?: Revision | number): T {
  const values = store.get(id)
  if (values === undefined || values.length === 0) throw new MilitaryError('NOT_FOUND', `unknown policy ${id}`)
  const item = revision === undefined ? values.at(-1) : values.find(value => value.revision === Number(revision))
  if (item === undefined) throw new MilitaryError('NOT_FOUND', `unknown policy revision ${id}@${String(revision)}`)
  return cloneFrozen(item.value)
}
