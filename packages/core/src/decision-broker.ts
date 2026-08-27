import {
  MilitaryError,
  type DecisionBrokerRecord,
  type DecisionQuestionSet,
  type MilitaryDecisionBrokerV2,
  type SessionId,
} from '@dsh-military/contracts'
import { cloneFrozen, isExpired, now, type Clock } from './util.js'

interface StoredDecision {
  questionSet: DecisionQuestionSet
  record: DecisionBrokerRecord
}

export class InMemoryDecisionBroker implements MilitaryDecisionBrokerV2 {
  readonly #records = new Map<string, StoredDecision>()
  readonly #dedupe = new Map<string, string>()
  readonly #clock: Clock

  constructor(clock?: Clock) { this.#clock = clock ?? (() => new Date()) }

  async submit(questionSet: DecisionQuestionSet): Promise<void> {
    const id = String(questionSet.decisionSetId)
    if (this.#records.has(id)) return
    if (questionSet.deliveryAuthority !== 'general') throw new MilitaryError('UNAUTHORIZED')
    if (questionSet.questions.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'decision question set is empty')
    if (questionSet.expiresAt !== undefined && isExpired(questionSet.expiresAt, this.#clock)) throw new MilitaryError('DECISION_SET_STALE')
    if (questionSet.dedupeKey !== undefined) {
      const duplicateId = this.#dedupe.get(`${String(questionSet.targetRootSessionId)}\u0000${questionSet.dedupeKey}`)
      if (duplicateId !== undefined) throw new MilitaryError('DECISION_SET_DUPLICATE', 'duplicate unresolved decision set', { duplicateId })
    }
    const timestamp = now(this.#clock)
    const record: DecisionBrokerRecord = {
      schemaVersion: '1.0.0',
      decisionSetId: id,
      rootSessionId: String(questionSet.targetRootSessionId),
      originAgentId: String(questionSet.producer.agentId),
      missionId: 'unknown',
      state: 'QUEUED',
      priority: inferPriority(questionSet),
      questionSetRef: `decision-set:${id}`,
      version: 1,
      createdAt: timestamp,
      expiresAt: questionSet.expiresAt ?? new Date(this.#clock().getTime() + 24 * 60 * 60 * 1000).toISOString() as DecisionBrokerRecord['expiresAt'],
      updatedAt: timestamp,
    }
    this.#records.set(id, { questionSet: cloneFrozen(questionSet), record: cloneFrozen(record) })
    if (questionSet.dedupeKey !== undefined) this.#dedupe.set(`${String(questionSet.targetRootSessionId)}\u0000${questionSet.dedupeKey}`, id)
  }

  async pending(rootSessionId: SessionId): Promise<readonly DecisionQuestionSet[]> {
    this.expireDue()
    const stateOrder = new Set(['QUEUED', 'PRESENTED', 'PARTIALLY_ANSWERED'])
    return cloneFrozen([...this.#records.values()]
      .filter(item => item.record.rootSessionId === String(rootSessionId) && stateOrder.has(item.record.state))
      .sort(compareDecision)
      .map(item => item.questionSet))
  }

  async recordAnswers(input: {
    readonly rootSessionId: SessionId
    readonly decisionSetId: string
    readonly answerReceiptRef: string
  }): Promise<void> {
    const stored = this.#require(input.decisionSetId)
    if (stored.record.rootSessionId !== String(input.rootSessionId)) throw new MilitaryError('UNAUTHORIZED')
    if (!['QUEUED', 'PRESENTED', 'PARTIALLY_ANSWERED'].includes(stored.record.state)) throw new MilitaryError('DECISION_SET_STALE')
    stored.record = cloneFrozen({
      ...stored.record,
      state: 'ANSWERED' as const,
      answerReceiptRef: input.answerReceiptRef,
      version: stored.record.version + 1,
      updatedAt: now(this.#clock),
    })
    this.#clearDedupe(stored.questionSet)
  }

  async record(decisionSetId: string): Promise<DecisionBrokerRecord> {
    return cloneFrozen(this.#require(decisionSetId).record)
  }

  async presentNext(rootSessionId: SessionId): Promise<DecisionBrokerRecord | null> {
    this.expireDue()
    const candidate = [...this.#records.values()]
      .filter(item => item.record.rootSessionId === String(rootSessionId) && item.record.state === 'QUEUED')
      .sort(compareDecision)[0]
    if (candidate === undefined) return null
    candidate.record = cloneFrozen({
      ...candidate.record,
      state: 'PRESENTED' as const,
      presentationId: `presentation-${candidate.record.decisionSetId}-${candidate.record.version + 1}`,
      version: candidate.record.version + 1,
      updatedAt: now(this.#clock),
    })
    return cloneFrozen(candidate.record)
  }

  async expire(decisionSetId: string, _reason: string): Promise<void> {
    const stored = this.#require(decisionSetId)
    if (terminal(stored.record.state)) return
    stored.record = cloneFrozen({
      ...stored.record,
      state: 'EXPIRED' as const,
      version: stored.record.version + 1,
      updatedAt: now(this.#clock),
    })
    this.#clearDedupe(stored.questionSet)
  }

  async supersede(decisionSetId: string, replacementId: string): Promise<void> {
    const stored = this.#require(decisionSetId)
    this.#require(replacementId)
    if (terminal(stored.record.state)) throw new MilitaryError('DECISION_SET_STALE')
    stored.record = cloneFrozen({
      ...stored.record,
      state: 'SUPERSEDED' as const,
      answerReceiptRef: `superseded-by:${replacementId}`,
      version: stored.record.version + 1,
      updatedAt: now(this.#clock),
    })
    this.#clearDedupe(stored.questionSet)
  }

  markStale(decisionSetId: string): void {
    const stored = this.#require(decisionSetId)
    if (terminal(stored.record.state)) return
    stored.record = cloneFrozen({ ...stored.record, state: 'STALE' as const, version: stored.record.version + 1, updatedAt: now(this.#clock) })
    this.#clearDedupe(stored.questionSet)
  }

  expireDue(): string[] {
    const expired: string[] = []
    for (const stored of this.#records.values()) {
      if (terminal(stored.record.state) || !isExpired(stored.record.expiresAt, this.#clock)) continue
      stored.record = cloneFrozen({ ...stored.record, state: 'EXPIRED' as const, version: stored.record.version + 1, updatedAt: now(this.#clock) })
      this.#clearDedupe(stored.questionSet)
      expired.push(stored.record.decisionSetId)
    }
    return expired
  }

  #require(id: string): StoredDecision {
    const stored = this.#records.get(id)
    if (stored === undefined) throw new MilitaryError('NOT_FOUND', `unknown decision set ${id}`)
    return stored
  }

  #clearDedupe(questionSet: DecisionQuestionSet): void {
    if (questionSet.dedupeKey !== undefined) this.#dedupe.delete(`${String(questionSet.targetRootSessionId)}\u0000${questionSet.dedupeKey}`)
  }
}

function inferPriority(questionSet: DecisionQuestionSet): DecisionBrokerRecord['priority'] {
  const purpose = questionSet.purpose.toLocaleLowerCase()
  if (/security|restricted|data loss|destructive|production/u.test(purpose)) return 'CRITICAL'
  if (/architecture|breaking|migration|budget/u.test(purpose)) return 'HIGH'
  return 'NORMAL'
}

function priorityRank(priority: DecisionBrokerRecord['priority']): number {
  return { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 }[priority]
}

function compareDecision(left: StoredDecision, right: StoredDecision): number {
  return priorityRank(right.record.priority) - priorityRank(left.record.priority)
    || Date.parse(left.record.createdAt) - Date.parse(right.record.createdAt)
}

function terminal(state: DecisionBrokerRecord['state']): boolean {
  return ['ANSWERED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'STALE'].includes(state)
}
