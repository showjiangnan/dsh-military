import {
  MilitaryError,
  type MilitaryEvaluationAppeals,
  type PerformanceEvaluationAppeal,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, type Clock } from './util.js'

export class InMemoryEvaluationAppeals implements MilitaryEvaluationAppeals {
  readonly #appeals = new Map<string, PerformanceEvaluationAppeal>()
  readonly #clock: Clock
  constructor(clock?: Clock) { this.#clock = clock ?? (() => new Date()) }

  async submit(appeal: PerformanceEvaluationAppeal): Promise<void> {
    if (appeal.challengedFindings.length === 0) throw new MilitaryError('EVALUATION_APPEAL_EVIDENCE_REQUIRED')
    const existing = this.#appeals.get(appeal.appealId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(appeal)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    this.#appeals.set(appeal.appealId, cloneFrozen(appeal))
  }

  async get(appealId: string): Promise<PerformanceEvaluationAppeal> {
    const appeal = this.#appeals.get(appealId)
    if (appeal === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(appeal)
  }

  async list(reportId: string): Promise<readonly PerformanceEvaluationAppeal[]> {
    return cloneFrozen([...this.#appeals.values()].filter(appeal => appeal.reportId === reportId))
  }

  async resolve(input: {
    readonly appealId: string
    readonly expectedState: 'SUBMITTED' | 'UNDER_REVIEW'
    readonly disposition: 'UPHELD' | 'PARTIALLY_UPHELD' | 'DENIED'
    readonly resolutionSummary: string
    readonly supersedingReportId?: string
  }): Promise<PerformanceEvaluationAppeal> {
    const appeal = await this.get(input.appealId)
    if (appeal.state !== input.expectedState) throw new MilitaryError('REVISION_CONFLICT')
    const resolved = cloneFrozen({
      ...appeal,
      state: input.disposition,
      resolutionSummary: input.resolutionSummary,
      ...(input.supersedingReportId === undefined ? {} : { supersedingReportId: input.supersedingReportId }),
      resolvedAt: now(this.#clock),
    })
    this.#appeals.set(input.appealId, resolved)
    return resolved
  }

  async withdraw(appealId: string, principalId: string): Promise<PerformanceEvaluationAppeal> {
    const appeal = await this.get(appealId)
    if (appeal.submittedBy !== principalId) throw new MilitaryError('EVALUATION_APPEAL_UNAUTHORIZED')
    if (appeal.state !== 'SUBMITTED' && appeal.state !== 'UNDER_REVIEW') throw new MilitaryError('REVISION_CONFLICT')
    const withdrawn = cloneFrozen({ ...appeal, state: 'WITHDRAWN' as const, resolvedAt: now(this.#clock), resolutionSummary: 'withdrawn by submitter' })
    this.#appeals.set(appealId, withdrawn)
    return withdrawn
  }
}
