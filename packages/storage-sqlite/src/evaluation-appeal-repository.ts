import {
  MilitaryError,
  type MilitaryEvaluationAppeals,
  type PerformanceEvaluationAppeal,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  stableJson,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

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
