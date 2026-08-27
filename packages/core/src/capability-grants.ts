import {
  MilitaryError,
  type CapabilityGrant,
  type MilitaryCapabilityGrants,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from './util.js'
import { pathWithinAny } from './path-policy.js'

export class InMemoryCapabilityGrantStore implements MilitaryCapabilityGrants {
  readonly #grants = new Map<string, CapabilityGrant>()
  readonly #consumptions = new Map<string, { fingerprint: string; receipt: CapabilityGrant }>()

  async issue(grant: CapabilityGrant): Promise<void> {
    if (this.#grants.has(grant.grantId)) throw new MilitaryError('REVISION_CONFLICT', 'capability grant already exists')
    if (grant.state !== 'ACTIVE' || grant.uses !== 0) throw new MilitaryError('INVALID_ARGUMENT', 'new capability grant must be active and unused')
    this.#grants.set(grant.grantId, cloneFrozen(grant))
  }

  async consume(grantId: string, input: {
    readonly tool: string
    readonly resource?: string
    readonly at: string
    readonly idempotencyKey?: string
  }): Promise<CapabilityGrant> {
    const fingerprint = stableJson({ tool: input.tool, resource: input.resource })
    const consumptionKey = input.idempotencyKey === undefined
      ? undefined
      : `${grantId}\u0000${input.idempotencyKey}`
    const duplicate = consumptionKey === undefined ? undefined : this.#consumptions.get(consumptionKey)
    if (duplicate !== undefined) {
      if (duplicate.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return cloneFrozen(duplicate.receipt)
    }
    const grant = await this.get(grantId)
    if (grant.state !== 'ACTIVE') throw new MilitaryError('POLICY_DENIED', `capability grant is ${grant.state}`)
    if (new Date(input.at).getTime() >= new Date(grant.expiresAt).getTime()) {
      const expired = cloneFrozen({ ...grant, state: 'EXPIRED' as const })
      this.#grants.set(grantId, expired)
      throw new MilitaryError('POLICY_DENIED', 'capability grant expired')
    }
    if (!grant.allowedTools.includes(input.tool)) throw new MilitaryError('POLICY_DENIED', `tool ${input.tool} is not granted`)
    if (input.resource !== undefined && !pathWithinAny(input.resource, grant.resourcePatterns)) throw new MilitaryError('POLICY_DENIED', 'resource is outside capability grant')
    const uses = grant.uses + 1
    const next = cloneFrozen({ ...grant, uses, state: uses >= grant.maximumUses ? 'EXHAUSTED' as const : 'ACTIVE' as const })
    this.#grants.set(grantId, next)
    if (consumptionKey !== undefined) {
      this.#consumptions.set(consumptionKey, { fingerprint, receipt: next })
    }
    return next
  }

  async revoke(grantId: string, _reason: string): Promise<void> {
    const grant = await this.get(grantId)
    this.#grants.set(grantId, cloneFrozen({ ...grant, state: 'REVOKED' as const }))
  }

  async discard(grantId: string): Promise<void> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) return
    if (grant.uses !== 0) {
      throw new MilitaryError('REVISION_CONFLICT', 'used capability grant cannot be discarded')
    }
    this.#grants.delete(grantId)
    const prefix = `${grantId}\u0000`
    for (const key of this.#consumptions.keys()) {
      if (key.startsWith(prefix)) this.#consumptions.delete(key)
    }
  }

  async get(grantId: string): Promise<CapabilityGrant> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) throw new MilitaryError('NOT_FOUND', 'capability grant not found')
    return cloneFrozen(grant)
  }
}
