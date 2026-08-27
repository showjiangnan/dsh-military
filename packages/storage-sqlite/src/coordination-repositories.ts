import {
  MilitaryError,
  brand,
  type AgentIdentity,
  type BrainstormOrder,
  type BrainstormOrderId,
  type BrainstormState,
  type CompactionAttempt,
  type DecisionBrokerRecord,
  type DecisionQuestionSet,
  type MilitaryBrainstorm,
  type MilitaryCompactionAttempts,
  type MilitaryDecisionBrokerV2,
  type MilitaryEvaluationAppeals,
  type MilitaryRadio,
  type MilitaryTags,
  type MissionId,
  type PerformanceEvaluationAppeal,
  type Revision,
  type SessionId,
  type TacticalGuidance,
  type TacticalRequest,
  type TacticalRequestId,
  type TacticalTag,
  type TacticalTagId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  isExpired,
  now,
  stableJson,
  uuid,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

interface RadioEntry {
  request: TacticalRequest
  state: 'QUEUED' | 'LEASED' | 'GUIDANCE_READY' | 'DELIVERED' | 'ACKNOWLEDGED' | 'DEAD_LETTERED'
  leaseOwner?: string
  leaseUntil?: number
  attempts: number
  guidance?: TacticalGuidance
}

interface RadioState {
  entries: Record<string, RadioEntry>
  byIdempotency: Record<string, { fingerprint: string; requestId: string }>
}

const emptyRadioState = (): RadioState => ({ entries: {}, byIdempotency: {} })

/**
 * Durable Staff Radio queue. Leasing, retry fencing, guidance publication and
 * acknowledgement all mutate one SQLite snapshot under BEGIN IMMEDIATE.
 */
export class SqliteMilitaryRadio implements MilitaryRadio {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock
  #leaseMs: number
  #maxAttempts: number

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    options?: { readonly clock?: Clock; readonly leaseMs?: number; readonly maxAttempts?: number },
  ) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = options?.clock ?? (() => new Date())
    this.#leaseMs = options?.leaseMs ?? 60_000
    this.#maxAttempts = options?.maxAttempts ?? 3
  }

  /** Apply validated live limits to future leases and subsequent recovery decisions. */
  updateLimits(input: { readonly leaseMs: number; readonly maxAttempts: number }): void {
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 10_000 || input.leaseMs > 3_600_000) {
      throw new TypeError('Radio leaseMs must be an integer between 10000 and 3600000')
    }
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 32) {
      throw new TypeError('Radio maxAttempts must be an integer between 1 and 32')
    }
    this.#leaseMs = input.leaseMs
    this.#maxAttempts = input.maxAttempts
  }

  async request(request: TacticalRequest): Promise<{
    readonly requestId: TacticalRequestId
    readonly state: 'QUEUED' | 'REJECTED'
  }> {
    if (!request.blocker.reproducible || request.evidence.length === 0) {
      throw new MilitaryError('REQUEST_NOT_ADMISSIBLE', 'radio request requires a reproducible blocker and evidence')
    }
    const fingerprint = stableJson({
      location: request.location,
      blocker: request.blocker,
      requestedDecision: request.requestedDecision,
    })
    return await this.#records.update<RadioState, { requestId: TacticalRequestId; state: 'QUEUED' }>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const duplicate = state.byIdempotency[request.idempotencyKey]
        if (duplicate !== undefined) {
          if (duplicate.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return {
            next: state,
            result: { requestId: duplicate.requestId as TacticalRequestId, state: 'QUEUED' },
          }
        }
        const requestId = String(request.requestId)
        const existing = state.entries[requestId]
        if (existing !== undefined) {
          if (stableJson(existing.request) !== stableJson(request)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: state, result: { requestId: request.requestId, state: 'QUEUED' } }
        }
        state.entries[requestId] = {
          request: cloneFrozen(request),
          state: 'QUEUED',
          attempts: 0,
        }
        state.byIdempotency[request.idempotencyKey] = { fingerprint, requestId }
        return { next: state, result: { requestId: request.requestId, state: 'QUEUED' } }
      },
    )
  }

  async lease(advisor: AgentIdentity, signal: AbortSignal): Promise<TacticalRequest | null> {
    if (signal.aborted) throw signal.reason
    return await this.#records.update<RadioState, TacticalRequest | null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        if (signal.aborted) throw signal.reason
        const nowMs = this.#clock().getTime()
        recoverRadioEntries(state, nowMs, this.#maxAttempts)
        const entry = Object.values(state.entries)
          .filter(item => item.state === 'QUEUED')
          .sort((left, right) => Date.parse(left.request.createdAt) - Date.parse(right.request.createdAt))[0]
        if (entry === undefined) return { next: state, result: null }
        entry.state = 'LEASED'
        entry.leaseOwner = `${String(advisor.agentId)}@${advisor.generation}`
        entry.leaseUntil = nowMs + this.#leaseMs
        entry.attempts += 1
        return { next: state, result: cloneFrozen(entry.request) }
      },
    )
  }

  async leased(
    requestId: TacticalRequestId,
    advisor: AgentIdentity,
  ): Promise<TacticalRequest> {
    const state = await this.#records.read<RadioState>('radio', 'state')
      ?? emptyRadioState()
    const entry = state.entries[String(requestId)]
    const owner = `${String(advisor.agentId)}@${advisor.generation}`
    if (entry === undefined
      || entry.state !== 'LEASED'
      || entry.leaseOwner !== owner
      || entry.leaseUntil === undefined
      || entry.leaseUntil <= this.#clock().getTime()) {
      throw new MilitaryError(
        'GUIDANCE_STALE',
        'Tactical Request is not actively leased by the calling advisor',
      )
    }
    return cloneFrozen(entry.request)
  }

  async issue(guidance: TacticalGuidance): Promise<void> {
    await this.#records.update<RadioState, null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = state.entries[String(guidance.requestId)]
        if (entry === undefined) throw new MilitaryError('NOT_FOUND')
        if (entry.state !== 'LEASED') {
          if (String(entry.guidance?.guidanceId ?? '') === String(guidance.guidanceId)) {
            return { next: state, result: null }
          }
          throw new MilitaryError('GUIDANCE_STALE', `radio entry is ${entry.state}`)
        }
        if (Number(guidance.expectedTaskVersion) !== Number(entry.request.location.taskVersion)) {
          throw new MilitaryError('GUIDANCE_STALE')
        }
        if (isExpired(guidance.expiresAt, this.#clock)) throw new MilitaryError('GUIDANCE_EXPIRED')
        entry.guidance = cloneFrozen(guidance)
        entry.state = 'GUIDANCE_READY'
        delete entry.leaseOwner
        delete entry.leaseUntil
        return { next: state, result: null }
      },
    )
  }

  async guidance(guidanceId: string): Promise<TacticalGuidance> {
    const result = await this.#records.update<
      RadioState,
      { readonly guidance?: TacticalGuidance; readonly error?: 'NOT_FOUND' | 'GUIDANCE_EXPIRED' }
    >(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = Object.values(state.entries)
          .find(item => String(item.guidance?.guidanceId) === guidanceId)
        if (entry?.guidance === undefined || entry.state === 'DEAD_LETTERED') {
          return { next: state, result: { error: 'NOT_FOUND' } }
        }
        if (isExpired(entry.guidance.expiresAt, this.#clock)) {
          entry.state = 'DEAD_LETTERED'
          return { next: state, result: { error: 'GUIDANCE_EXPIRED' } }
        }
        if (entry.state === 'GUIDANCE_READY') entry.state = 'DELIVERED'
        return { next: state, result: { guidance: cloneFrozen(entry.guidance) } }
      },
    )
    if (result.error === 'GUIDANCE_EXPIRED') throw new MilitaryError('GUIDANCE_EXPIRED')
    if (result.guidance === undefined) throw new MilitaryError('NOT_FOUND', `unknown guidance ${guidanceId}`)
    return result.guidance
  }

  async acknowledge(guidanceId: string, worker: AgentIdentity): Promise<void> {
    await this.#records.update<RadioState, null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = Object.values(state.entries)
          .find(item => String(item.guidance?.guidanceId) === guidanceId)
        if (entry === undefined || entry.guidance === undefined) throw new MilitaryError('NOT_FOUND')
        if (String(entry.request.identity.agentId) !== String(worker.agentId)
          || String(entry.request.identity.sessionId) !== String(worker.sessionId)
          || entry.request.identity.generation !== worker.generation) {
          throw new MilitaryError('UNAUTHORIZED')
        }
        if (entry.state === 'ACKNOWLEDGED') return { next: state, result: null }
        if (entry.state !== 'DELIVERED') throw new MilitaryError('NOT_FOUND')
        entry.state = 'ACKNOWLEDGED'
        return { next: state, result: null }
      },
    )
  }
}

function recoverRadioEntries(state: RadioState, nowMs: number, maxAttempts: number): void {
  for (const entry of Object.values(state.entries)) {
    if (entry.state === 'QUEUED'
      && entry.request.expiresAt !== undefined
      && Date.parse(entry.request.expiresAt) <= nowMs) {
      entry.state = 'DEAD_LETTERED'
      continue
    }
    if (entry.state !== 'LEASED' || entry.leaseUntil === undefined || entry.leaseUntil > nowMs) continue
    delete entry.leaseOwner
    delete entry.leaseUntil
    entry.state = entry.attempts >= maxAttempts ? 'DEAD_LETTERED' : 'QUEUED'
  }
}

interface StoredDecision {
  questionSet: DecisionQuestionSet
  record: DecisionBrokerRecord
}

interface DecisionState {
  records: Record<string, StoredDecision>
  dedupe: Record<string, string>
}

const emptyDecisionState = (): DecisionState => ({ records: {}, dedupe: {} })

/** Durable question queue whose presentation and answer transitions survive restart. */
export class SqliteDecisionBroker implements MilitaryDecisionBrokerV2 {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock

  constructor(database: SqliteMilitaryDatabase, tenantId: string, clock?: Clock) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = clock ?? (() => new Date())
  }

  async submit(questionSet: DecisionQuestionSet): Promise<void> {
    if (questionSet.deliveryAuthority !== 'general') throw new MilitaryError('UNAUTHORIZED')
    if (questionSet.questions.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'decision question set is empty')
    if (questionSet.expiresAt !== undefined && isExpired(questionSet.expiresAt, this.#clock)) {
      throw new MilitaryError('DECISION_SET_STALE')
    }
    await this.#records.update<DecisionState, null>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        const id = String(questionSet.decisionSetId)
        const existing = state.records[id]
        if (existing !== undefined) {
          if (stableJson(existing.questionSet) !== stableJson(questionSet)) {
            throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          }
          return { next: state, result: null }
        }
        if (questionSet.dedupeKey !== undefined) {
          const key = decisionDedupeKey(questionSet)
          const duplicateId = state.dedupe[key]
          if (duplicateId !== undefined) {
            throw new MilitaryError('DECISION_SET_DUPLICATE', 'duplicate unresolved decision set', { duplicateId })
          }
        }
        const timestamp = now(this.#clock)
        const record: DecisionBrokerRecord = {
          schemaVersion: '1.0.0',
          decisionSetId: id,
          rootSessionId: String(questionSet.targetRootSessionId),
          originAgentId: String(questionSet.producer.agentId),
          missionId: 'unknown',
          state: 'QUEUED',
          priority: inferDecisionPriority(questionSet),
          questionSetRef: `decision-set:${id}`,
          version: 1,
          createdAt: timestamp,
          expiresAt: questionSet.expiresAt
            ?? new Date(this.#clock().getTime() + 24 * 60 * 60 * 1000).toISOString() as DecisionBrokerRecord['expiresAt'],
          updatedAt: timestamp,
        }
        state.records[id] = { questionSet: cloneFrozen(questionSet), record: cloneFrozen(record) }
        if (questionSet.dedupeKey !== undefined) state.dedupe[decisionDedupeKey(questionSet)] = id
        return { next: state, result: null }
      },
    )
  }

  async pending(rootSessionId: SessionId): Promise<readonly DecisionQuestionSet[]> {
    return await this.#records.update<DecisionState, readonly DecisionQuestionSet[]>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        expireDueDecisions(state, this.#clock)
        const activeStates = new Set(['QUEUED', 'PRESENTED', 'PARTIALLY_ANSWERED'])
        const result = Object.values(state.records)
          .filter(item => item.record.rootSessionId === String(rootSessionId) && activeStates.has(item.record.state))
          .sort(compareDecision)
          .map(item => item.questionSet)
        return { next: state, result: cloneFrozen(result) }
      },
    )
  }

  async recordAnswers(input: {
    readonly rootSessionId: SessionId
    readonly decisionSetId: string
    readonly answerReceiptRef: string
  }): Promise<void> {
    await this.#records.update<DecisionState, null>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        const stored = requireDecision(state, input.decisionSetId)
        if (stored.record.rootSessionId !== String(input.rootSessionId)) throw new MilitaryError('UNAUTHORIZED')
        if (!['QUEUED', 'PRESENTED', 'PARTIALLY_ANSWERED'].includes(stored.record.state)) {
          if (stored.record.state === 'ANSWERED' && stored.record.answerReceiptRef === input.answerReceiptRef) {
            return { next: state, result: null }
          }
          throw new MilitaryError('DECISION_SET_STALE')
        }
        stored.record = cloneFrozen({
          ...stored.record,
          state: 'ANSWERED' as const,
          answerReceiptRef: input.answerReceiptRef,
          version: stored.record.version + 1,
          updatedAt: now(this.#clock),
        })
        clearDecisionDedupe(state, stored.questionSet)
        return { next: state, result: null }
      },
    )
  }

  async record(decisionSetId: string): Promise<DecisionBrokerRecord> {
    const state = await this.#records.read<DecisionState>('decision-broker', 'state') ?? emptyDecisionState()
    return cloneFrozen(requireDecision(state, decisionSetId).record)
  }

  async presentNext(rootSessionId: SessionId): Promise<DecisionBrokerRecord | null> {
    return await this.#records.update<DecisionState, DecisionBrokerRecord | null>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        expireDueDecisions(state, this.#clock)
        const candidate = Object.values(state.records)
          .filter(item => item.record.rootSessionId === String(rootSessionId) && item.record.state === 'QUEUED')
          .sort(compareDecision)[0]
        if (candidate === undefined) return { next: state, result: null }
        candidate.record = cloneFrozen({
          ...candidate.record,
          state: 'PRESENTED' as const,
          presentationId: `presentation-${candidate.record.decisionSetId}-${candidate.record.version + 1}`,
          version: candidate.record.version + 1,
          updatedAt: now(this.#clock),
        })
        return { next: state, result: cloneFrozen(candidate.record) }
      },
    )
  }

  async expire(decisionSetId: string, _reason: string): Promise<void> {
    await this.#terminalTransition(decisionSetId, 'EXPIRED')
  }

  async supersede(decisionSetId: string, replacementId: string): Promise<void> {
    await this.#records.update<DecisionState, null>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        const stored = requireDecision(state, decisionSetId)
        requireDecision(state, replacementId)
        if (terminalDecision(stored.record.state)) throw new MilitaryError('DECISION_SET_STALE')
        stored.record = cloneFrozen({
          ...stored.record,
          state: 'SUPERSEDED' as const,
          answerReceiptRef: `superseded-by:${replacementId}`,
          version: stored.record.version + 1,
          updatedAt: now(this.#clock),
        })
        clearDecisionDedupe(state, stored.questionSet)
        return { next: state, result: null }
      },
    )
  }

  async #terminalTransition(decisionSetId: string, stateValue: 'EXPIRED' | 'STALE'): Promise<void> {
    await this.#records.update<DecisionState, null>(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        const stored = requireDecision(state, decisionSetId)
        if (terminalDecision(stored.record.state)) return { next: state, result: null }
        stored.record = cloneFrozen({
          ...stored.record,
          state: stateValue,
          version: stored.record.version + 1,
          updatedAt: now(this.#clock),
        })
        clearDecisionDedupe(state, stored.questionSet)
        return { next: state, result: null }
      },
    )
  }
}

function requireDecision(state: DecisionState, id: string): StoredDecision {
  const value = state.records[id]
  if (value === undefined) throw new MilitaryError('NOT_FOUND', `unknown decision set ${id}`)
  return value
}

function decisionDedupeKey(questionSet: DecisionQuestionSet): string {
  return `${String(questionSet.targetRootSessionId)}\u0000${String(questionSet.dedupeKey)}`
}

function clearDecisionDedupe(state: DecisionState, questionSet: DecisionQuestionSet): void {
  if (questionSet.dedupeKey !== undefined) delete state.dedupe[decisionDedupeKey(questionSet)]
}

function expireDueDecisions(state: DecisionState, clock: Clock): void {
  for (const stored of Object.values(state.records)) {
    if (terminalDecision(stored.record.state) || !isExpired(stored.record.expiresAt, clock)) continue
    stored.record = cloneFrozen({
      ...stored.record,
      state: 'EXPIRED' as const,
      version: stored.record.version + 1,
      updatedAt: now(clock),
    })
    clearDecisionDedupe(state, stored.questionSet)
  }
}

function inferDecisionPriority(questionSet: DecisionQuestionSet): DecisionBrokerRecord['priority'] {
  const purpose = questionSet.purpose.toLocaleLowerCase()
  if (/security|restricted|data loss|destructive|production/u.test(purpose)) return 'CRITICAL'
  if (/architecture|breaking|migration|budget/u.test(purpose)) return 'HIGH'
  return 'NORMAL'
}

function decisionPriorityRank(priority: DecisionBrokerRecord['priority']): number {
  return { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 }[priority]
}

function compareDecision(left: StoredDecision, right: StoredDecision): number {
  return decisionPriorityRank(right.record.priority) - decisionPriorityRank(left.record.priority)
    || Date.parse(left.record.createdAt) - Date.parse(right.record.createdAt)
}

function terminalDecision(state: DecisionBrokerRecord['state']): boolean {
  return ['ANSWERED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'STALE'].includes(state)
}

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

interface AppealState {
  appeals: Record<string, PerformanceEvaluationAppeal>
}

const emptyAppealState = (): AppealState => ({ appeals: {} })

/** Durable versioned evaluation appeal channel. */
export class SqliteEvaluationAppeals implements MilitaryEvaluationAppeals {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock

  constructor(database: SqliteMilitaryDatabase, tenantId: string, clock?: Clock) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = clock ?? (() => new Date())
  }

  async submit(appeal: PerformanceEvaluationAppeal): Promise<void> {
    if (appeal.challengedFindings.length === 0) {
      throw new MilitaryError('EVALUATION_APPEAL_EVIDENCE_REQUIRED')
    }
    await this.#records.update<AppealState, null>(
      'evaluation-appeals',
      'state',
      emptyAppealState,
      state => {
        const existing = state.appeals[appeal.appealId]
        if (existing !== undefined) {
          if (stableJson(existing) !== stableJson(appeal)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: state, result: null }
        }
        state.appeals[appeal.appealId] = cloneFrozen(appeal)
        return { next: state, result: null }
      },
    )
  }

  async get(appealId: string): Promise<PerformanceEvaluationAppeal> {
    const state = await this.#records.read<AppealState>('evaluation-appeals', 'state') ?? emptyAppealState()
    const appeal = state.appeals[appealId]
    if (appeal === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(appeal)
  }

  async list(reportId: string): Promise<readonly PerformanceEvaluationAppeal[]> {
    const state = await this.#records.read<AppealState>('evaluation-appeals', 'state') ?? emptyAppealState()
    return cloneFrozen(Object.values(state.appeals)
      .filter(appeal => appeal.reportId === reportId)
      .sort((left, right) => Date.parse(left.submittedAt) - Date.parse(right.submittedAt)))
  }

  async resolve(input: {
    readonly appealId: string
    readonly expectedState: 'SUBMITTED' | 'UNDER_REVIEW'
    readonly disposition: 'UPHELD' | 'PARTIALLY_UPHELD' | 'DENIED'
    readonly resolutionSummary: string
    readonly supersedingReportId?: string
  }): Promise<PerformanceEvaluationAppeal> {
    return await this.#records.update<AppealState, PerformanceEvaluationAppeal>(
      'evaluation-appeals',
      'state',
      emptyAppealState,
      state => {
        const appeal = state.appeals[input.appealId]
        if (appeal === undefined) throw new MilitaryError('NOT_FOUND')
        if (appeal.state !== input.expectedState) throw new MilitaryError('REVISION_CONFLICT')
        const resolved = cloneFrozen({
          ...appeal,
          state: input.disposition,
          resolutionSummary: input.resolutionSummary,
          ...(input.supersedingReportId === undefined ? {} : { supersedingReportId: input.supersedingReportId }),
          resolvedAt: now(this.#clock),
        })
        state.appeals[input.appealId] = resolved
        return { next: state, result: resolved }
      },
    )
  }

  async withdraw(appealId: string, principalId: string): Promise<PerformanceEvaluationAppeal> {
    return await this.#records.update<AppealState, PerformanceEvaluationAppeal>(
      'evaluation-appeals',
      'state',
      emptyAppealState,
      state => {
        const appeal = state.appeals[appealId]
        if (appeal === undefined) throw new MilitaryError('NOT_FOUND')
        if (appeal.submittedBy !== principalId) throw new MilitaryError('EVALUATION_APPEAL_UNAUTHORIZED')
        if (appeal.state !== 'SUBMITTED' && appeal.state !== 'UNDER_REVIEW') {
          throw new MilitaryError('REVISION_CONFLICT')
        }
        const withdrawn = cloneFrozen({
          ...appeal,
          state: 'WITHDRAWN' as const,
          resolvedAt: now(this.#clock),
          resolutionSummary: 'withdrawn by submitter',
        })
        state.appeals[appealId] = withdrawn
        return { next: state, result: withdrawn }
      },
    )
  }
}

/** Durable compaction attempt fencing across host restarts. */
export class SqliteCompactionAttempts implements MilitaryCompactionAttempts {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async require(attempt: CompactionAttempt): Promise<void> {
    validatePendingCompactionAttempt(attempt)
    await this.#records.update<CompactionAttempt | null, null>(
      'compaction-attempt',
      attempt.attemptId,
      () => null,
      current => {
        if (current !== null) {
          if (stableJson(current) !== stableJson(attempt)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: current, result: null }
        }
        return { next: cloneFrozen(attempt), result: null }
      },
    )
  }

  async complete(attempt: CompactionAttempt): Promise<void> {
    await this.#records.update<CompactionAttempt | null, null>(
      'compaction-attempt',
      attempt.attemptId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.outcome !== 'PENDING') {
          if (stableJson(current) !== stableJson(attempt)) throw new MilitaryError('REVISION_CONFLICT')
          return { next: current, result: null }
        }
        if (attempt.outcome === 'PENDING') throw new MilitaryError('INVALID_ARGUMENT', 'completion must be terminal')
        if (attempt.attemptId !== current.attemptId) throw new MilitaryError('REVISION_CONFLICT')
        return { next: cloneFrozen(attempt), result: null }
      },
    )
  }

  async get(attemptId: string): Promise<CompactionAttempt> {
    const attempt = await this.#records.read<CompactionAttempt>('compaction-attempt', attemptId)
    if (attempt === null) throw new MilitaryError('NOT_FOUND')
    return attempt
  }
}

function validatePendingCompactionAttempt(attempt: CompactionAttempt): void {
  if (!Number.isSafeInteger(attempt.contextBudgetTokens) || attempt.contextBudgetTokens <= 0
    || !Number.isSafeInteger(attempt.thresholdTokens) || attempt.thresholdTokens <= 0
    || attempt.thresholdTokens > attempt.contextBudgetTokens
    || !Number.isSafeInteger(attempt.meterTokens) || attempt.meterTokens < attempt.thresholdTokens) {
    throw new MilitaryError('CONTEXT_POLICY_INVALID', 'compaction attempt must be raised at or beyond a valid threshold')
  }
  if (!Object.values(attempt.safeBoundary).every(Boolean)) {
    throw new MilitaryError('COMPACTION_ATTEMPT_FAILED', 'unsafe compaction boundary')
  }
  if (attempt.outcome !== 'PENDING') {
    throw new MilitaryError('INVALID_ARGUMENT', 'new compaction attempt must be PENDING')
  }
}

interface TagState {
  tags: Record<string, TacticalTag>
}

const emptyTagState = (): TagState => ({ tags: {} })

/** Durable tactical tag registry used by ingestion and routing. */
export class SqliteTacticalTagRegistry implements MilitaryTags {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock

  constructor(database: SqliteMilitaryDatabase, tenantId: string, clock?: Clock) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = clock ?? (() => new Date())
  }

  async list(options?: { readonly status?: 'ACTIVE' | 'PAUSED' | 'DELETED' }): Promise<readonly TacticalTag[]> {
    const state = await this.#records.read<TagState>('tactical-tags', 'state') ?? emptyTagState()
    return cloneFrozen(Object.values(state.tags)
      .filter(tag => options?.status === undefined || tag.status === options.status)
      .sort((left, right) => left.displayName.localeCompare(right.displayName)))
  }

  async get(tagId: TacticalTagId): Promise<TacticalTag> {
    const state = await this.#records.read<TagState>('tactical-tags', 'state') ?? emptyTagState()
    const tag = state.tags[String(tagId)]
    if (tag === undefined) throw new MilitaryError('NOT_FOUND', `unknown tag ${String(tagId)}`)
    return cloneFrozen(tag)
  }

  async create(tag: TacticalTag): Promise<void> {
    if (tag.status === 'DELETED') throw new MilitaryError('INVALID_ARGUMENT', 'cannot create a deleted tag')
    await this.#records.update<TagState, null>(
      'tactical-tags',
      'state',
      emptyTagState,
      state => {
        if (state.tags[String(tag.tagId)] !== undefined) throw new MilitaryError('REVISION_CONFLICT')
        state.tags[String(tag.tagId)] = cloneFrozen(tag)
        return { next: state, result: null }
      },
    )
  }

  async rename(tagId: TacticalTagId, displayName: string, expectedRevision: Revision): Promise<TacticalTag> {
    if (displayName.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      displayName,
      renamedFrom: tag.displayName,
      updatedAt: now(this.#clock),
    }))
  }

  async pause(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      status: 'PAUSED',
      updatedAt: now(this.#clock),
    }))
  }

  async resume(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return await this.#mutate(tagId, expectedRevision, tag => {
      if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
      return { ...tag, status: 'ACTIVE', updatedAt: now(this.#clock) }
    })
  }

  async delete(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    const timestamp = now(this.#clock)
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      status: 'DELETED',
      updatedAt: timestamp,
      deletedAt: timestamp,
    }))
  }

  async #mutate(
    tagId: TacticalTagId,
    expectedRevision: Revision,
    mutate: (tag: TacticalTag) => TacticalTag,
  ): Promise<TacticalTag> {
    return await this.#records.update<TagState, TacticalTag>(
      'tactical-tags',
      'state',
      emptyTagState,
      state => {
        const tag = state.tags[String(tagId)]
        if (tag === undefined) throw new MilitaryError('NOT_FOUND', `unknown tag ${String(tagId)}`)
        if (Number(tag.revision) !== Number(expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
        if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
        const body = mutate(tag)
        const { revision: _discardedRevision, ...withoutRevision } = body
        const next = cloneFrozen({
          ...withoutRevision,
          revision: brand<number, 'Revision'>(Number(expectedRevision) + 1),
        } as TacticalTag)
        state.tags[String(tagId)] = next
        return { next: state, result: next }
      },
    )
  }
}
