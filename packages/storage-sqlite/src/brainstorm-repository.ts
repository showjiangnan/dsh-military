import {
  MilitaryError,
  brand,
  type BrainstormOrder,
  type BrainstormOrderId,
  type BrainstormState,
  type MilitaryBrainstorm,
  type MissionId,
  type Revision,
  type SessionId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  uuid,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

export type SqliteProjectStageResolver = (sessionId: SessionId) => Promise<BrainstormOrder['projectStage']>

interface BrainstormStateRecord {
  orders: Record<string, BrainstormOrder>
  activeBySession: Record<string, string>
}

const emptyBrainstormState = (): BrainstormStateRecord => ({ orders: {}, activeBySession: {} })

/** Durable brainstorm order state and one-active-order-per-root-session fence. */
export class SqliteMilitaryBrainstorm implements MilitaryBrainstorm {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock
  readonly #resolveStage: SqliteProjectStageResolver

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    options?: { readonly clock?: Clock; readonly resolveStage?: SqliteProjectStageResolver },
  ) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = options?.clock ?? (() => new Date())
    this.#resolveStage = options?.resolveStage ?? (async () => 'IDEATION')
  }

  async start(rootSessionId: SessionId, missionId: MissionId): Promise<BrainstormOrder> {
    const projectStage = await this.#resolveStage(rootSessionId)
    return await this.#records.update<BrainstormStateRecord, BrainstormOrder>(
      'brainstorm',
      'state',
      emptyBrainstormState,
      state => {
        const activeId = state.activeBySession[String(rootSessionId)]
        if (activeId !== undefined) {
          const active = state.orders[activeId]
          if (active !== undefined && active.status !== 'COMPLETED' && active.status !== 'CANCELLED') {
            throw new MilitaryError('BRAINSTORM_ALREADY_ACTIVE', 'a brainstorm order is already active', { orderId: activeId })
          }
        }
        const timestamp = now(this.#clock)
        const order: BrainstormOrder = {
          schemaVersion: '1.0.0',
          orderId: brand<string, 'BrainstormOrderId'>(uuid('brainstorm')),
          sessionId: rootSessionId,
          missionId,
          canonicalCommand: '/brainstorm',
          displayName: '头脑风暴',
          revision: brand<number, 'Revision'>(1),
          status: 'OPEN',
          projectStage,
          questionPolicy: { maxRounds: 8, maxQuestionsPerRound: 5, askOnlyUserOwnedDecisions: true },
          phases: ['DISCOVERY', 'GOALS', 'CONSTRAINTS', 'EXPERIENCE', 'TECHNOLOGY', 'OPERATIONS', 'STAFF_REVIEW', 'SPECS_HANDOFF'],
          knownFacts: [],
          constraints: [],
          unknowns: [],
          answeredQuestionIds: [],
          pendingDecisionSetRefs: [],
          specsHandoff: { required: true },
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        state.orders[String(order.orderId)] = cloneFrozen(order)
        state.activeBySession[String(rootSessionId)] = String(order.orderId)
        return { next: state, result: cloneFrozen(order) }
      },
    )
  }

  async active(rootSessionId: SessionId): Promise<BrainstormOrder | null> {
    const state = await this.#records.read<BrainstormStateRecord>('brainstorm', 'state')
    if (state === null) return null
    const orderId = state.activeBySession[String(rootSessionId)]
    if (orderId === undefined) return null
    const order = state.orders[orderId]
    if (order === undefined || order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      return null
    }
    return cloneFrozen(order)
  }

  async get(orderId: BrainstormOrderId): Promise<BrainstormOrder> {
    const state = await this.#records.read<BrainstormStateRecord>('brainstorm', 'state')
    const order = state?.orders[String(orderId)]
    if (order === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(order)
  }

  async state(orderId: BrainstormOrderId): Promise<BrainstormState> {
    return (await this.get(orderId)).status
  }

  async update(input: {
    readonly orderId: BrainstormOrderId
    readonly expectedRevision: Revision
    readonly status?: BrainstormOrder['status']
    readonly knownFacts?: readonly string[]
    readonly constraints?: readonly string[]
    readonly unknowns?: readonly string[]
    readonly answeredQuestionIds?: readonly string[]
    readonly pendingDecisionSetRefs?: BrainstormOrder['pendingDecisionSetRefs']
  }): Promise<BrainstormOrder> {
    return await this.#records.update<BrainstormStateRecord, BrainstormOrder>(
      'brainstorm',
      'state',
      emptyBrainstormState,
      state => {
        const order = requireBrainstorm(state, input.orderId)
        if (Number(order.revision) !== Number(input.expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') throw new MilitaryError('BRAINSTORM_NOT_ACTIVE')
        const next = cloneFrozen({
          ...order,
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.knownFacts === undefined ? {} : { knownFacts: [...input.knownFacts] }),
          ...(input.constraints === undefined ? {} : { constraints: [...input.constraints] }),
          ...(input.unknowns === undefined ? {} : { unknowns: [...input.unknowns] }),
          ...(input.answeredQuestionIds === undefined ? {} : { answeredQuestionIds: [...input.answeredQuestionIds] }),
          ...(input.pendingDecisionSetRefs === undefined ? {} : { pendingDecisionSetRefs: [...input.pendingDecisionSetRefs] }),
          revision: brand<number, 'Revision'>(Number(order.revision) + 1),
          updatedAt: now(this.#clock),
        })
        state.orders[String(order.orderId)] = next
        return { next: state, result: next }
      },
    )
  }

  async complete(orderId: BrainstormOrderId, specsMaintenanceOrderRef?: string): Promise<void> {
    await this.#records.update<BrainstormStateRecord, null>(
      'brainstorm',
      'state',
      emptyBrainstormState,
      state => {
        const order = requireBrainstorm(state, orderId)
        if (order.status === 'CANCELLED') throw new MilitaryError('BRAINSTORM_NOT_ACTIVE')
        if (order.status === 'COMPLETED') return { next: state, result: null }
        state.orders[String(orderId)] = cloneFrozen({
          ...order,
          status: 'COMPLETED' as const,
          revision: brand<number, 'Revision'>(Number(order.revision) + 1),
          specsHandoff: {
            required: order.specsHandoff.required,
            ...(specsMaintenanceOrderRef === undefined ? {} : { maintenanceOrderRef: specsMaintenanceOrderRef }),
          },
          updatedAt: now(this.#clock),
        })
        delete state.activeBySession[String(order.sessionId)]
        return { next: state, result: null }
      },
    )
  }

  async cancel(orderId: BrainstormOrderId, _reason: string): Promise<void> {
    await this.#records.update<BrainstormStateRecord, null>(
      'brainstorm',
      'state',
      emptyBrainstormState,
      state => {
        const order = requireBrainstorm(state, orderId)
        if (order.status === 'COMPLETED') throw new MilitaryError('BRAINSTORM_NOT_ACTIVE')
        if (order.status === 'CANCELLED') return { next: state, result: null }
        state.orders[String(orderId)] = cloneFrozen({
          ...order,
          status: 'CANCELLED' as const,
          revision: brand<number, 'Revision'>(Number(order.revision) + 1),
          updatedAt: now(this.#clock),
        })
        delete state.activeBySession[String(order.sessionId)]
        return { next: state, result: null }
      },
    )
  }
}

function requireBrainstorm(state: BrainstormStateRecord, orderId: BrainstormOrderId): BrainstormOrder {
  const order = state.orders[String(orderId)]
  if (order === undefined) throw new MilitaryError('NOT_FOUND')
  return order
}
