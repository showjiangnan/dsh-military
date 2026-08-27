import {
  MilitaryError,
  type MilitaryResourceBudgets,
  type ResourceBudgetPolicy,
  type ResourceBudgetReservation,
  type ResourceCounters,
  type ResourceUsageReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, isExpired, stableJson, type Clock } from './util.js'

const counterKeys = [
  'modelRequests', 'reasoningTokens', 'wallClockSeconds', 'toolCalls', 'apiCalls',
  'concurrentAgents', 'radioRounds', 'reworkAttempts', 'storageBytes',
] as const satisfies readonly (keyof ResourceCounters)[]

interface ScopeBudget {
  policy: ResourceBudgetPolicy
  consumed: ResourceCounters
  reserved: ResourceCounters
}

export class InMemoryMilitaryResourceBudgets implements MilitaryResourceBudgets {
  readonly #policies = new Map<string, ResourceBudgetPolicy>()
  readonly #scopes = new Map<string, ScopeBudget>()
  readonly #reservations = new Map<string, ResourceBudgetReservation>()
  readonly #reservationByKey = new Map<string, { fingerprint: string; reservationId: string }>()
  readonly #usage = new Map<string, ResourceUsageReceipt>()
  readonly #clock: Clock

  constructor(clock?: Clock) {
    this.#clock = clock ?? (() => new Date())
  }

  registerPolicy(policy: ResourceBudgetPolicy): void {
    this.#policies.set(`${policy.policyId}@${Number(policy.revision)}`, cloneFrozen(policy))
  }

  async reserve(reservation: ResourceBudgetReservation): Promise<ResourceBudgetReservation> {
    this.expireReservations()
    const fingerprint = stableJson({
      tenantId: reservation.tenantId,
      scopeType: reservation.scopeType,
      scopeId: reservation.scopeId,
      requested: reservation.requested,
      policyId: reservation.policyId,
      policyRevision: reservation.policyRevision,
    })
    const existingKey = this.#reservationByKey.get(reservation.idempotencyKey)
    if (existingKey !== undefined) {
      if (existingKey.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return this.getReservation(existingKey.reservationId)
    }
    if (isExpired(reservation.expiresAt, this.#clock)) throw new MilitaryError('BUDGET_RESERVATION_EXPIRED')
    const policy = this.#policies.get(`${reservation.policyId}@${Number(reservation.policyRevision)}`)
    if (policy === undefined || policy.status !== 'ACTIVE') throw new MilitaryError('BUDGET_RESERVATION_REQUIRED', 'active budget policy not found')
    const scopeKey = key(reservation.scopeType, reservation.scopeId)
    const scope = this.#scopes.get(scopeKey) ?? {
      policy,
      consumed: zeroCounters(),
      reserved: zeroCounters(),
    }
    for (const counter of counterKeys) {
      const projected = scope.consumed[counter] + scope.reserved[counter] + reservation.requested[counter]
      if (projected > policy.limits[counter]) {
        const rejected = cloneFrozen({ ...reservation, state: 'REJECTED' as const, granted: zeroCounters() })
        this.#reservations.set(reservation.reservationId, rejected)
        this.#reservationByKey.set(reservation.idempotencyKey, { fingerprint, reservationId: reservation.reservationId })
        throw new MilitaryError('CAPACITY_EXHAUSTED', `budget ${counter} exhausted`, {
          counter, projected, limit: policy.limits[counter], disposition: policy.disposition,
        })
      }
    }
    const accepted = cloneFrozen({ ...reservation, state: 'RESERVED' as const, granted: { ...reservation.requested } })
    scope.reserved = add(scope.reserved, accepted.granted)
    this.#scopes.set(scopeKey, scope)
    this.#reservations.set(accepted.reservationId, accepted)
    this.#reservationByKey.set(accepted.idempotencyKey, { fingerprint, reservationId: accepted.reservationId })
    return accepted
  }

  async settle(receipt: ResourceUsageReceipt): Promise<void> {
    const existing = this.#usage.get(receipt.idempotencyKey)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(receipt)) throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT')
      return
    }
    const reservation = this.#reservations.get(receipt.reservationId)
    if (reservation === undefined) throw new MilitaryError('BUDGET_RESERVATION_REQUIRED')
    if (reservation.state !== 'RESERVED') throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT', `reservation is ${reservation.state}`)
    if (receipt.scopeType !== reservation.scopeType || receipt.scopeId !== reservation.scopeId) {
      throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT', 'scope does not match reservation')
    }
    const scope = this.#scopes.get(key(reservation.scopeType, reservation.scopeId))
    if (scope === undefined) throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT')
    scope.reserved = subtractFloor(scope.reserved, reservation.granted)
    scope.consumed = add(scope.consumed, receipt.actual)
    this.#usage.set(receipt.idempotencyKey, cloneFrozen(receipt))
    this.#reservations.set(reservation.reservationId, cloneFrozen({ ...reservation, state: 'SETTLED' as const }))
  }

  async getReservation(reservationId: string): Promise<ResourceBudgetReservation> {
    const reservation = this.#reservations.get(reservationId)
    if (reservation === undefined) throw new MilitaryError('NOT_FOUND', `unknown reservation ${reservationId}`)
    return cloneFrozen(reservation)
  }

  async usageForScope(scopeType: ResourceBudgetReservation['scopeType'], scopeId: string): Promise<ResourceUsageReceipt[]> {
    return cloneFrozen([...this.#usage.values()].filter(item => item.scopeType === scopeType && item.scopeId === scopeId))
  }

  async revoke(reservationId: string, _reason: string): Promise<void> {
    const reservation = this.#reservations.get(reservationId)
    if (reservation === undefined) throw new MilitaryError('NOT_FOUND')
    if (reservation.state !== 'RESERVED') return
    const scope = this.#scopes.get(key(reservation.scopeType, reservation.scopeId))
    if (scope !== undefined) scope.reserved = subtractFloor(scope.reserved, reservation.granted)
    this.#reservations.set(reservationId, cloneFrozen({ ...reservation, state: 'REVOKED' as const }))
  }

  async discard(reservationId: string): Promise<void> {
    const reservation = this.#reservations.get(reservationId)
    if (reservation === undefined) return
    if (reservation.state === 'SETTLED') {
      throw new MilitaryError('REVISION_CONFLICT', 'settled reservation cannot be discarded')
    }
    if (reservation.state === 'RESERVED') {
      const scope = this.#scopes.get(key(reservation.scopeType, reservation.scopeId))
      if (scope !== undefined) scope.reserved = subtractFloor(scope.reserved, reservation.granted)
    }
    this.#reservations.delete(reservationId)
    for (const [idempotencyKey, record] of this.#reservationByKey.entries()) {
      if (record.reservationId === reservationId) {
        this.#reservationByKey.delete(idempotencyKey)
      }
    }
  }

  expireReservations(): string[] {
    const expired: string[] = []
    for (const reservation of this.#reservations.values()) {
      if (reservation.state !== 'RESERVED' || !isExpired(reservation.expiresAt, this.#clock)) continue
      const scope = this.#scopes.get(key(reservation.scopeType, reservation.scopeId))
      if (scope !== undefined) scope.reserved = subtractFloor(scope.reserved, reservation.granted)
      this.#reservations.set(reservation.reservationId, cloneFrozen({ ...reservation, state: 'EXPIRED' as const }))
      expired.push(reservation.reservationId)
    }
    return expired
  }
}

export function zeroCounters(): ResourceCounters {
  return {
    modelRequests: 0,
    reasoningTokens: 0,
    wallClockSeconds: 0,
    toolCalls: 0,
    apiCalls: 0,
    concurrentAgents: 0,
    radioRounds: 0,
    reworkAttempts: 0,
    storageBytes: 0,
  }
}

function add(left: ResourceCounters, right: ResourceCounters): ResourceCounters {
  return Object.fromEntries(counterKeys.map(keyName => [keyName, left[keyName] + right[keyName]])) as unknown as ResourceCounters
}

function subtractFloor(left: ResourceCounters, right: ResourceCounters): ResourceCounters {
  return Object.fromEntries(counterKeys.map(keyName => [keyName, Math.max(0, left[keyName] - right[keyName])])) as unknown as ResourceCounters
}

function key(scopeType: string, scopeId: string): string { return `${scopeType}\u0000${scopeId}` }
