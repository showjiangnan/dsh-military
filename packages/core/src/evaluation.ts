import {
  MilitaryError,
  asMilitaryFailure,
  brand,
  type AgentTemplatePerformance,
  type EvaluationAttemptRecord,
  type EvaluationDatasetManifest,
  type EvaluationRequestId,
  type FrozenEvaluationDataset,
  type MilitaryEvaluation,
  type MilitaryEvaluationDataset,
  type MilitaryPerformanceReport,
  type PerformanceEvaluationRequest,
  type PerformanceEvaluationRun,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, uuid, type Clock } from './util.js'
import {
  computePerformance,
  configurationComparisons,
  dataQualityNotes,
  exactConfigurationGroups,
  executionBudget,
  leaseExpiry,
  missionCompletionStates,
  nonEmpty,
  ratio,
  reportDecision,
  safeRunFailure,
  validateReportInvariants,
  validateRequest,
} from './evaluation-analytics.js'

export {
  clusteredRateInterval,
  exactConfigurationGroups,
  exactConfigurationKey,
  wilson,
} from './evaluation-analytics.js'

/**
 * Compatibility name retained for data-source implementations.  The v2
 * evaluator treats every value as an immutable, version-fenced Task Attempt.
 */
export type EvaluationObservation = EvaluationAttemptRecord

export interface EvaluationDataCollection {
  readonly attempts: readonly EvaluationAttemptRecord[]
  readonly includedSessions: EvaluationDatasetManifest['includedSessions']
  readonly excludedSessions: EvaluationDatasetManifest['excludedSessions']
  readonly missingness: EvaluationDatasetManifest['missingness']
  readonly sourceArtifactRefs: readonly string[]
}

export interface EvaluationDataSource {
  collect(
    request: PerformanceEvaluationRequest,
    signal: AbortSignal,
  ): Promise<EvaluationDataCollection>
}

export interface PerformanceNarrativeProvider {
  analyze(input: {
    readonly request: PerformanceEvaluationRequest
    readonly performance: AgentTemplatePerformance
    readonly signal: AbortSignal
  }): Promise<{
    readonly analyses: readonly string[]
    readonly recommendations: AgentTemplatePerformance['recommendations']
    readonly limitations: readonly string[]
  }>
  synthesize(input: {
    readonly request: PerformanceEvaluationRequest
    readonly individual: readonly AgentTemplatePerformance[]
    readonly dataset: FrozenEvaluationDataset
    readonly signal: AbortSignal
  }): Promise<Pick<
    MilitaryPerformanceReport,
    'priorityRecommendations' | 'unsupportedConclusions'
  > & { readonly analysisPoints: readonly string[] }>
}

interface EvaluationRecord {
  request: PerformanceEvaluationRequest
  run: PerformanceEvaluationRun
  results: AgentTemplatePerformance[]
  report: MilitaryPerformanceReport | null
  dataset: {
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  } | null
  cancelled: boolean
}

export interface PersistedEvaluationRecord {
  readonly schemaVersion: '1.0.0'
  readonly request: PerformanceEvaluationRequest
  readonly run: PerformanceEvaluationRun
  readonly results: readonly AgentTemplatePerformance[]
  readonly report: MilitaryPerformanceReport | null
  readonly cancelled: boolean
  readonly updatedAt: string
}

export interface EvaluationRecordStore {
  read(evaluationRequestId: EvaluationRequestId): Promise<PersistedEvaluationRecord | null>
  write(
    record: PersistedEvaluationRecord,
    lease?: EvaluationLeaseFence,
  ): Promise<void>
  acquire?(
    evaluationRequestId: EvaluationRequestId,
    owner: string,
    leaseUntil: string,
  ): Promise<EvaluationLeaseFence | null>
  renew?(
    lease: EvaluationLeaseFence,
    leaseUntil: string,
  ): Promise<void>
  release?(lease: EvaluationLeaseFence): Promise<void>
}

export interface EvaluationLeaseFence {
  readonly evaluationRequestId: EvaluationRequestId
  readonly owner: string
  readonly version: number
}

export interface EvaluationSchemaValidation {
  request(value: PerformanceEvaluationRequest): void
  dataset(value: {
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  }): void
  performance(value: AgentTemplatePerformance): void
  report(value: MilitaryPerformanceReport): void
}

/**
 * Deterministic evaluation engine.  The engine never recollects raw events:
 * all metrics and narrative inputs come from one verified frozen dataset.
 */
export class MilitaryEvaluationEngine implements MilitaryEvaluation {
  readonly #datasets: MilitaryEvaluationDataset
  readonly #narrative: PerformanceNarrativeProvider
  readonly #clock: Clock
  readonly #store: EvaluationRecordStore | undefined
  readonly #schemaValidation: EvaluationSchemaValidation | undefined
  readonly #records = new Map<string, EvaluationRecord>()
  readonly #activeLeases = new Map<string, EvaluationLeaseFence>()

  constructor(
    datasets: MilitaryEvaluationDataset,
    narrative: PerformanceNarrativeProvider,
    clock?: Clock,
    store?: EvaluationRecordStore,
    schemaValidation?: EvaluationSchemaValidation,
  ) {
    this.#datasets = datasets
    this.#narrative = narrative
    this.#clock = clock ?? (() => new Date())
    this.#store = store
    this.#schemaValidation = schemaValidation
  }

  async request(input: PerformanceEvaluationRequest): Promise<PerformanceEvaluationRun> {
    validateRequest(input)
    this.#schemaValidation?.request(input)
    const existing = await this.#load(input.evaluationRequestId)
    if (existing !== undefined) {
      if (stableJson(existing.request) !== stableJson(input)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      }
      return cloneFrozen(existing.run)
    }
    const run: PerformanceEvaluationRun = {
      evaluationRequestId: input.evaluationRequestId,
      state: 'DISCOVERING_SESSIONS',
      templatesCompleted: 0,
      templatesTotal: 0,
    }
    const record = {
      request: cloneFrozen(input),
      run,
      results: [],
      report: null,
      dataset: null,
      cancelled: false,
    }
    await this.#save(record)
    return cloneFrozen(run)
  }

  async execute(
    evaluationRequestId: EvaluationRequestId,
    signal: AbortSignal,
  ): Promise<MilitaryPerformanceReport> {
    const record = await this.#require(evaluationRequestId)
    signal.throwIfAborted()
    if (record.report !== null) {
      this.#schemaValidation?.report(record.report)
      return cloneFrozen(record.report)
    }
    if (record.cancelled) {
      throw new MilitaryError('POLICY_DENIED', 'evaluation is cancelled')
    }
    const lease = await this.#acquireLease(evaluationRequestId)
    const budget = executionBudget(
      signal,
      record.request.timeoutSeconds ?? 1_800,
    )
    try {
      const { failure: _previousFailure, ...resumableRun } = record.run
      record.run = { ...resumableRun, state: 'BUILDING_DATASET' }
      await this.#save(record)
      const frozen = record.dataset
        ?? await this.#datasets.get(evaluationRequestId)
        ?? await this.#withLeaseHeartbeat(
          lease,
          budget.signal,
          operationSignal =>
            this.#datasets.build(record.request, operationSignal),
        )
      if (!await this.#datasets.verify(frozen.manifest)) {
        throw new MilitaryError(
          'EVALUATION_DATASET_INCOMPLETE',
          'canonical evaluation dataset failed artifact/hash verification',
        )
      }
      if (
        String(frozen.manifest.datasetHash)
        !== String(frozen.dataset.datasetHash)
      ) {
        throw new MilitaryError(
          'EVALUATION_REPORT_MISMATCH',
          'manifest and canonical dataset hashes differ',
        )
      }
      this.#schemaValidation?.dataset(frozen)
      record.dataset = cloneFrozen(frozen)
      const groups = exactConfigurationGroups(frozen.dataset.attempts)
      const persistedResults = new Map(record.results.map(value => [
        value.template.configurationKey,
        value,
      ]))
      record.run = {
        ...record.run,
        state: 'EVALUATING_TEMPLATES',
        templatesCompleted: Math.min(persistedResults.size, groups.size),
        templatesTotal: groups.size,
        datasetHash: String(frozen.dataset.datasetHash),
      }
      await this.#save(record)

      const results: AgentTemplatePerformance[] = []
      for (const [configurationKey, attempts] of groups) {
        budget.signal.throwIfAborted()
        if (record.cancelled) {
          throw new MilitaryError('POLICY_DENIED', 'evaluation is cancelled')
        }
        const persisted = persistedResults.get(configurationKey)
        if (persisted !== undefined) {
          if (
            String(persisted.evaluationRequestId)
              !== String(record.request.evaluationRequestId)
            || persisted.template.configurationKey !== configurationKey
          ) {
            throw new MilitaryError(
              'EVALUATION_REPORT_MISMATCH',
              'persisted evaluation shard is bound to another request/configuration',
            )
          }
          this.#schemaValidation?.performance(persisted)
          results.push(cloneFrozen(persisted))
          continue
        }
        const base = computePerformance(
          record.request,
          attempts,
          frozen.dataset,
          this.#clock,
        )
        const narrative = await this.#withLeaseHeartbeat(
          lease,
          budget.signal,
          operationSignal => this.#narrative.analyze({
            request: record.request,
            performance: base,
            signal: operationSignal,
          }),
        )
        const completedPerformance = cloneFrozen({
          ...base,
          analyses: nonEmpty(narrative.analyses, '没有额外分析。'),
          recommendations: narrative.recommendations.length === 0
            ? base.recommendations
            : narrative.recommendations,
          limitations: [
            ...new Set([...base.limitations, ...narrative.limitations]),
          ],
        })
        this.#schemaValidation?.performance(completedPerformance)
        results.push(completedPerformance)
        record.run = {
          ...record.run,
          templatesCompleted: results.length,
        }
        record.results = cloneFrozen(results)
        await this.#save(record)
      }
      record.results = results
      record.run = {
        ...record.run,
        state: 'SYNTHESIZING',
        templatesCompleted: results.length,
      }
      await this.#save(record)

      const synthesis = await this.#withLeaseHeartbeat(
        lease,
        budget.signal,
        operationSignal => this.#narrative.synthesize({
          request: record.request,
          individual: results,
          dataset: frozen.dataset,
          signal: operationSignal,
        }),
      )
      const comparisons = configurationComparisons(
        record.request,
        results,
        frozen.dataset.attempts,
      )
      const decision = reportDecision(record.request, results, comparisons)
      const attempts = frozen.dataset.attempts
      const missionStates = missionCompletionStates(attempts)
      const completedHandoffs = attempts.filter(value =>
        value.outcome.completed)
      const radioAttempts = attempts.filter(value =>
        value.outcome.radioCount > 0)
      const frozenAttempts = attempts.filter(value => value.outcome.frozen)
      const engineerAccepted = attempts.filter(value =>
        value.configuration.role === 'engineer'
        && value.outcome.finalAccepted)
      const report: MilitaryPerformanceReport = {
        schemaVersion: '1.0.0',
        reportId: brand<string, 'PerformanceReportId'>(
          uuid('performance-report'),
        ),
        reportRevision: brand<number, 'Revision'>(1),
        evaluationRequestId: record.request.evaluationRequestId,
        requestHash: frozen.dataset.requestHash,
        datasetHash: frozen.dataset.datasetHash,
        datasetArtifact: frozen.manifest.datasetArtifact,
        period: record.request.period,
        dataQuality: {
          militarySessions: new Set(attempts.map(value =>
            value.identity.sessionId)).size,
          templateRevisions: new Set(attempts.map(value =>
            `${String(value.configuration.templateId)}@${Number(value.configuration.templateRevision)}`)).size,
          uniqueAttempts: attempts.length,
          uniqueMissions: new Set(attempts.map(value =>
            value.identity.missionId)).size,
          missingEventRate: ratio(
            attempts.filter(value =>
              value.failure.missingReason !== undefined).length,
            attempts.length,
          ),
          notes: dataQualityNotes(frozen.dataset, results),
        },
        individualPerformance: results,
        overallPerformance: {
          missionCompletionRate: ratio(
            [...missionStates.values()].filter(Boolean).length,
            missionStates.size,
          ),
          taskFinalAcceptanceRate: ratio(
            attempts.filter(value => value.outcome.finalAccepted).length,
            attempts.length,
          ),
          crossDepartmentHandoffRate: ratio(
            completedHandoffs.filter(value =>
              value.outcome.handoffComplete).length,
            completedHandoffs.length,
          ),
          radioResolutionRate: ratio(
            radioAttempts.filter(value => value.outcome.finalAccepted).length,
            radioAttempts.length,
          ),
          freezeRecoveryRate: ratio(
            frozenAttempts.filter(value =>
              value.outcome.recoverySucceeded).length,
            frozenAttempts.length,
          ),
          specsCommitCoverageRate: ratio(
            engineerAccepted.filter(value =>
              value.outcome.handoffComplete).length,
            engineerAccepted.length,
          ),
          analysisPoints: nonEmpty(
            synthesis.analysisPoints,
            `${attempts.length} 个唯一 Attempt 已完成确定性评估。`,
          ),
        },
        comparisons,
        decision,
        priorityRecommendations:
          synthesis.priorityRecommendations.length === 0
            ? [{
                priority: 1,
                owner: 'Military Evaluation Committee',
                action: attempts.length === 0
                  ? '收集受治理的 Military Attempt 后重新评估。'
                  : '继续扩大 exact configuration 的受控样本。',
                successMetric: '达到动态样本充分性且所有安全硬门保持通过。',
              }]
            : synthesis.priorityRecommendations,
        unsupportedConclusions: [
          ...new Set([
            ...synthesis.unsupportedConclusions,
            '观察性会话不能单独证明模型或模板的因果优势。',
            '确定性九场景合同门不能冒充真实 Provider 表现。',
          ]),
        ],
        classification: record.request.reportClassification,
        sourceArtifactRefs: [frozen.manifest.datasetArtifact],
        createdAt: now(this.#clock),
      }

      record.run = { ...record.run, state: 'VALIDATING_REPORT' }
      await this.#save(record)
      validateReportInvariants(report)
      this.#schemaValidation?.report(report)
      record.report = cloneFrozen(report)
      record.run = {
        ...record.run,
        state: 'COMPLETED',
        reportId: String(report.reportId),
      }
      await this.#save(record)
      return cloneFrozen(report)
    } catch (error) {
      if (!signal.aborted && !record.cancelled) {
        const failure = asMilitaryFailure(
          budget.timedOut
            ? new MilitaryError(
                'CAPACITY_EXHAUSTED',
                `evaluation execution exceeded ${budget.timeoutSeconds} seconds`,
                { reason: 'EVALUATION_TIMEOUT' },
              )
            : error,
        )
        record.run = {
          ...record.run,
          state: 'FAILED',
          failure: {
            code: failure.code,
            message: safeRunFailure(failure.message),
            failedAt: brand<string, 'IsoDateTime'>(now(this.#clock)),
            retryable: failure.retryable,
          },
        }
        try {
          await this.#save(record)
        } catch {
          // A concurrent cancel or expired fence is authoritative. Do not
          // replace the original execution failure with a best-effort status
          // persistence error.
        }
      }
      throw error
    } finally {
      budget.dispose()
      await this.#releaseLease(lease)
    }
  }

  async get(evaluationRequestId: EvaluationRequestId): Promise<PerformanceEvaluationRun> {
    return cloneFrozen((await this.#require(evaluationRequestId)).run)
  }

  async listTemplateResults(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<readonly AgentTemplatePerformance[]> {
    return cloneFrozen((await this.#require(evaluationRequestId)).results)
  }

  async report(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<MilitaryPerformanceReport | null> {
    const report = (await this.#require(evaluationRequestId)).report
    return report === null ? null : cloneFrozen(report)
  }

  async cancel(evaluationRequestId: EvaluationRequestId): Promise<void> {
    const record = await this.#require(evaluationRequestId)
    if (record.report !== null) return
    record.cancelled = true
    record.run = { ...record.run, state: 'CANCELLED' }
    await this.#save(record)
  }

  async #require(id: EvaluationRequestId): Promise<EvaluationRecord> {
    const record = await this.#load(id)
    if (record === undefined) throw new MilitaryError('NOT_FOUND')
    return record
  }

  async #load(id: EvaluationRequestId): Promise<EvaluationRecord | undefined> {
    const key = String(id)
    const inMemory = this.#records.get(key)
    if (inMemory !== undefined) return inMemory
    const persisted = await this.#store?.read(id)
    if (persisted === null || persisted === undefined) return undefined
    const record: EvaluationRecord = {
      request: cloneFrozen(persisted.request),
      run: cloneFrozen(persisted.run),
      results: cloneFrozen(persisted.results) as AgentTemplatePerformance[],
      report: persisted.report === null ? null : cloneFrozen(persisted.report),
      dataset: null,
      cancelled: persisted.cancelled,
    }
    this.#records.set(key, record)
    return record
  }

  async #save(record: EvaluationRecord): Promise<void> {
    this.#records.set(String(record.request.evaluationRequestId), record)
    if (this.#store === undefined) return
    const lease = this.#activeLeases.get(
      String(record.request.evaluationRequestId),
    )
    if (lease !== undefined) {
      await this.#store.renew?.(lease, leaseExpiry())
    }
    await this.#store.write({
      schemaVersion: '1.0.0',
      request: cloneFrozen(record.request),
      run: cloneFrozen(record.run),
      results: cloneFrozen(record.results),
      report: record.report === null ? null : cloneFrozen(record.report),
      cancelled: record.cancelled,
      updatedAt: now(this.#clock),
    }, lease)
  }

  async #acquireLease(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<EvaluationLeaseFence | undefined> {
    if (this.#store?.acquire === undefined) return undefined
    const owner = uuid('evaluation-worker')
    const lease = await this.#store.acquire(
      evaluationRequestId,
      owner,
      leaseExpiry(),
    )
    if (lease === null) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        'evaluation is already leased by another worker',
      )
    }
    this.#activeLeases.set(String(evaluationRequestId), lease)
    return lease
  }

  async #releaseLease(
    lease: EvaluationLeaseFence | undefined,
  ): Promise<void> {
    if (lease === undefined) return
    this.#activeLeases.delete(String(lease.evaluationRequestId))
    await this.#store?.release?.(lease)
  }

  async #withLeaseHeartbeat<T>(
    lease: EvaluationLeaseFence | undefined,
    parentSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (lease === undefined || this.#store?.renew === undefined) {
      return await operation(parentSignal)
    }
    const controller = new AbortController()
    const abort = (): void => controller.abort(parentSignal.reason)
    if (parentSignal.aborted) abort()
    else parentSignal.addEventListener('abort', abort, { once: true })
    let renewalFailure: unknown
    let renewal: Promise<void> | null = null
    const renew = (): Promise<void> => {
      if (renewal !== null) return renewal
      renewal = (async () => {
        const active = this.#activeLeases.get(
          String(lease.evaluationRequestId),
        )
        if (
          active === undefined
          || active.owner !== lease.owner
          || active.version !== lease.version
        ) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            'evaluation lease fence is no longer active',
          )
        }
        await this.#store!.renew!(lease, leaseExpiry())
      })().finally(() => {
        renewal = null
      })
      return renewal
    }
    await renew()
    const timer = setInterval(() => {
      void renew().catch(error => {
        renewalFailure = error
        controller.abort(error)
      })
    }, 45_000)
    try {
      const result = await operation(controller.signal)
      if (renewal !== null) await renewal
      if (renewalFailure !== undefined) throw renewalFailure
      parentSignal.throwIfAborted()
      await renew()
      return result
    } finally {
      clearInterval(timer)
      parentSignal.removeEventListener('abort', abort)
    }
  }
}
