import type {
  AgentTemplatePerformance,
  EvaluationAttemptRecord,
  PerformanceEvaluationRequest,
} from '@dsh-military/contracts'
import type {
  EvaluationDataCollection,
  EvaluationDataSource,
  PerformanceNarrativeProvider,
} from '@dsh-military/core'

/** Mutable test/local collector; production uses the immutable DSH projection. */
export class ObservationCatalog implements EvaluationDataSource {
  readonly #values: EvaluationAttemptRecord[] = []

  record(value: EvaluationAttemptRecord): void {
    this.#values.push(structuredClone(value))
  }

  async collect(
    request: PerformanceEvaluationRequest,
    signal: AbortSignal,
  ): Promise<EvaluationDataCollection> {
    signal.throwIfAborted()
    const attempts = this.#values.filter(value =>
      matchesRequest(value, request)).map(value => structuredClone(value))
    const sessions = new Map<string, {
      readonly sessionId: string
      readonly rootSessionId: string
      readonly templateIds: Set<string>
    }>()
    for (const attempt of attempts) {
      const current = sessions.get(attempt.identity.sessionId) ?? {
        sessionId: attempt.identity.sessionId,
        rootSessionId: attempt.identity.rootSessionId,
        templateIds: new Set<string>(),
      }
      current.templateIds.add(String(attempt.configuration.templateId))
      sessions.set(attempt.identity.sessionId, current)
    }
    return {
      attempts,
      includedSessions: [...sessions.values()].map(value => ({
        sessionId: value.sessionId,
        rootSessionId: value.rootSessionId,
        templateIds: [...value.templateIds].sort(),
        inclusionReason: 'canonical in-process evaluation fixture',
      })),
      excludedSessions: [],
      missingness: [],
      sourceArtifactRefs: attempts.flatMap(value =>
        value.evidenceRefs.map(evidence => evidence.ref)),
    }
  }
}

/** Deterministic default; optional model examiners may explain but never alter metrics. */
export class DeterministicPerformanceNarrative implements PerformanceNarrativeProvider {
  async analyze(
    input: Parameters<PerformanceNarrativeProvider['analyze']>[0],
  ): Promise<Awaited<ReturnType<PerformanceNarrativeProvider['analyze']>>> {
    input.signal.throwIfAborted()
    const performance = input.performance
    const analyses = [
      `最终验收率 ${(performance.accuracy.finalAcceptanceRate * 100).toFixed(1)}%。`,
      `首次验收率 ${(performance.accuracy.firstPassAcceptanceRate * 100).toFixed(1)}%，完成率 ${(performance.completion.completionRate * 100).toFixed(1)}%。`,
      `无证据完成率 ${(performance.accuracy.falseCompletionRate * 100).toFixed(1)}%，冻结事件率 ${(performance.reliability.freezeIncidentRate * 100).toFixed(1)}%。`,
      `每个已验收结果平均 ${performance.efficiency.meanTokensPerAcceptedOutcome.toFixed(0)} tokens，p95 延迟 ${performance.efficiency.p95LatencySeconds.toFixed(2)} 秒。`,
    ]
    const recommendations: AgentTemplatePerformance['recommendations'][number][] = []
    if (performance.accuracy.firstPassAcceptanceRate < 0.7) {
      recommendations.push({
        area: 'task-design',
        action: '缩小任务决策预算并增强 Acceptance Contract。',
        priority: 'high',
      })
    }
    if (performance.accuracy.falseCompletionRate > 0) {
      recommendations.push({
        area: 'verification',
        action: '强化完成互锁与工具证据要求。',
        priority: 'critical',
      })
    }
    if (performance.reliability.freezeIncidentRate > 0.05) {
      recommendations.push({
        area: 'permissions',
        action: '复审工具权限、任务边界和模板提示。',
        priority: 'high',
      })
    }
    if (recommendations.length === 0) {
      recommendations.push({
        area: 'model',
        action: '维持当前模板并扩大受控样本。',
        priority: 'low',
      })
    }
    return {
      analyses,
      recommendations,
      limitations: performance.sample.assignedAttempts < 20
        ? ['样本量较小，结论仅用于方向性改进。']
        : [],
    }
  }

  async synthesize(
    input: Parameters<PerformanceNarrativeProvider['synthesize']>[0],
  ): Promise<Awaited<ReturnType<PerformanceNarrativeProvider['synthesize']>>> {
    input.signal.throwIfAborted()
    const overall = input.individual.length === 0
      ? 0
      : input.individual.reduce((sum, item) =>
          sum + item.accuracy.finalAcceptanceRate, 0) / input.individual.length
    const recommendations = input.individual.flatMap(item =>
      item.recommendations.map(value => value.action))
    return {
      analysisPoints: [
        `exact configuration 分层的平均最终验收率 ${(overall * 100).toFixed(1)}%。`,
        `本次覆盖 ${input.dataset.attempts.length} 个唯一 Attempt。`,
      ],
      priorityRecommendations: [...new Set(recommendations)].slice(0, 5)
        .map((action, index) => ({
          priority: index + 1,
          owner: 'Military Evaluation Committee',
          action,
          successMetric: '下一周期质量/纪律指标改善，且安全硬门保持通过。',
        })),
      unsupportedConclusions: [
        '本报告不能证明模型的通用智力。',
        '观察性相关不能自动解释为模型或模板的因果优势。',
      ],
    }
  }
}

/** Compose sources while deduplicating one immutable Attempt identity. */
export class CompositeEvaluationDataSource implements EvaluationDataSource {
  readonly #sources: readonly EvaluationDataSource[]

  constructor(sources: readonly EvaluationDataSource[]) {
    this.#sources = [...sources]
  }

  async collect(
    request: PerformanceEvaluationRequest,
    signal: AbortSignal,
  ): Promise<EvaluationDataCollection> {
    const attempts = new Map<string, EvaluationAttemptRecord>()
    const included = new Map<string, EvaluationDataCollection['includedSessions'][number]>()
    const excluded = new Map<string, EvaluationDataCollection['excludedSessions'][number]>()
    const missingness: EvaluationDataCollection['missingness'][number][] = []
    const sourceArtifactRefs = new Set<string>()
    for (const source of this.#sources) {
      signal.throwIfAborted()
      const collection = await source.collect(request, signal)
      for (const attempt of collection.attempts) {
        const existing = attempts.get(attempt.attemptId)
        if (existing !== undefined
          && JSON.stringify(existing) !== JSON.stringify(attempt)) {
          throw new Error(
            `evaluation attempt ${attempt.attemptId} differs across authoritative sources`,
          )
        }
        attempts.set(attempt.attemptId, structuredClone(attempt))
      }
      for (const session of collection.includedSessions) {
        included.set(session.sessionId, structuredClone(session))
      }
      for (const session of collection.excludedSessions) {
        excluded.set(session.sessionId, structuredClone(session))
      }
      missingness.push(...collection.missingness.map(value =>
        structuredClone(value)))
      for (const ref of collection.sourceArtifactRefs) {
        sourceArtifactRefs.add(ref)
      }
    }
    return {
      attempts: [...attempts.values()].sort((left, right) =>
        left.attemptId.localeCompare(right.attemptId)),
      includedSessions: [...included.values()].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId)),
      excludedSessions: [...excluded.values()].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId)),
      missingness: coalesceMissingness(missingness),
      sourceArtifactRefs: [...sourceArtifactRefs].sort(),
    }
  }
}

function matchesRequest(
  attempt: EvaluationAttemptRecord,
  request: PerformanceEvaluationRequest,
): boolean {
  const startedAt = Date.parse(String(attempt.startedAt))
  const from = Date.parse(String(request.period.from))
  const to = Date.parse(String(request.period.to))
  return Number.isFinite(startedAt)
    && startedAt >= from
    && startedAt <= to
    && (request.filters.workspaceKeys.length === 0
      || request.filters.workspaceKeys.includes(attempt.identity.workspaceKey))
    && (request.filters.missionIds.length === 0
      || request.filters.missionIds.some(id =>
        String(id) === attempt.identity.missionId))
    && (request.filters.templateIds.length === 0
      || request.filters.templateIds.some(id =>
        String(id) === String(attempt.configuration.templateId)))
    && (request.filters.departments.length === 0
      || request.filters.departments.includes(attempt.configuration.department))
    && (request.filters.includeIncompleteSessions || attempt.outcome.completed)
}

function coalesceMissingness(
  values: readonly EvaluationDataCollection['missingness'][number][],
): EvaluationDataCollection['missingness'] {
  const grouped = new Map<string, EvaluationDataCollection['missingness'][number]>()
  for (const value of values) {
    const key = `${value.field}\u0000${value.mechanism}`
    const existing = grouped.get(key)
    grouped.set(key, {
      field: value.field,
      mechanism: value.mechanism,
      count: (existing?.count ?? 0) + value.count,
    })
  }
  return [...grouped.values()].sort((left, right) =>
    left.field.localeCompare(right.field)
    || left.mechanism.localeCompare(right.mechanism))
}
