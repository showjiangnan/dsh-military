import {
  MilitaryError,
  type DecisionBrokerRecord,
  type DecisionQuestionSet,
  type MilitaryDecisionBrokerV2,
  type SessionId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  isExpired,
  now,
  stableJson,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

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

  async submit(
    questionSet: DecisionQuestionSet,
    context?: {
      readonly missionId: import('@dsh-military/contracts').MissionId
      readonly taskId?: import('@dsh-military/contracts').TaskId
      readonly taskVersion?: import('@dsh-military/contracts').TaskVersion
      readonly attemptId?: string
    },
  ): Promise<void> {
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
          if (
            stableJson(existing.questionSet) !== stableJson(questionSet)
            || existing.record.missionId
              !== (context === undefined
                ? 'unbound'
                : String(context.missionId))
            || existing.record.taskId
              !== (context?.taskId === undefined
                ? undefined
                : String(context.taskId))
            || existing.record.taskVersion
              !== (context?.taskVersion === undefined
                ? undefined
                : Number(context.taskVersion))
            || existing.record.attemptId !== context?.attemptId
          ) {
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
          missionId: context === undefined ? 'unbound' : String(context.missionId),
          ...(context?.taskId === undefined
            ? {}
            : { taskId: String(context.taskId) }),
          ...(context?.taskVersion === undefined
            ? {}
            : { taskVersion: Number(context.taskVersion) }),
          ...(context?.attemptId === undefined
            ? {}
            : { attemptId: context.attemptId }),
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

  async reconcileExpired(): Promise<readonly DecisionBrokerRecord[]> {
    return await this.#records.update<
      DecisionState,
      readonly DecisionBrokerRecord[]
    >(
      'decision-broker',
      'state',
      emptyDecisionState,
      state => {
        const ids = expireDueDecisions(state, this.#clock)
        return {
          next: state,
          result: cloneFrozen(ids.map(id =>
            requireDecision(state, id).record)),
        }
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

function expireDueDecisions(state: DecisionState, clock: Clock): string[] {
  const expired: string[] = []
  for (const stored of Object.values(state.records)) {
    if (terminalDecision(stored.record.state) || !isExpired(stored.record.expiresAt, clock)) continue
    stored.record = cloneFrozen({
      ...stored.record,
      state: 'EXPIRED' as const,
      version: stored.record.version + 1,
      updatedAt: now(clock),
    })
    clearDecisionDedupe(state, stored.questionSet)
    expired.push(stored.record.decisionSetId)
  }
  return expired
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
