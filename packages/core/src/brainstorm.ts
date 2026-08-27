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
import { cloneFrozen, now, uuid, type Clock } from './util.js'

export type ProjectStageResolver = (sessionId: SessionId) => Promise<BrainstormOrder['projectStage']>

export class InMemoryMilitaryBrainstorm implements MilitaryBrainstorm {
  readonly #orders = new Map<string, BrainstormOrder>()
  readonly #activeBySession = new Map<string, string>()
  readonly #clock: Clock
  readonly #resolveStage: ProjectStageResolver

  constructor(options?: { readonly clock?: Clock; readonly resolveStage?: ProjectStageResolver }) {
    this.#clock = options?.clock ?? (() => new Date())
    this.#resolveStage = options?.resolveStage ?? (async () => 'IDEATION')
  }

  async start(rootSessionId: SessionId, missionId: MissionId): Promise<BrainstormOrder> {
    const activeId = this.#activeBySession.get(String(rootSessionId))
    if (activeId !== undefined) {
      const active = this.#orders.get(activeId)
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
      projectStage: await this.#resolveStage(rootSessionId),
      questionPolicy: { maxRounds: 8, maxQuestionsPerRound: 5, askOnlyUserOwnedDecisions: true },
      phases: ['DISCOVERY', 'GOALS', 'CONSTRAINTS', 'EXPERIENCE', 'TECHNOLOGY', 'OPERATIONS', 'STAFF_REVIEW', 'SPECS_HANDOFF'],
      knownFacts: [], constraints: [], unknowns: [], answeredQuestionIds: [], pendingDecisionSetRefs: [],
      specsHandoff: { required: true }, createdAt: timestamp, updatedAt: timestamp,
    }
    this.#orders.set(String(order.orderId), cloneFrozen(order))
    this.#activeBySession.set(String(rootSessionId), String(order.orderId))
    return cloneFrozen(order)
  }

  async active(rootSessionId: SessionId): Promise<BrainstormOrder | null> {
    const orderId = this.#activeBySession.get(String(rootSessionId))
    if (orderId === undefined) return null
    const order = this.#orders.get(orderId)
    if (order === undefined || order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      return null
    }
    return cloneFrozen(order)
  }

  async get(orderId: BrainstormOrderId): Promise<BrainstormOrder> {
    const order = this.#orders.get(String(orderId))
    if (order === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(order)
  }

  async state(orderId: BrainstormOrderId): Promise<BrainstormState> { return (await this.get(orderId)).status }

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
    const order = await this.get(input.orderId)
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
    this.#orders.set(String(order.orderId), next)
    return next
  }

  async complete(orderId: BrainstormOrderId, specsMaintenanceOrderRef?: string): Promise<void> {
    const order = await this.get(orderId)
    if (order.status === 'CANCELLED') throw new MilitaryError('BRAINSTORM_NOT_ACTIVE')
    const completed = cloneFrozen({
      ...order,
      status: 'COMPLETED' as const,
      revision: brand<number, 'Revision'>(Number(order.revision) + 1),
      specsHandoff: {
        required: order.specsHandoff.required,
        ...(specsMaintenanceOrderRef === undefined ? {} : { maintenanceOrderRef: specsMaintenanceOrderRef }),
      },
      updatedAt: now(this.#clock),
    })
    this.#orders.set(String(orderId), completed)
    this.#activeBySession.delete(String(order.sessionId))
  }

  async cancel(orderId: BrainstormOrderId, _reason: string): Promise<void> {
    const order = await this.get(orderId)
    if (order.status === 'COMPLETED') throw new MilitaryError('BRAINSTORM_NOT_ACTIVE')
    this.#orders.set(String(orderId), cloneFrozen({
      ...order,
      status: 'CANCELLED' as const,
      revision: brand<number, 'Revision'>(Number(order.revision) + 1),
      updatedAt: now(this.#clock),
    }))
    this.#activeBySession.delete(String(order.sessionId))
  }
}
