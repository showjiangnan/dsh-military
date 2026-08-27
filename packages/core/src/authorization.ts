import {
  MilitaryError,
  type DataClassification,
  type MilitaryAuthorityContext,
  type MilitaryAuthorization,
  type UserAuthorizationReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, isExpired } from './util.js'

const classificationRank: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
}

export class InMemoryMilitaryAuthorization implements MilitaryAuthorization {
  readonly #contexts = new Map<string, MilitaryAuthorityContext>()
  readonly #receipts = new Map<string, UserAuthorizationReceipt & { revoked?: string }>()

  seedContext(context: MilitaryAuthorityContext): void {
    this.#contexts.set(key(context.principalId, context.tenantId), cloneFrozen(context))
  }

  async registerContext(context: MilitaryAuthorityContext): Promise<void> {
    this.seedContext(context)
  }

  async resolve(principalId: string, tenantId: string): Promise<MilitaryAuthorityContext> {
    const context = this.#contexts.get(key(principalId, tenantId))
    if (context === undefined || isExpired(context.expiresAt)) {
      throw new MilitaryError('UNAUTHORIZED', 'no active authority context', { principalId, tenantId })
    }
    return cloneFrozen(context)
  }

  async grant(receipt: UserAuthorizationReceipt): Promise<void> {
    if (isExpired(receipt.expiresAt)) throw new MilitaryError('UNAUTHORIZED', 'authorization receipt is already expired')
    const existing = this.#receipts.get(receipt.authorizationId)
    if (existing !== undefined) {
      if (existing.contentHash !== receipt.contentHash) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    this.#receipts.set(receipt.authorizationId, cloneFrozen(receipt))
  }

  async revoke(authorizationId: string, reason: string): Promise<void> {
    const receipt = this.#receipts.get(authorizationId)
    if (receipt === undefined) throw new MilitaryError('NOT_FOUND', `unknown authorization ${authorizationId}`)
    if (!receipt.revocable) throw new MilitaryError('POLICY_DENIED', 'authorization is not revocable')
    this.#receipts.set(authorizationId, cloneFrozen({ ...receipt, revoked: reason }))
  }

  async authorize(input: {
    readonly context: MilitaryAuthorityContext
    readonly action: string
    readonly resource: string
    readonly classification: DataClassification
  }): Promise<{ readonly allowed: boolean; readonly receiptRef?: string; readonly reason?: string }> {
    if (isExpired(input.context.expiresAt)) return { allowed: false, reason: 'authority context expired' }
    if (classificationRank[input.classification] > classificationRank[input.context.dataClassificationCeiling]) {
      return { allowed: false, reason: 'classification ceiling exceeded' }
    }
    const scopeAllowed = input.context.scopes.some(scope => match(scope, `${input.action}:${input.resource}`)
      || match(scope, input.action)
      || match(scope, input.resource))
    if (scopeAllowed) return { allowed: true }

    for (const ref of input.context.authorizationReceiptRefs) {
      const receipt = this.#receipts.get(ref)
      if (receipt === undefined || receipt.revoked !== undefined || isExpired(receipt.expiresAt)) continue
      if (receipt.principalId !== input.context.principalId || receipt.tenantId !== input.context.tenantId) continue
      if (match(receipt.action, input.action) && match(receipt.resource, input.resource)) {
        return { allowed: true, receiptRef: receipt.authorizationId }
      }
    }
    return { allowed: false, reason: 'no matching scope or authorization receipt' }
  }
}

function key(principalId: string, tenantId: string): string {
  return `${tenantId}\u0000${principalId}`
}

function match(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true
  if (!pattern.endsWith('*')) return false
  return value.startsWith(pattern.slice(0, -1))
}
