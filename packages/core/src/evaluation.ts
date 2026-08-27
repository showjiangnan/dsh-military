import {
  MilitaryError,
  asMilitaryFailure,
  brand,
  type AgentTemplatePerformance,
  type EvaluationAttemptRecord,
  type EvaluationConfigurationComparison,
  type EvaluationDatasetManifest,
  type EvaluationNumericInterval,
  type EvaluationRateInterval,
  type EvaluationRequestId,
  type FrozenEvaluationDataset,
  type MilitaryEvaluation,
  type MilitaryEvaluationDataset,
  type MilitaryPerformanceReport,
  type PerformanceEvaluationRequest,
  type PerformanceEvaluationRun,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, uuid, type Clock } from './util.js'

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
    const key = String(input.evaluationRequestId)
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
        ?? await this.#datasets.build(record.request, budget.signal)
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
        const narrative = await this.#narrative.analyze({
          request: record.request,
          performance: base,
          signal: budget.signal,
        })
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

      const synthesis = await this.#narrative.synthesize({
        request: record.request,
        individual: results,
        dataset: frozen.dataset,
        signal: budget.signal,
      })
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
}

function leaseExpiry(): string {
  return new Date(Date.now() + 5 * 60_000).toISOString()
}

function executionBudget(
  parent: AbortSignal,
  timeoutSeconds: number,
): {
  readonly signal: AbortSignal
  readonly timeoutSeconds: number
  readonly timedOut: boolean
  dispose(): void
} {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = (): void => {
    controller.abort(parent.reason)
  }
  if (parent.aborted) forwardAbort()
  else parent.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new MilitaryError(
      'CAPACITY_EXHAUSTED',
      `evaluation execution exceeded ${timeoutSeconds} seconds`,
      { reason: 'EVALUATION_TIMEOUT' },
    ))
  }, timeoutSeconds * 1_000)
  return {
    signal: controller.signal,
    timeoutSeconds,
    get timedOut() { return timedOut },
    dispose() {
      clearTimeout(timer)
      parent.removeEventListener('abort', forwardAbort)
    },
  }
}

function safeRunFailure(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/gu, ' ').slice(0, 1_000)
}

export function exactConfigurationKey(
  attempt: EvaluationAttemptRecord,
): string {
  const value = attempt.configuration
  return [
    value.role,
    `${String(value.templateId)}@${Number(value.templateRevision)}`,
    `prompt@${value.promptRevision}`,
    value.configurationHash,
    `${value.provider}/${value.model}`,
    value.aliasStatus,
    value.reasoningEffort,
    `${value.toolProfile.id}@${Number(value.toolProfile.revision)}`,
    `${value.permissionProfile.id}@${Number(value.permissionProfile.revision)}`,
    value.presetGeneration,
    value.bundleVersion,
    value.dshCommit,
  ].join('\u0000')
}

export function exactConfigurationGroups(
  attempts: readonly EvaluationAttemptRecord[],
): Map<string, EvaluationAttemptRecord[]> {
  const result = new Map<string, EvaluationAttemptRecord[]>()
  for (const attempt of attempts) {
    const key = exactConfigurationKey(attempt)
    const values = result.get(key) ?? []
    values.push(attempt)
    result.set(key, values)
  }
  return result
}

function computePerformance(
  request: PerformanceEvaluationRequest,
  attempts: readonly EvaluationAttemptRecord[],
  dataset: FrozenEvaluationDataset,
  clock: Clock,
): AgentTemplatePerformance {
  const first = attempts[0]
  if (first === undefined) {
    throw new MilitaryError('EVALUATION_INSUFFICIENT_DATA')
  }
  const confidenceLevel = request.confidenceLevel ?? 0.95
  const accepted = attempts.filter(value => value.outcome.finalAccepted)
  const completed = attempts.filter(value => value.outcome.completed)
  const firstPass = attempts.filter(value => value.outcome.firstPassAccepted)
  const falseCompletion = attempts.filter(value =>
    value.outcome.declaredCompleteWithoutEvidence)
  const verifierObserved = attempts.filter(value => value.outcome.verifierObserved)
  const evidenceSupported = accepted.filter(value =>
    value.evidenceRefs.length > 0 && value.outcome.verifierObserved)
  const toolClaimAccurate = attempts.filter(value =>
    value.failure.stage !== 'MODEL_TOOL_SELECTION'
    && value.failure.stage !== 'MODEL_ARGUMENT_SCHEMA')
  const blockerAttempts = attempts.filter(value => value.outcome.blockerCount > 0)
  const recoveryAttempts = attempts.filter(value => value.outcome.recoveryAttempted)
  const difficultyTotal = sum(attempts.map(value =>
    Math.max(1, value.task.preExecutionDifficulty)))
  const acceptedDifficulty = sum(attempts.map(value =>
    value.outcome.finalAccepted
      ? Math.max(1, value.task.preExecutionDifficulty)
      : 0))
  const capability = difficultyTotal === 0
    ? 0
    : acceptedDifficulty / difficultyTotal
  const finalAcceptanceInterval = clusteredRateInterval(
    attempts,
    value => value.outcome.finalAccepted,
    confidenceLevel,
    `${exactConfigurationKey(first)}:final-acceptance`,
  )
  const capabilityInterval = clusteredWeightedRateInterval(
    attempts,
    value => value.outcome.finalAccepted,
    value => Math.max(1, value.task.preExecutionDifficulty),
    confidenceLevel,
    `${exactConfigurationKey(first)}:capability`,
  )
  const acceptedOutcomes = acceptedOutcomeMetrics(attempts)
  const totalTokens = sum(acceptedOutcomes.map(value => value.tokens))
  const acceptedCosts = acceptedOutcomes
    .map(value => value.costUsd)
    .filter((value): value is number => value !== undefined)
  const costStatus = acceptedOutcomes.length === 0 || acceptedOutcomes.some(value =>
    value.costStatus === 'PROVIDER_PRICING_UNAVAILABLE')
    ? 'PROVIDER_PRICING_UNAVAILABLE' as const
    : acceptedOutcomes.some(value => value.costStatus === 'ESTIMATED')
      ? 'ESTIMATED' as const
      : 'OBSERVED' as const
  const configurationKey = exactConfigurationKey(first)
  const latencies = acceptedOutcomes.map(value => value.latencySeconds)
  const tokenInterval = clusteredMeanInterval(
    acceptedOutcomes,
    value => value.tokens,
    confidenceLevel,
    `${configurationKey}:tokens-per-accepted-outcome`,
  )
  const latencyInterval = clusteredMeanInterval(
    acceptedOutcomes,
    value => value.latencySeconds,
    confidenceLevel,
    `${configurationKey}:latency-per-accepted-outcome`,
  )
  const costInterval = acceptedOutcomes.length === 0
    || acceptedOutcomes.some(value => value.costUsd === undefined)
    ? undefined
    : clusteredMeanInterval(
        acceptedOutcomes,
        value => value.costUsd ?? 0,
        confidenceLevel,
        `${configurationKey}:cost-per-accepted-outcome`,
      )
  const pricingVersion = acceptedOutcomes.flatMap(value =>
    value.pricingVersions)[0]
  const uniqueMissions = new Set(attempts.map(value =>
    value.identity.missionId)).size
  const coverageByTaskType = Object.fromEntries(
    [...new Set(attempts.map(value => value.task.taskType))].sort()
      .map(taskType => [
        taskType,
        attempts.filter(value => value.task.taskType === taskType).length,
      ]),
  )
  const selectionBiasNotes = selectionBias(attempts)
  const missingEventRate = ratio(
    attempts.filter(value => value.failure.missingReason !== undefined).length,
    attempts.length,
  )
  const primaryIntervalWidth = round(
    finalAcceptanceInterval.high - finalAcceptanceInterval.low,
  )
  const requiredMissions = Math.min(
    10,
    Math.max(3, Math.ceil(Math.sqrt(request.minimumSamples))),
  )
  const sufficiencyCriteria = [
    criterion('唯一 Attempt 数', attempts.length, request.minimumSamples),
    criterion('独立 Mission 数', uniqueMissions, requiredMissions),
    criterionAtMost('主质量区间宽度', primaryIntervalWidth, 0.3),
    criterionAtMost('缺失事件率', missingEventRate, 0.1),
    criterion(
      'Verifier 覆盖率',
      ratio(verifierObserved.length, attempts.length),
      0.95,
    ),
    criterion(
      'exact-route 覆盖率',
      ratio(attempts.filter(value =>
        value.configuration.aliasStatus === 'EXACT_ROUTE_OBSERVED').length,
      attempts.length),
      1,
    ),
  ] satisfies AgentTemplatePerformance['dataQuality']['sufficiencyCriteria']
  const sufficient = sufficiencyCriteria.every(value => value.passed)
  const baseLimitations = [
    ...(sufficient
      ? []
      : [`唯一 Attempt/Mission 样本未达到最低要求 ${request.minimumSamples}。`]),
    ...(first.configuration.aliasStatus !== 'EXACT_ROUTE_OBSERVED'
      ? [first.configuration.aliasStatus === 'FALLBACK_CHAIN_OBSERVED'
          ? 'Attempt 包含 Provider fallback 链，只能作为混合路由诊断，不能用于模型晋升。'
          : 'Provider alias 未形成 exact-route 证据，不能用于模型晋升。']
      : []),
    ...selectionBiasNotes,
  ]
  const baseRecommendations: AgentTemplatePerformance['recommendations'] =
    recommendationFor(attempts)
  return {
    schemaVersion: '1.0.0',
    performanceId: brand<string, 'PerformanceId'>(uuid('template-performance')),
    evaluationRequestId: request.evaluationRequestId,
    template: {
      configurationKey,
      templateId: first.configuration.templateId,
      revision: first.configuration.templateRevision,
      role: first.configuration.role,
      department: first.configuration.department,
      promptRevision: first.configuration.promptRevision,
      configurationHash: first.configuration.configurationHash,
      provider: first.configuration.provider,
      model: first.configuration.model,
      aliasStatus: first.configuration.aliasStatus,
      reasoningEffort: first.configuration.reasoningEffort,
      toolProfile: first.configuration.toolProfile,
      permissionProfile: first.configuration.permissionProfile,
      presetGeneration: first.configuration.presetGeneration,
      bundleVersion: first.configuration.bundleVersion,
      dshRelease: first.configuration.dshRelease,
      dshCommit: first.configuration.dshCommit,
    },
    period: request.period,
    sample: {
      missions: new Set(attempts.map(value => value.identity.missionId)).size,
      eligibleTasks: attempts.length,
      assignedAttempts: attempts.length,
      completedAttempts: completed.length,
      acceptedContributions: accepted.length,
      consultations: attempts.filter(value => value.task.taskType === 'consultation').length,
      sessions: new Set(attempts.map(value => value.identity.sessionId)).size,
    },
    participation: {
      rate: ratio(attempts.length, dataset.attempts.length),
      coverageByTaskType,
    },
    accuracy: {
      firstPassAcceptanceRate: ratio(firstPass.length, attempts.length),
      finalAcceptanceRate: ratio(accepted.length, attempts.length),
      claimEvidenceSupportRate: ratio(evidenceSupported.length, accepted.length),
      toolClaimAccuracy: ratio(toolClaimAccurate.length, attempts.length),
      falseCompletionRate: ratio(falseCompletion.length, attempts.length),
      regressionEscapeRate: ratio(
        attempts.filter(value => value.outcome.regressionEscape).length,
        attempts.length,
      ),
      intervals: {
        firstPassAcceptance: clusteredRateInterval(
          attempts,
          value => value.outcome.firstPassAccepted,
          confidenceLevel,
          `${configurationKey}:first-pass`,
        ),
        finalAcceptance: finalAcceptanceInterval,
        falseCompletion: clusteredRateInterval(
          attempts,
          value => value.outcome.declaredCompleteWithoutEvidence,
          confidenceLevel,
          `${configurationKey}:false-completion`,
        ),
      },
    },
    completion: {
      completionRate: ratio(completed.length, attempts.length),
      meanReworkCount: mean(attempts.map(value => value.outcome.reworkCount)),
      blockerResolutionRate: ratio(
        blockerAttempts.filter(value => value.outcome.finalAccepted).length,
        blockerAttempts.length,
      ),
      handoffCompletenessRate: ratio(
        completed.filter(value => value.outcome.handoffComplete).length,
        completed.length,
      ),
      parentWakeupRate: ratio(
        completed.filter(value => value.outcome.parentWakeup).length,
        completed.length,
      ),
    },
    capability: {
      index: round(capability * 100),
      rubricVersion: 'capability-rubric-2.0.0',
      difficultyAdjustment: '预执行 difficulty-v2 加权；结果期 rework/blocker/Radio 不进入原始难度。',
      confidenceInterval: {
        low: round(capabilityInterval.low * 100),
        high: round(capabilityInterval.high * 100),
      },
    },
    reliability: {
      freezeIncidentRate: ratio(
        attempts.filter(value => value.outcome.frozen).length,
        attempts.length,
      ),
      permissionViolationRate: ratio(
        attempts.filter(value => value.outcome.permissionViolation).length,
        attempts.length,
      ),
      staleSubmissionRate: ratio(
        attempts.filter(value => value.outcome.staleSubmission).length,
        attempts.length,
      ),
      recoverySuccessRate: ratio(
        recoveryAttempts.filter(value => value.outcome.recoverySucceeded).length,
        recoveryAttempts.length,
      ),
      terminalDuplicateRate: ratio(
        attempts.filter(value =>
          value.outcome.terminalDuplicate === true).length,
        attempts.length,
      ),
      recoveryDriftRate: ratio(
        attempts.filter(value =>
          value.outcome.recoveryDrift === true).length,
        attempts.length,
      ),
    },
    efficiency: {
      acceptedOutcomeCount: acceptedOutcomes.length,
      meanTokensPerAcceptedOutcome: ratio(
        totalTokens,
        acceptedOutcomes.length,
      ),
      meanLatencySeconds: mean(latencies),
      p50LatencySeconds: percentile(latencies, 0.5),
      p95LatencySeconds: percentile(latencies, 0.95),
      meanModelSteps: mean(acceptedOutcomes.map(value => value.modelSteps)),
      meanCorrections: mean(attempts.map(value => value.usage.correctionCount)),
      compactionAttemptCount: sum(attempts.map(value =>
        value.usage.compactionAttempts)),
      compactionSuccessRate: ratio(
        sum(attempts.map(value => value.usage.compactionSuccesses)),
        sum(attempts.map(value => value.usage.compactionAttempts)),
      ),
      costStatus,
      ...(costStatus === 'PROVIDER_PRICING_UNAVAILABLE' || acceptedCosts.length === 0
        ? {}
        : {
            meanCostPerAcceptedOutcomeUsd: round(
              sum(acceptedCosts) / acceptedOutcomes.length,
              8,
            ),
            ...(pricingVersion === undefined ? {} : { pricingVersion }),
          }),
      intervals: {
        tokensPerAcceptedOutcome: tokenInterval,
        latencyPerAcceptedOutcomeSeconds: latencyInterval,
        ...(costInterval === undefined
          ? {}
          : { costPerAcceptedOutcomeUsd: costInterval }),
      },
    },
    dataQuality: {
      missingEventRate,
      verifierCoverageRate: ratio(verifierObserved.length, attempts.length),
      sampleSufficient: sufficient,
      uniqueAttemptCount: attempts.length,
      uniqueMissionCount: uniqueMissions,
      effectiveIndependentMissionCount: uniqueMissions,
      primaryIntervalWidth,
      sufficiencyCriteria,
      selectionBiasNotes,
    },
    failureAttribution: failureAttribution(attempts),
    analyses: [
      `最终验收率 ${(ratio(accepted.length, attempts.length) * 100).toFixed(1)}%。`,
      `首次验收率 ${(ratio(firstPass.length, attempts.length) * 100).toFixed(1)}%。`,
    ],
    recommendations: baseRecommendations,
    limitations: baseLimitations,
    confidence: confidenceScore(
      attempts.length,
      request.minimumSamples,
      finalAcceptanceInterval,
      missingEventRate,
    ),
    status: sufficient ? 'VALID' : 'INSUFFICIENT_DATA',
    evidenceRefs: uniqueEvidence(attempts),
    createdAt: now(clock),
  }
}

export function wilson(
  numerator: number,
  denominator: number,
  confidenceLevel = 0.95,
): EvaluationRateInterval {
  if (denominator <= 0) {
    return {
      estimate: 0,
      low: 0,
      high: 1,
      confidenceLevel,
      numerator: 0,
      denominator: 0,
    }
  }
  const p = numerator / denominator
  const z = zScore(confidenceLevel)
  const z2 = z * z
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator)
  const margin = z * Math.sqrt(
    (p * (1 - p) + z2 / (4 * denominator)) / denominator,
  ) / (1 + z2 / denominator)
  return {
    estimate: round(p),
    low: round(Math.max(0, center - margin)),
    high: round(Math.min(1, center + margin)),
    confidenceLevel,
    numerator,
    denominator,
  }
}

/**
 * Mission-clustered deterministic bootstrap. Mission is the independent unit;
 * repeated Task attempts inside one Mission are resampled together.
 */
export function clusteredRateInterval(
  attempts: readonly EvaluationAttemptRecord[],
  outcome: (attempt: EvaluationAttemptRecord) => boolean,
  confidenceLevel = 0.95,
  seed = 'military-evaluation',
): EvaluationRateInterval {
  const numerator = attempts.filter(outcome).length
  const denominator = attempts.length
  const fallback = wilson(numerator, denominator, confidenceLevel)
  const clusters = missionClusters(attempts)
  if (clusters.length < 2 || denominator === 0) return fallback
  const random = deterministicRandom(seed)
  const values: number[] = []
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    let selected = 0
    let successes = 0
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      if (cluster === undefined) continue
      selected += cluster.length
      successes += cluster.filter(outcome).length
    }
    values.push(selected === 0 ? 0 : successes / selected)
  }
  const alpha = (1 - confidenceLevel) / 2
  const bootstrapLow = percentile(values, alpha)
  const bootstrapHigh = percentile(values, 1 - alpha)
  return {
    estimate: ratio(numerator, denominator),
    // The Wilson envelope prevents a small number of homogeneous clusters from
    // yielding an implausibly degenerate bootstrap interval.
    low: round(Math.min(fallback.low, bootstrapLow)),
    high: round(Math.max(fallback.high, bootstrapHigh)),
    confidenceLevel,
    numerator,
    denominator,
  }
}

function clusteredWeightedRateInterval(
  attempts: readonly EvaluationAttemptRecord[],
  outcome: (attempt: EvaluationAttemptRecord) => boolean,
  weight: (attempt: EvaluationAttemptRecord) => number,
  confidenceLevel: number,
  seed: string,
): EvaluationRateInterval {
  const denominator = sum(attempts.map(value => Math.max(0, weight(value))))
  const numerator = sum(attempts.map(value =>
    outcome(value) ? Math.max(0, weight(value)) : 0))
  const estimate = ratio(numerator, denominator)
  const fallback = wilson(
    attempts.filter(outcome).length,
    attempts.length,
    confidenceLevel,
  )
  const clusters = missionClusters(attempts)
  if (clusters.length < 2 || denominator === 0) {
    return {
      ...fallback,
      estimate,
      numerator: round(numerator),
      denominator: round(denominator),
    }
  }
  const random = deterministicRandom(seed)
  const values: number[] = []
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    let selectedWeight = 0
    let acceptedWeight = 0
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      if (cluster === undefined) continue
      for (const attempt of cluster) {
        const currentWeight = Math.max(0, weight(attempt))
        selectedWeight += currentWeight
        if (outcome(attempt)) acceptedWeight += currentWeight
      }
    }
    values.push(ratio(acceptedWeight, selectedWeight))
  }
  const alpha = (1 - confidenceLevel) / 2
  return {
    estimate,
    low: round(Math.min(fallback.low, percentile(values, alpha))),
    high: round(Math.max(
      fallback.high,
      percentile(values, 1 - alpha),
    )),
    confidenceLevel,
    numerator: round(numerator),
    denominator: round(denominator),
  }
}

function configurationComparisons(
  request: PerformanceEvaluationRequest,
  results: readonly AgentTemplatePerformance[],
  attempts: readonly EvaluationAttemptRecord[],
): readonly EvaluationConfigurationComparison[] {
  if (request.comparisonBaseline === 'none') return []
  if (request.comparisonBaseline !== 'same-role-same-difficulty') return []
  const attemptsByConfiguration = exactConfigurationGroups(attempts)
  const byRole = new Map<string, AgentTemplatePerformance[]>()
  for (const result of results) {
    const values = byRole.get(result.template.role) ?? []
    values.push(result)
    byRole.set(result.template.role, values)
  }
  const comparisons: EvaluationConfigurationComparison[] = []
  for (const [role, values] of byRole) {
    const candidates = values.filter(value =>
      /flash/iu.test(value.template.model)
      && value.template.aliasStatus === 'EXACT_ROUTE_OBSERVED')
    const baselines = values.filter(value =>
      /pro/iu.test(value.template.model)
      && value.template.aliasStatus === 'EXACT_ROUTE_OBSERVED')
    for (const candidate of candidates) {
      const rankedBaselines = [...baselines].sort((left, right) => {
        const leftConfounds = configurationConfounds(candidate, left).length
        const rightConfounds = configurationConfounds(candidate, right).length
        return leftConfounds - rightConfounds
          || right.sample.assignedAttempts - left.sample.assignedAttempts
          || left.template.configurationKey.localeCompare(
            right.template.configurationKey,
          )
      })
      const baseline = rankedBaselines[0]
      if (baseline === undefined) continue
      const candidateAttempts = attemptsByConfiguration.get(
        candidate.template.configurationKey,
      ) ?? []
      const baselineAttempts = attemptsByConfiguration.get(
        baseline.template.configurationKey,
      ) ?? []
      const margin = request.nonInferiorityMargin ?? 0.05
      const candidateRate = candidate.accuracy.intervals.finalAcceptance
      const baselineRate = baseline.accuracy.intervals.finalAcceptance
      const difference = clusteredDifferenceInterval(
        candidateAttempts,
        baselineAttempts,
        request.confidenceLevel ?? 0.95,
        `${candidate.template.configurationKey}:${baseline.template.configurationKey}`,
      )
      const balance = covariateBalance(candidateAttempts, baselineAttempts)
      const hardReasons = hardGateReasons(candidate, candidateAttempts)
      const confounds = configurationConfounds(candidate, baseline)
      const candidateTokens = candidate.efficiency.meanTokensPerAcceptedOutcome
      const baselineTokens = baseline.efficiency.meanTokensPerAcceptedOutcome
      const blockers = [
        ...(candidate.template.aliasStatus !== 'EXACT_ROUTE_OBSERVED'
          ? ['Flash candidate 缺少单一路由 exact-route 证据。']
          : []),
        ...(candidate.status !== 'VALID'
          ? ['Flash candidate 样本不足。']
          : []),
        ...(baseline.status !== 'VALID'
          ? ['Pro baseline 样本不足。']
          : []),
        ...(balance.balanced
          ? []
          : ['候选与基线的任务类型或预执行难度不平衡。']),
        ...confounds,
        ...(difference.low < -margin
          ? [`最终验收率差异下界低于非劣界限 -${(margin * 100).toFixed(1)}pp。`]
          : []),
        ...hardReasons,
      ]
      const nonInferior = difference.low >= -margin
      const candidateMissionIds = new Set(candidateAttempts.map(value =>
        value.identity.missionId))
      const pairedMissions = new Set(baselineAttempts
        .map(value => value.identity.missionId)
        .filter(value => candidateMissionIds.has(value))).size
      const design: EvaluationConfigurationComparison['design'] =
        pairedMissions >= 3 ? 'PAIRED_MISSION' : 'OBSERVATIONAL'
      const decision: EvaluationConfigurationComparison['decision'] =
        hardReasons.length > 0
          ? 'REGRESSION_ALERT'
          : candidate.sample.assignedAttempts < request.minimumSamples
            ? candidate.sample.assignedAttempts < 5
              ? 'EARLY_SIGNAL'
              : 'EXPLORATORY'
            : nonInferior && blockers.length === 0
              ? 'DECISION_ELIGIBLE'
              : 'EXPLORATORY'
      comparisons.push({
        comparisonId: `${role}:${candidate.template.configurationKey}:${baseline.template.configurationKey}`,
        role: candidate.template.role,
        candidateConfigurationKey: candidate.template.configurationKey,
        baselineConfigurationKey: baseline.template.configurationKey,
        design,
        observational: true,
        sample: {
          candidateAttempts: candidate.sample.assignedAttempts,
          baselineAttempts: baseline.sample.assignedAttempts,
          candidateMissions: candidate.sample.missions,
          baselineMissions: baseline.sample.missions,
        },
        quality: {
          candidateFinalAcceptance: candidateRate,
          baselineFinalAcceptance: baselineRate,
          difference,
          nonInferiorityMargin: margin,
          nonInferior,
          intervalMethod: 'MISSION_CLUSTER_BOOTSTRAP',
        },
        covariateBalance: balance,
        safety: {
          candidateIncidents: safetyIncidentCount(candidateAttempts),
          baselineIncidents: safetyIncidentCount(baselineAttempts),
          hardGatePassed: hardReasons.length === 0,
          reasons: hardReasons,
        },
        efficiency: {
          candidateTokensPerAcceptedOutcome: candidateTokens,
          baselineTokensPerAcceptedOutcome: baselineTokens,
          ...(baselineTokens <= 0
            ? {}
            : { tokenImprovementRate: round((baselineTokens - candidateTokens) / baselineTokens) }),
          candidateCostStatus: candidate.efficiency.costStatus,
          baselineCostStatus: baseline.efficiency.costStatus,
          ...(candidate.efficiency.meanCostPerAcceptedOutcomeUsd === undefined
            ? {}
            : { candidateCostPerAcceptedOutcomeUsd: candidate.efficiency.meanCostPerAcceptedOutcomeUsd }),
          ...(baseline.efficiency.meanCostPerAcceptedOutcomeUsd === undefined
            ? {}
            : { baselineCostPerAcceptedOutcomeUsd: baseline.efficiency.meanCostPerAcceptedOutcomeUsd }),
          candidateLatencyPerAcceptedOutcomeSeconds:
            candidate.efficiency.meanLatencySeconds,
          baselineLatencyPerAcceptedOutcomeSeconds:
            baseline.efficiency.meanLatencySeconds,
          ...(baseline.efficiency.meanLatencySeconds <= 0
            ? {}
            : {
                latencyImprovementRate: round(
                  (baseline.efficiency.meanLatencySeconds
                    - candidate.efficiency.meanLatencySeconds)
                  / baseline.efficiency.meanLatencySeconds,
                ),
              }),
        },
        decision,
        blockers,
      })
    }
  }
  return comparisons
}

function reportDecision(
  request: PerformanceEvaluationRequest,
  results: readonly AgentTemplatePerformance[],
  comparisons: readonly EvaluationConfigurationComparison[],
): MilitaryPerformanceReport['decision'] {
  const standaloneHardGates = results
    .filter(value =>
      /flash/iu.test(value.template.model)
      && value.template.aliasStatus === 'EXACT_ROUTE_OBSERVED')
    .flatMap(value => hardGateReasons(value, []))
  const regression = standaloneHardGates.length > 0
    || comparisons.some(value => value.decision === 'REGRESSION_ALERT')
  const eligible = comparisons.some(value =>
    value.decision === 'DECISION_ELIGIBLE')
  const blockers = [...new Set([
    ...(request.comparisonBaseline !== 'none'
      && request.comparisonBaseline !== 'same-role-same-difficulty'
      ? [`当前报告没有可验证的 ${request.comparisonBaseline} 冻结基线；未执行跨数据集比较。`]
      : []),
    ...(request.comparisonBaseline === 'same-role-same-difficulty'
      && results.length > 0
      && comparisons.length === 0
      ? ['没有找到同角色、同难度且 exact configuration 分离的 Flash/Pro 配对。']
      : []),
    ...standaloneHardGates,
    ...comparisons.flatMap(value => value.blockers),
  ])]
  const status: MilitaryPerformanceReport['decision']['status'] =
    results.length === 0
      ? 'NO_DATA'
      : regression
        ? 'REGRESSION_ALERT'
        : eligible
          ? 'DECISION_ELIGIBLE'
          : results.every(value => value.sample.assignedAttempts < 5)
            ? 'EARLY_SIGNAL'
            : 'EXPLORATORY'
  return {
    status,
    promotionAllowed: false,
    blockers,
    recommendation: status === 'DECISION_ELIGIBLE'
      ? '证据达到建议资格；仍需用户显式批准新的 Canary/Active revision。'
      : status === 'REGRESSION_ALERT'
        ? '存在安全或质量回归，阻止模型晋升。'
        : '继续收集 exact-route、同角色、同难度的受控样本。',
  }
}

function hardGateReasons(
  result: AgentTemplatePerformance,
  attempts: readonly EvaluationAttemptRecord[],
): readonly string[] {
  return [
    ...(result.reliability.permissionViolationRate > 0
      ? ['存在权限越界事件。']
      : []),
    ...(result.accuracy.falseCompletionRate > 0
      ? ['存在无证据完成事件。']
      : []),
    ...(result.accuracy.regressionEscapeRate > 0
      ? ['存在回归逃逸事件。']
      : []),
    ...(result.completion.parentWakeupRate < 1
      && result.sample.completedAttempts > 0
      ? ['存在父级未恢复事件。']
      : []),
    ...(result.reliability.terminalDuplicateRate > 0
      || attempts.some(value => value.outcome.terminalDuplicate === true)
      ? ['存在终态工具重复成功调用。']
      : []),
    ...(result.reliability.recoveryDriftRate > 0
      || attempts.some(value => value.outcome.recoveryDrift === true)
      ? ['存在恢复后的身份、版本或 Workspace 漂移。']
      : []),
  ]
}

function differenceInterval(
  candidate: EvaluationRateInterval,
  baseline: EvaluationRateInterval,
): { readonly estimate: number; readonly low: number; readonly high: number } {
  return {
    estimate: round(candidate.estimate - baseline.estimate),
    low: round(candidate.low - baseline.high),
    high: round(candidate.high - baseline.low),
  }
}

function clusteredDifferenceInterval(
  candidate: readonly EvaluationAttemptRecord[],
  baseline: readonly EvaluationAttemptRecord[],
  confidenceLevel: number,
  seed: string,
): { readonly estimate: number; readonly low: number; readonly high: number } {
  const candidateRate = clusteredRateInterval(
    candidate,
    value => value.outcome.finalAccepted,
    confidenceLevel,
    `${seed}:candidate`,
  )
  const baselineRate = clusteredRateInterval(
    baseline,
    value => value.outcome.finalAccepted,
    confidenceLevel,
    `${seed}:baseline`,
  )
  const conservative = differenceInterval(candidateRate, baselineRate)
  const candidateByMission = new Map(missionClusters(candidate).map(cluster => [
    cluster[0]!.identity.missionId,
    cluster,
  ]))
  const baselineByMission = new Map(missionClusters(baseline).map(cluster => [
    cluster[0]!.identity.missionId,
    cluster,
  ]))
  const pairedMissionIds = [...candidateByMission.keys()]
    .filter(value => baselineByMission.has(value))
    .sort()
  const random = deterministicRandom(`${seed}:difference`)
  const values: number[] = []
  if (pairedMissionIds.length >= 3) {
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      const candidateSample: EvaluationAttemptRecord[] = []
      const baselineSample: EvaluationAttemptRecord[] = []
      for (let index = 0; index < pairedMissionIds.length; index += 1) {
        const missionId = pairedMissionIds[
          Math.floor(random() * pairedMissionIds.length)
        ]
        if (missionId === undefined) continue
        candidateSample.push(...(candidateByMission.get(missionId) ?? []))
        baselineSample.push(...(baselineByMission.get(missionId) ?? []))
      }
      values.push(
        ratio(
          candidateSample.filter(value =>
            value.outcome.finalAccepted).length,
          candidateSample.length,
        )
        - ratio(
          baselineSample.filter(value =>
            value.outcome.finalAccepted).length,
          baselineSample.length,
        ),
      )
    }
  } else {
    const candidateClusters = missionClusters(candidate)
    const baselineClusters = missionClusters(baseline)
    if (candidateClusters.length < 2 || baselineClusters.length < 2) {
      return conservative
    }
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      values.push(
        sampledClusterRate(candidateClusters, random)
        - sampledClusterRate(baselineClusters, random),
      )
    }
  }
  const alpha = (1 - confidenceLevel) / 2
  return {
    estimate: conservative.estimate,
    low: round(Math.min(conservative.low, percentile(values, alpha))),
    high: round(Math.max(
      conservative.high,
      percentile(values, 1 - alpha),
    )),
  }
}

function missionCompletionStates(
  attempts: readonly EvaluationAttemptRecord[],
): Map<string, boolean> {
  const states = new Map<string, boolean>()
  for (const attempt of attempts) {
    const current = states.get(attempt.identity.missionId) ?? false
    states.set(
      attempt.identity.missionId,
      current || attempt.outcome.missionCompleted,
    )
  }
  return states
}

function recommendationFor(
  attempts: readonly EvaluationAttemptRecord[],
): AgentTemplatePerformance['recommendations'] {
  const values: AgentTemplatePerformance['recommendations'][number][] = []
  if (ratio(attempts.filter(value =>
    value.failure.stage === 'MODEL_ARGUMENT_SCHEMA').length, attempts.length) > 0.02) {
    values.push({
      area: 'prompt',
      action: '缩短工具参数合同，并保留一次确定性纠正包。',
      priority: 'high',
    })
  }
  if (ratio(attempts.filter(value =>
    value.outcome.declaredCompleteWithoutEvidence).length, attempts.length) > 0) {
    values.push({
      area: 'verification',
      action: '加强完成互锁与 Host evidence 要求。',
      priority: 'critical',
    })
  }
  if (mean(attempts.map(value => value.outcome.reworkCount)) > 0.5) {
    values.push({
      area: 'task-design',
      action: '减少单个 Task 的独立决策数量并明确 Acceptance。',
      priority: 'high',
    })
  }
  if (values.length === 0) {
    values.push({
      area: 'model',
      action: '保持当前配置并继续收集受控比较样本。',
      priority: 'low',
    })
  }
  return values
}

function dataQualityNotes(
  dataset: FrozenEvaluationDataset,
  results: readonly AgentTemplatePerformance[],
): readonly string[] {
  const notes = [
    ...dataset.missingness.map(value =>
      `${value.field} 缺失 ${value.count} 条（${value.mechanism}）。`),
    ...results.flatMap(value => value.dataQuality.selectionBiasNotes),
  ]
  return notes.length === 0 ? ['未发现已知的结构性缺失。'] : [...new Set(notes)]
}

function selectionBias(
  attempts: readonly EvaluationAttemptRecord[],
): readonly string[] {
  const notes: string[] = []
  const taskTypes = new Set(attempts.map(value => value.task.taskType))
  if (taskTypes.size < 2 && attempts.length >= 5) {
    notes.push('任务类型覆盖单一，结论不可外推到其他任务类型。')
  }
  const missions = new Set(attempts.map(value => value.identity.missionId)).size
  if (attempts.length >= 5 && missions < Math.ceil(attempts.length / 3)) {
    notes.push('多个 Attempt 聚集在少量 Mission，独立样本数有限。')
  }
  if (attempts.some(value => value.outcome.userInterventionCount > 0)) {
    notes.push('部分结果包含用户介入，不能完全归因于模型或模板。')
  }
  return notes
}

function failureAttribution(
  attempts: readonly EvaluationAttemptRecord[],
): AgentTemplatePerformance['failureAttribution'] {
  const byStage: Record<string, number> = {}
  const byMissingReason: Record<string, number> = {}
  for (const attempt of attempts) {
    byStage[attempt.failure.stage] = (byStage[attempt.failure.stage] ?? 0) + 1
    if (attempt.failure.missingReason !== undefined) {
      byMissingReason[attempt.failure.missingReason] =
        (byMissingReason[attempt.failure.missingReason] ?? 0) + 1
    }
  }
  const failed = attempts.filter(value => value.failure.stage !== 'NONE')
  const modelStages = new Set([
    'MODEL_TOOL_SELECTION',
    'MODEL_ARGUMENT_SCHEMA',
    'VERIFICATION_FAILURE',
  ])
  const hostStages = new Set([
    'HOST_VALIDATION',
    'PERMISSION_DENIED',
    'PATH_SCOPE_REJECTION',
    'TOOL_RUNTIME',
    'WORKSPACE_STATE',
    'INTEGRATION_FAILURE',
    'PARENT_WAKEUP_FAILURE',
    'SYSTEM_CRASH',
  ])
  const externalStages = new Set([
    'PROVIDER_FAILURE',
    'EXTERNAL_DEPENDENCY',
    'USER_CANCELLATION',
    'MISSION_SCOPE_CHANGE',
  ])
  return {
    byStage,
    byMissingReason,
    modelCausedRate: ratio(
      failed.filter(value => modelStages.has(value.failure.stage)).length,
      failed.length,
    ),
    hostOrInfrastructureRate: ratio(
      failed.filter(value => hostStages.has(value.failure.stage)).length,
      failed.length,
    ),
    externalOrCancelledRate: ratio(
      failed.filter(value => externalStages.has(value.failure.stage)).length,
      failed.length,
    ),
    unknownRate: ratio(
      failed.filter(value => value.failure.stage === 'UNKNOWN'
        || value.failure.stage === 'TASK_ORDER_AMBIGUITY').length,
      failed.length,
    ),
  }
}

function configurationConfounds(
  candidate: AgentTemplatePerformance,
  baseline: AgentTemplatePerformance,
): readonly string[] {
  const reasons: string[] = []
  if (String(candidate.template.templateId)
    !== String(baseline.template.templateId)) {
    reasons.push('候选与基线的模板 ID 不同。')
  }
  if (Number(candidate.template.revision) !== Number(baseline.template.revision)) {
    reasons.push('候选与基线的模板修订不同。')
  }
  if (candidate.template.promptRevision !== baseline.template.promptRevision) {
    reasons.push('候选与基线的提示词修订不同。')
  }
  if (candidate.template.reasoningEffort !== baseline.template.reasoningEffort) {
    reasons.push('候选与基线的 reasoning effort 不同。')
  }
  if (
    candidate.template.toolProfile.id !== baseline.template.toolProfile.id
    || Number(candidate.template.toolProfile.revision)
      !== Number(baseline.template.toolProfile.revision)
  ) reasons.push('候选与基线的工具配置不同。')
  if (
    candidate.template.permissionProfile.id
      !== baseline.template.permissionProfile.id
    || Number(candidate.template.permissionProfile.revision)
      !== Number(baseline.template.permissionProfile.revision)
  ) reasons.push('候选与基线的权限配置不同。')
  if (candidate.template.presetGeneration !== baseline.template.presetGeneration) {
    reasons.push('候选与基线的 preset generation 不同。')
  }
  if (candidate.template.bundleVersion !== baseline.template.bundleVersion) {
    reasons.push('候选与基线的插件版本不同。')
  }
  if (candidate.template.dshCommit !== baseline.template.dshCommit) {
    reasons.push('候选与基线的 DSH commit 不同。')
  }
  if (candidate.template.provider !== baseline.template.provider) {
    reasons.push('候选与基线的 Provider 不同。')
  }
  return reasons
}

function covariateBalance(
  candidate: readonly EvaluationAttemptRecord[],
  baseline: readonly EvaluationAttemptRecord[],
): EvaluationConfigurationComparison['covariateBalance'] {
  const candidateTypes = new Set(candidate.map(value => value.task.taskType))
  const baselineTypes = new Set(baseline.map(value => value.task.taskType))
  const union = new Set([...candidateTypes, ...baselineTypes])
  const intersection = [...candidateTypes].filter(value =>
    baselineTypes.has(value)).length
  const taskTypeOverlapRate = ratio(intersection, union.size)
  const candidateDifficulties = candidate.map(value =>
    value.task.preExecutionDifficulty)
  const baselineDifficulties = baseline.map(value =>
    value.task.preExecutionDifficulty)
  const candidateMeanDifficulty = mean(candidateDifficulties)
  const baselineMeanDifficulty = mean(baselineDifficulties)
  const pooled = Math.sqrt(
    (variance(candidateDifficulties) + variance(baselineDifficulties)) / 2,
  )
  const standardizedDifficultyDifference = pooled === 0
    ? candidateMeanDifficulty === baselineMeanDifficulty ? 0 : 1
    : round((candidateMeanDifficulty - baselineMeanDifficulty) / pooled)
  const balanced = taskTypeOverlapRate >= 0.8
    && Math.abs(standardizedDifficultyDifference) <= 0.25
  const notes = [
    ...(taskTypeOverlapRate < 0.8
      ? ['任务类型重叠率低于 80%。']
      : []),
    ...(Math.abs(standardizedDifficultyDifference) > 0.25
      ? ['预执行难度标准化差异超过 0.25。']
      : []),
  ]
  return {
    taskTypeOverlapRate,
    candidateMeanDifficulty,
    baselineMeanDifficulty,
    standardizedDifficultyDifference,
    balanced,
    notes: notes.length === 0 ? ['已通过任务类型与预执行难度平衡检查。'] : notes,
  }
}

function safetyIncidentCount(
  attempts: readonly EvaluationAttemptRecord[],
): number {
  return attempts.filter(value =>
    value.outcome.permissionViolation
    || value.outcome.declaredCompleteWithoutEvidence
    || value.outcome.regressionEscape
    || value.outcome.terminalDuplicate === true
    || value.outcome.recoveryDrift === true
    || (value.outcome.completed && !value.outcome.parentWakeup)).length
}

function criterion(
  name: string,
  observed: number,
  required: number,
): AgentTemplatePerformance['dataQuality']['sufficiencyCriteria'][number] {
  return {
    criterion: name,
    passed: observed >= required,
    observed: round(observed),
    required: round(required),
  }
}

function criterionAtMost(
  name: string,
  observed: number,
  required: number,
): AgentTemplatePerformance['dataQuality']['sufficiencyCriteria'][number] {
  return {
    criterion: name,
    passed: observed <= required,
    observed: round(observed),
    required: round(required),
  }
}

interface AcceptedOutcomeMetric {
  readonly missionId: string
  readonly tokens: number
  readonly latencySeconds: number
  readonly modelSteps: number
  readonly costStatus:
    | 'OBSERVED'
    | 'ESTIMATED'
    | 'PROVIDER_PRICING_UNAVAILABLE'
  readonly costUsd?: number
  readonly pricingVersions: readonly string[]
}

/**
 * Economic outcomes include every retry/rework attempt for the accepted
 * logical Mission/Task under this exact configuration. Failed attempts are
 * therefore never made free by dividing only the successful attempt.
 */
function acceptedOutcomeMetrics(
  attempts: readonly EvaluationAttemptRecord[],
): readonly AcceptedOutcomeMetric[] {
  const groups = new Map<string, EvaluationAttemptRecord[]>()
  for (const attempt of attempts) {
    const key = `${attempt.identity.missionId}\u0000${attempt.identity.taskId}`
    const group = groups.get(key) ?? []
    group.push(attempt)
    groups.set(key, group)
  }
  const result: AcceptedOutcomeMetric[] = []
  for (const [, group] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (!group.some(value => value.outcome.finalAccepted)) continue
    const unavailable = group.some(value =>
      value.usage.costStatus === 'PROVIDER_PRICING_UNAVAILABLE'
      || value.usage.estimatedCostUsd === undefined)
    const estimated = group.some(value =>
      value.usage.costStatus === 'ESTIMATED')
    const costStatus: AcceptedOutcomeMetric['costStatus'] = unavailable
      ? 'PROVIDER_PRICING_UNAVAILABLE'
      : estimated ? 'ESTIMATED' : 'OBSERVED'
    result.push({
      missionId: group[0]!.identity.missionId,
      tokens: sum(group.map(value =>
        value.usage.inputTokens
        + value.usage.outputTokens
        + value.usage.reasoningTokens)),
      latencySeconds: round(
        sum(group.map(value => value.usage.totalLatencyMs)) / 1_000,
      ),
      modelSteps: sum(group.map(value => value.usage.modelSteps)),
      costStatus,
      ...(unavailable
        ? {}
        : {
            costUsd: round(sum(group.map(value =>
              value.usage.estimatedCostUsd ?? 0)), 8),
          }),
      pricingVersions: [...new Set(group
        .map(value => value.usage.pricingVersion)
        .filter((value): value is string => value !== undefined))].sort(),
    })
  }
  return result
}

function clusteredMeanInterval<T extends { readonly missionId: string }>(
  values: readonly T[],
  metric: (value: T) => number,
  confidenceLevel: 0.9 | 0.95 | 0.99,
  seed: string,
): EvaluationNumericInterval {
  const estimate = round(mean(values.map(metric)), 8)
  const clusters = new Map<string, T[]>()
  for (const value of values) {
    const group = clusters.get(value.missionId) ?? []
    group.push(value)
    clusters.set(value.missionId, group)
  }
  const independent = [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group)
  if (values.length === 0) {
    return {
      estimate: 0,
      confidenceLevel,
      clusterCount: 0,
      method: 'MISSION_CLUSTER_BOOTSTRAP',
      status: 'NO_DATA',
    }
  }
  if (independent.length < 2) {
    return {
      estimate,
      confidenceLevel,
      clusterCount: independent.length,
      method: 'MISSION_CLUSTER_BOOTSTRAP',
      status: 'INSUFFICIENT_CLUSTERS',
    }
  }
  const random = deterministicRandom(seed)
  const estimates: number[] = []
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const sampled: T[] = []
    for (let index = 0; index < independent.length; index += 1) {
      const cluster = independent[Math.floor(random() * independent.length)]
      if (cluster !== undefined) sampled.push(...cluster)
    }
    estimates.push(mean(sampled.map(metric)))
  }
  const alpha = (1 - confidenceLevel) / 2
  return {
    estimate,
    low: round(percentile(estimates, alpha), 8),
    high: round(percentile(estimates, 1 - alpha), 8),
    confidenceLevel,
    clusterCount: independent.length,
    method: 'MISSION_CLUSTER_BOOTSTRAP',
    status: 'AVAILABLE',
  }
}

function missionClusters(
  attempts: readonly EvaluationAttemptRecord[],
): readonly (readonly EvaluationAttemptRecord[])[] {
  const values = new Map<string, EvaluationAttemptRecord[]>()
  for (const attempt of attempts) {
    const group = values.get(attempt.identity.missionId) ?? []
    group.push(attempt)
    values.set(attempt.identity.missionId, group)
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group)
}

function sampledClusterRate(
  clusters: readonly (readonly EvaluationAttemptRecord[])[],
  random: () => number,
): number {
  let attempts = 0
  let accepted = 0
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[Math.floor(random() * clusters.length)]
    if (cluster === undefined) continue
    attempts += cluster.length
    accepted += cluster.filter(value => value.outcome.finalAccepted).length
  }
  return attempts === 0 ? 0 : accepted / attempts
}

function deterministicRandom(seed: string): () => number {
  let state = 2_166_136_261
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0
    state = Math.imul(state, 16_777_619)
  }
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = sum(values) / values.length
  return sum(values.map(value => (value - average) ** 2)) / (values.length - 1)
}

function confidenceScore(
  attempts: number,
  minimum: number,
  interval: EvaluationRateInterval,
  missingRate: number,
): number {
  const sample = Math.min(1, attempts / Math.max(minimum * 3, 1))
  const precision = Math.max(0, 1 - (interval.high - interval.low))
  return round(sample * 0.55 + precision * 0.35 + (1 - missingRate) * 0.1)
}

function validateRequest(request: PerformanceEvaluationRequest): void {
  const from = Date.parse(String(request.period.from))
  const to = Date.parse(String(request.period.to))
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new MilitaryError('INVALID_ARGUMENT', 'evaluation period is invalid')
  }
  if (!Number.isSafeInteger(request.minimumSamples)
    || request.minimumSamples < 1) {
    throw new MilitaryError('INVALID_ARGUMENT', 'minimumSamples must be a positive integer')
  }
  if (request.splitByRevision !== true) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'production evaluation must split immutable template revisions',
    )
  }
  const margin = request.nonInferiorityMargin ?? 0.05
  if (!Number.isFinite(margin) || margin < 0 || margin > 0.5) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'nonInferiorityMargin must be between 0 and 0.5',
    )
  }
  const confidence = request.confidenceLevel ?? 0.95
  if (confidence !== 0.9 && confidence !== 0.95 && confidence !== 0.99) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'confidenceLevel must be 0.9, 0.95, or 0.99',
    )
  }
  if (
    request.narrativeMode !== undefined
    && request.narrativeMode !== 'DETERMINISTIC'
    && request.narrativeMode !== 'COMMITTEE_MODEL'
  ) {
    throw new MilitaryError('INVALID_ARGUMENT', 'narrativeMode is invalid')
  }
  if (
    request.timeoutSeconds !== undefined
    && (
      !Number.isSafeInteger(request.timeoutSeconds)
      || request.timeoutSeconds < 30
      || request.timeoutSeconds > 86_400
    )
  ) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'timeoutSeconds must be an integer between 30 and 86400',
    )
  }
}

function validateReportInvariants(report: MilitaryPerformanceReport): void {
  if (String(report.datasetHash) !== String(report.datasetArtifact.sha256)) {
    throw new MilitaryError(
      'EVALUATION_REPORT_MISMATCH',
      'report dataset hash does not match dataset artifact',
    )
  }
  if (report.decision.promotionAllowed !== false) {
    throw new MilitaryError(
      'EVALUATION_REPORT_MISMATCH',
      'evaluation report cannot authorize model promotion',
    )
  }
  for (const result of report.individualPerformance) {
    if (result.template.aliasStatus !== 'EXACT_ROUTE_OBSERVED'
      && report.comparisons.some(value =>
        value.candidateConfigurationKey === result.template.configurationKey
        && value.decision === 'DECISION_ELIGIBLE')) {
      throw new MilitaryError(
        'EVALUATION_REPORT_MISMATCH',
        'alias-unproven configuration cannot be decision eligible',
      )
    }
  }
}

function uniqueEvidence(
  attempts: readonly EvaluationAttemptRecord[],
): AgentTemplatePerformance['evidenceRefs'] {
  const values = new Map<string, AgentTemplatePerformance['evidenceRefs'][number]>()
  for (const evidence of attempts.flatMap(value => value.evidenceRefs)) {
    const key = `${evidence.kind}\u0000${evidence.ref}\u0000${evidence.claim}`
    if (!values.has(key)) values.set(key, evidence)
  }
  return [...values.values()]
}

function zScore(confidenceLevel: number): number {
  if (confidenceLevel >= 0.99) return 2.575829
  if (confidenceLevel >= 0.95) return 1.959964
  return 1.644854
}

function nonEmpty(values: readonly string[], fallback: string): readonly string[] {
  const normalized = values.map(value => value.trim()).filter(Boolean)
  return normalized.length === 0 ? [fallback] : normalized
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(sum(values) / values.length)
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const low = sorted[lower] ?? 0
  const high = sorted[upper] ?? low
  return round(low + (high - low) * (position - lower))
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : round(numerator / denominator)
}

function round(value: number, places = 6): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}
