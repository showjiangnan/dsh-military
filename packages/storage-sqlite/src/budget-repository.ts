import {
  MilitaryError,
  type MilitaryResourceBudgets,
  type ResourceBudgetPolicy,
  type ResourceBudgetReservation,
  type ResourceCounters,
  type ResourceUsageReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, isExpired, stableJson, zeroCounters } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

const counterKeys = [
  'modelRequests',
  'reasoningTokens',
  'wallClockSeconds',
  'toolCalls',
  'apiCalls',
  'concurrentAgents',
  'radioRounds',
  'reworkAttempts',
  'storageBytes',
] as const satisfies readonly (keyof ResourceCounters)[]

interface ScopeBudget {
  policy: ResourceBudgetPolicy
  consumed: ResourceCounters
  reserved: ResourceCounters
}

interface BudgetState {
  policies: Record<string, ResourceBudgetPolicy>
  scopes: Record<string, ScopeBudget>
  reservations: Record<string, ResourceBudgetReservation>
  reservationByKey: Record<string, { fingerprint: string; reservationId: string }>
  usage: Record<string, ResourceUsageReceipt>
}

const emptyState = (): BudgetState => ({
  policies: {},
  scopes: {},
  reservations: {},
  reservationByKey: {},
  usage: {},
})

/** Durable reservation/settlement provider with one SQLite CAS snapshot. */
export class SqliteMilitaryResourceBudgets implements MilitaryResourceBudgets {
  readonly #records: SqliteStateRecords
  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  registerPolicy(policy: ResourceBudgetPolicy): void {
    // State-record reads are deliberately frozen snapshots. Startup registers
    // the default policies again after every process restart, so detach the
    // persisted snapshot before replacing a policy row.
    const state = structuredClone(
      this.#records.readSync<BudgetState>('resource-budget', 'state') ?? emptyState(),
    )
    state.policies[policyKey(policy.policyId, Number(policy.revision))] = cloneFrozen(policy)
    this.#records.putSync('resource-budget', 'state', state)
  }

  async reserve(reservation: ResourceBudgetReservation): Promise<ResourceBudgetReservation> {
    return await this.#records.update<BudgetState, ResourceBudgetReservation>(
      'resource-budget',
      'state',
      emptyState,
      state => {
        expireReservations(state)
        const fingerprint = stableJson({
          tenantId: reservation.tenantId,
          scopeType: reservation.scopeType,
          scopeId: reservation.scopeId,
          requested: reservation.requested,
          policyId: reservation.policyId,
          policyRevision: reservation.policyRevision,
        })
        const existingKey = state.reservationByKey[reservation.idempotencyKey]
        if (existingKey !== undefined) {
          if (existingKey.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          const existing = state.reservations[existingKey.reservationId]
          if (existing === undefined) throw new MilitaryError('PERSISTENCE_FAILED')
          return { next: state, result: existing }
        }
        if (isExpired(reservation.expiresAt)) throw new MilitaryError('BUDGET_RESERVATION_EXPIRED')
        const policy = state.policies[policyKey(reservation.policyId, Number(reservation.policyRevision))]
        if (policy === undefined || policy.status !== 'ACTIVE') {
          throw new MilitaryError('BUDGET_RESERVATION_REQUIRED', 'active budget policy not found')
        }
        const key = scopeKey(reservation.scopeType, reservation.scopeId)
        const scope = state.scopes[key] ?? {
          policy,
          consumed: zeroCounters(),
          reserved: zeroCounters(),
        }
        for (const counter of counterKeys) {
          const projected = scope.consumed[counter] + scope.reserved[counter] + reservation.requested[counter]
          if (projected > policy.limits[counter]) {
            throw new MilitaryError('CAPACITY_EXHAUSTED', `budget ${counter} exhausted`, {
              counter,
              projected,
              limit: policy.limits[counter],
              disposition: policy.disposition,
            })
          }
        }
        const accepted = cloneFrozen({
          ...reservation,
          state: 'RESERVED' as const,
          granted: { ...reservation.requested },
        })
        scope.reserved = add(scope.reserved, accepted.granted)
        state.scopes[key] = scope
        state.reservations[accepted.reservationId] = accepted
        state.reservationByKey[accepted.idempotencyKey] = {
          fingerprint,
          reservationId: accepted.reservationId,
        }
        return { next: state, result: accepted }
      },
    )
  }

  async settle(receipt: ResourceUsageReceipt): Promise<void> {
    await this.#records.update<BudgetState, null>(
      'resource-budget',
      'state',
      emptyState,
      state => {
        const existing = state.usage[receipt.idempotencyKey]
        if (existing !== undefined) {
          if (stableJson(existing) !== stableJson(receipt)) throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT')
          return { next: state, result: null }
        }
        const reservation = state.reservations[receipt.reservationId]
        if (reservation === undefined) throw new MilitaryError('BUDGET_RESERVATION_REQUIRED')
        if (reservation.state !== 'RESERVED') {
          throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT', `reservation is ${reservation.state}`)
        }
        if (receipt.scopeType !== reservation.scopeType || receipt.scopeId !== reservation.scopeId) {
          throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT', 'scope does not match reservation')
        }
        const key = scopeKey(reservation.scopeType, reservation.scopeId)
        const scope = state.scopes[key]
        if (scope === undefined) throw new MilitaryError('BUDGET_SETTLEMENT_CONFLICT')
        scope.reserved = subtractFloor(scope.reserved, reservation.granted)
        scope.consumed = add(scope.consumed, receipt.actual)
        state.usage[receipt.idempotencyKey] = cloneFrozen(receipt)
        state.reservations[reservation.reservationId] = cloneFrozen({
          ...reservation,
          state: 'SETTLED' as const,
        })
        return { next: state, result: null }
      },
    )
  }

  async getReservation(reservationId: string): Promise<ResourceBudgetReservation> {
    const state = await this.#state()
    const reservation = state.reservations[reservationId]
    if (reservation === undefined) throw new MilitaryError('NOT_FOUND', `unknown reservation ${reservationId}`)
    return cloneFrozen(reservation)
  }

  async usageForScope(
    scopeType: ResourceBudgetReservation['scopeType'],
    scopeId: string,
  ): Promise<ResourceUsageReceipt[]> {
    const state = await this.#state()
    return cloneFrozen(Object.values(state.usage)
      .filter(item => item.scopeType === scopeType && item.scopeId === scopeId))
  }

  async revoke(reservationId: string, _reason: string): Promise<void> {
    await this.#records.update<BudgetState, null>(
      'resource-budget',
      'state',
      emptyState,
      state => {
        const reservation = state.reservations[reservationId]
        if (reservation === undefined) throw new MilitaryError('NOT_FOUND')
        if (reservation.state !== 'RESERVED') return { next: state, result: null }
        const key = scopeKey(reservation.scopeType, reservation.scopeId)
        const scope = state.scopes[key]
        if (scope !== undefined) scope.reserved = subtractFloor(scope.reserved, reservation.granted)
        state.reservations[reservationId] = cloneFrozen({ ...reservation, state: 'REVOKED' as const })
        return { next: state, result: null }
      },
    )
  }

  async discard(reservationId: string): Promise<void> {
    await this.#records.update<BudgetState, null>(
      'resource-budget',
      'state',
      emptyState,
      state => {
        const reservation = state.reservations[reservationId]
        if (reservation === undefined) return { next: state, result: null }
        if (reservation.state === 'SETTLED') {
          throw new MilitaryError('REVISION_CONFLICT', 'settled reservation cannot be discarded')
        }
        if (reservation.state === 'RESERVED') {
          const scope = state.scopes[scopeKey(reservation.scopeType, reservation.scopeId)]
          if (scope !== undefined) {
            scope.reserved = subtractFloor(scope.reserved, reservation.granted)
          }
        }
        delete state.reservations[reservationId]
        for (const [idempotencyKey, record] of Object.entries(state.reservationByKey)) {
          if (record.reservationId === reservationId) {
            delete state.reservationByKey[idempotencyKey]
          }
        }
        return { next: state, result: null }
      },
    )
  }

  async #state(): Promise<BudgetState> {
    return await this.#records.read<BudgetState>('resource-budget', 'state') ?? emptyState()
  }
}

function policyKey(id: string, revision: number): string {
  return `${id}\u0000${revision}`
}

function scopeKey(scopeType: string, scopeId: string): string {
  return `${scopeType}\u0000${scopeId}`
}

function add(left: ResourceCounters, right: ResourceCounters): ResourceCounters {
  return Object.fromEntries(
    counterKeys.map(key => [key, left[key] + right[key]]),
  ) as unknown as ResourceCounters
}

function subtractFloor(left: ResourceCounters, right: ResourceCounters): ResourceCounters {
  return Object.fromEntries(
    counterKeys.map(key => [key, Math.max(0, left[key] - right[key])]),
  ) as unknown as ResourceCounters
}

function expireReservations(state: BudgetState): void {
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.state !== 'RESERVED' || !isExpired(reservation.expiresAt)) continue
    const scope = state.scopes[scopeKey(reservation.scopeType, reservation.scopeId)]
    if (scope !== undefined) scope.reserved = subtractFloor(scope.reserved, reservation.granted)
    state.reservations[reservation.reservationId] = cloneFrozen({
      ...reservation,
      state: 'EXPIRED' as const,
    })
  }
}
