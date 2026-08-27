import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  type EvaluationAttemptRecord,
  type PerformanceEvaluationRequest,
} from '@dsh-military/contracts'
import { MilitaryEvaluationEngine } from '@dsh-military/core'
import { LocalArtifactStore } from '@dsh-military/infrastructure'
import {
  DeterministicPerformanceNarrative,
  CanonicalEvaluationSchemaValidation,
  EvaluationDatasetRuntime,
  ObservationCatalog,
} from '@dsh-military/runtime'
import {
  GovernedPerformanceNarrative,
  selectEvaluationSessionEvents,
} from '@dsh-military/plugin-host'
import {
  SqliteEvaluationDatasetArchive,
  SqliteEvaluationHistory,
  SqliteEvaluationRecordStore,
  SqliteMilitaryDatabase,
} from '@dsh-military/storage-sqlite'
import { minimalTemplate } from './helpers.js'

test('Military Evaluation Committee freezes one canonical dataset and reports exact configuration metrics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  for (let index = 0; index < 6; index += 1) {
    source.record(attempt(index, template))
  }
  const datasets = new EvaluationDatasetRuntime(
    source,
    new LocalArtifactStore(root),
    'tenant-1',
  )
  const engine = new MilitaryEvaluationEngine(
    datasets,
    new DeterministicPerformanceNarrative(),
    undefined,
    undefined,
    new CanonicalEvaluationSchemaValidation(),
  )
  const request: PerformanceEvaluationRequest = {
    schemaVersion: '1.0.0',
    evaluationRequestId: brand<string, 'EvaluationRequestId'>('evaluation-1'),
    requestedBy: 'user-1',
    period: {
      from: brand<string, 'IsoDateTime'>('2026-08-01T00:00:00.000Z'),
      to: brand<string, 'IsoDateTime'>('2026-08-31T23:59:59.999Z'),
    },
    filters: {
      templateIds: [],
      departments: [],
      workspaceKeys: [],
      missionIds: [],
      includeIncompleteSessions: true,
    },
    minimumSamples: 5,
    splitByRevision: true,
    comparisonBaseline: 'same-role-same-difficulty',
    reportClassification: 'confidential',
    examinerTemplateId: brand<string, 'AgentTemplateId'>('evaluation-examiner'),
    chairTemplateId: brand<string, 'AgentTemplateId'>('evaluation-chair'),
    createdAt: brand<string, 'IsoDateTime'>('2026-08-31T12:00:00.000Z'),
    idempotencyKey: 'evaluation-key-1',
  }
  await engine.request(request)
  const report = await engine.execute(
    request.evaluationRequestId,
    new AbortController().signal,
  )
  const frozen = await datasets.get(request.evaluationRequestId)
  assert.notEqual(frozen, null)
  assert.equal(await datasets.verify(frozen!.manifest), true)
  new CanonicalEvaluationSchemaValidation().dataset(frozen!)
  assert.equal(String(frozen!.manifest.datasetHash), String(report.datasetHash))
  assert.equal(report.individualPerformance.length, 1)
  new CanonicalEvaluationSchemaValidation().report(report)
  assert.equal(
    report.individualPerformance[0]?.sample.assignedAttempts,
    6,
  )
  assert.ok((report.individualPerformance[0]?.capability.index ?? 0) > 0)
  assert.equal((await engine.get(request.evaluationRequestId)).state, 'COMPLETED')
  assert.equal(
    (await engine.execute(
      request.evaluationRequestId,
      new AbortController().signal,
    )).reportId,
    report.reportId,
  )

  let committeeCalls = 0
  const governed = new GovernedPerformanceNarrative({
    llm: {
      async *stream() {
        committeeCalls += 1
        throw new Error('committee provider is unavailable')
      },
    },
  } as never, {
    async resolveForInstantiation() {
      return minimalTemplate()
    },
  } as never)
  const deterministic = await governed.analyze({
    request,
    performance: report.individualPerformance[0]!,
    signal: new AbortController().signal,
  })
  assert.equal(committeeCalls, 0)
  assert.ok(deterministic.analyses.length > 0)
  const fallback = await governed.analyze({
    request: { ...request, narrativeMode: 'COMMITTEE_MODEL' },
    performance: report.individualPerformance[0]!,
    signal: new AbortController().signal,
  })
  assert.equal(committeeCalls, 1)
  assert.ok(fallback.limitations.some(value =>
    value.includes('已回退到确定性叙事')))
})

test('evaluation dataset, in-flight run and report history survive SQLite restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-restart-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const databasePath = join(root, 'military.sqlite')
  const artifacts = new LocalArtifactStore(join(root, 'artifacts'))
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  for (let index = 0; index < 6; index += 1) {
    source.record(attempt(index, template))
  }
  const request = evaluationRequest('evaluation-restart')
  const firstDatabase = new SqliteMilitaryDatabase({ path: databasePath })
  const firstDatasets = new EvaluationDatasetRuntime(
    source,
    artifacts,
    'tenant-1',
    undefined,
    new SqliteEvaluationDatasetArchive(firstDatabase, 'tenant-1'),
  )
  const firstEngine = new MilitaryEvaluationEngine(
    firstDatasets,
    new DeterministicPerformanceNarrative(),
    undefined,
    new SqliteEvaluationRecordStore(firstDatabase, 'tenant-1', artifacts),
  )
  await firstEngine.request(request)
  const frozen = await firstDatasets.build(
    request,
    new AbortController().signal,
  )
  assert.equal(await firstDatasets.verify(frozen.manifest), true)
  firstDatabase.close()

  const secondDatabase = new SqliteMilitaryDatabase({ path: databasePath })
  t.after(() => { secondDatabase.close() })
  const restoredDatasets = new EvaluationDatasetRuntime(
    new ObservationCatalog(),
    artifacts,
    'tenant-1',
    undefined,
    new SqliteEvaluationDatasetArchive(secondDatabase, 'tenant-1'),
  )
  const restoredEngine = new MilitaryEvaluationEngine(
    restoredDatasets,
    new DeterministicPerformanceNarrative(),
    undefined,
    new SqliteEvaluationRecordStore(secondDatabase, 'tenant-1', artifacts),
  )
  assert.equal(
    (await restoredEngine.get(request.evaluationRequestId)).state,
    'DISCOVERING_SESSIONS',
  )
  const report = await restoredEngine.execute(
    request.evaluationRequestId,
    new AbortController().signal,
  )
  const history = new SqliteEvaluationHistory(
    secondDatabase,
    'tenant-1',
    artifacts,
  )
  assert.equal(history.runs()[0]?.state, 'COMPLETED')
  assert.equal(history.list()[0]?.reportId, report.reportId)
  assert.equal(
    (await history.report(report.reportId)).datasetHash,
    report.datasetHash,
  )
})

test('exact configurations never mix Flash and Pro and quality gates precede economics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-compare-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  for (let index = 0; index < 120; index += 1) {
    const initial = healthyAttempt(index, template)
    const base: EvaluationAttemptRecord = {
      ...initial,
      configuration: {
        ...initial.configuration,
        model: 'deepseek-v4-flash',
      },
      startedAt: brand<string, 'IsoDateTime'>(
        '2026-08-15T00:00:00.000Z',
      ),
      completedAt: brand<string, 'IsoDateTime'>(
        '2026-08-15T00:01:00.000Z',
      ),
    }
    source.record(base)
    source.record({
      ...base,
      attemptId: `pro-attempt-${index}`,
      identity: {
        ...base.identity,
        sessionId: `pro-session-${index}`,
        taskId: `pro-task-${index}`,
        agentId: `pro-worker-${index}`,
        leaseSeq: index + 10_000,
      },
      configuration: {
        ...base.configuration,
        model: 'deepseek-v4-pro',
      },
    })
  }
  const datasets = new EvaluationDatasetRuntime(
    source,
    new LocalArtifactStore(root),
    'tenant-1',
  )
  const engine = new MilitaryEvaluationEngine(
    datasets,
    new DeterministicPerformanceNarrative(),
  )
  const request = {
    ...evaluationRequest('evaluation-controlled-comparison'),
    minimumSamples: 20,
    confidenceLevel: 0.95 as const,
    nonInferiorityMargin: 0.05,
  }
  await engine.request(request)
  const report = await engine.execute(
    request.evaluationRequestId,
    new AbortController().signal,
  )
  assert.equal(report.individualPerformance.length, 2)
  assert.notEqual(
    report.individualPerformance[0]?.template.configurationKey,
    report.individualPerformance[1]?.template.configurationKey,
  )
  assert.equal(report.comparisons.length, 1)
  assert.equal(report.comparisons[0]?.quality.nonInferior, true)
  assert.equal(report.comparisons[0]?.safety.hardGatePassed, true)
  assert.equal(report.comparisons[0]?.covariateBalance.balanced, true)
  assert.equal(report.comparisons[0]?.decision, 'DECISION_ELIGIBLE')
  assert.equal(report.decision.promotionAllowed, false)
  assert.equal(
    report.individualPerformance[0]?.efficiency.intervals
      .tokensPerAcceptedOutcome.status,
    'AVAILABLE',
  )
  assert.equal(
    report.individualPerformance[0]?.efficiency.intervals
      .latencyPerAcceptedOutcomeSeconds.clusterCount,
    120,
  )
})

test('Accepted Outcome economics include failed retries and never price unknown usage at zero', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-cost-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  const failed = attempt(0, template)
  const accepted = healthyAttempt(1, template)
  source.record({
    ...failed,
    identity: {
      ...failed.identity,
      missionId: 'economic-mission',
      taskId: 'economic-task',
    },
    usage: {
      ...failed.usage,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 30,
      totalLatencyMs: 400,
      costStatus: 'OBSERVED',
      pricingVersion: 'catalog-1',
      estimatedCostUsd: 0.1,
    },
  })
  source.record({
    ...accepted,
    identity: {
      ...accepted.identity,
      missionId: 'economic-mission',
      taskId: 'economic-task',
    },
    usage: {
      ...accepted.usage,
      inputTokens: 200,
      outputTokens: 40,
      reasoningTokens: 60,
      totalLatencyMs: 600,
      costStatus: 'OBSERVED',
      pricingVersion: 'catalog-1',
      estimatedCostUsd: 0.2,
    },
  })
  const datasets = new EvaluationDatasetRuntime(
    source,
    new LocalArtifactStore(root),
  )
  const engine = new MilitaryEvaluationEngine(
    datasets,
    new DeterministicPerformanceNarrative(),
  )
  const request = {
    ...evaluationRequest('evaluation-accepted-outcome'),
    minimumSamples: 1,
    comparisonBaseline: 'none' as const,
  }
  await engine.request(request)
  const report = await engine.execute(
    request.evaluationRequestId,
    new AbortController().signal,
  )
  const efficiency = report.individualPerformance[0]!.efficiency
  assert.equal(efficiency.acceptedOutcomeCount, 1)
  assert.equal(efficiency.meanTokensPerAcceptedOutcome, 450)
  assert.equal(efficiency.meanLatencySeconds, 1)
  assert.equal(efficiency.meanCostPerAcceptedOutcomeUsd, 0.3)
  assert.equal(efficiency.costStatus, 'OBSERVED')
  assert.equal(
    efficiency.intervals.costPerAcceptedOutcomeUsd?.status,
    'INSUFFICIENT_CLUSTERS',
  )
})

test('failed configuration shards resume from SQLite without re-running completed narratives', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-shards-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const database = new SqliteMilitaryDatabase({
    path: join(root, 'military.sqlite'),
  })
  t.after(() => database.close())
  const artifacts = new LocalArtifactStore(join(root, 'artifacts'))
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  const flash = healthyAttempt(0, template)
  source.record({
    ...flash,
    configuration: { ...flash.configuration, model: 'deepseek-v4-flash' },
  })
  source.record({
    ...healthyAttempt(1, template),
    configuration: {
      ...healthyAttempt(1, template).configuration,
      model: 'deepseek-v4-pro',
    },
  })
  const archive = new SqliteEvaluationDatasetArchive(database, 'tenant-1')
  const datasets = new EvaluationDatasetRuntime(
    source,
    artifacts,
    'tenant-1',
    undefined,
    archive,
  )
  const store = new SqliteEvaluationRecordStore(
    database,
    'tenant-1',
    artifacts,
  )
  const deterministic = new DeterministicPerformanceNarrative()
  const calls = new Map<string, number>()
  let failPro = true
  const narrative = {
    async analyze(input: Parameters<
      DeterministicPerformanceNarrative['analyze']
    >[0]) {
      const model = input.performance.template.model
      calls.set(model, (calls.get(model) ?? 0) + 1)
      if (model.includes('pro') && failPro) {
        failPro = false
        throw new Error('synthetic shard failure')
      }
      return await deterministic.analyze(input)
    },
    async synthesize(input: Parameters<
      DeterministicPerformanceNarrative['synthesize']
    >[0]) {
      return await deterministic.synthesize(input)
    },
  }
  const request = {
    ...evaluationRequest('evaluation-shard-resume'),
    minimumSamples: 1,
    comparisonBaseline: 'none' as const,
  }
  const first = new MilitaryEvaluationEngine(
    datasets,
    narrative,
    undefined,
    store,
  )
  await first.request(request)
  await assert.rejects(
    first.execute(
      request.evaluationRequestId,
      new AbortController().signal,
    ),
    /synthetic shard failure/u,
  )
  const failed = await first.get(request.evaluationRequestId)
  assert.equal(failed.state, 'FAILED')
  assert.equal(failed.templatesCompleted, 1)
  assert.equal(failed.failure?.retryable, true)

  const restoredDatasets = new EvaluationDatasetRuntime(
    new ObservationCatalog(),
    artifacts,
    'tenant-1',
    undefined,
    archive,
  )
  const restored = new MilitaryEvaluationEngine(
    restoredDatasets,
    narrative,
    undefined,
    store,
  )
  const report = await restored.execute(
    request.evaluationRequestId,
    new AbortController().signal,
  )
  assert.equal(report.individualPerformance.length, 2)
  assert.equal(calls.get('deepseek-v4-flash'), 1)
  assert.equal(calls.get('deepseek-v4-pro'), 2)
  assert.equal((await restored.get(request.evaluationRequestId)).state, 'COMPLETED')
})

test('evaluation Session selection admits setup skew but never leaks earlier or future tool events', () => {
  const events = [
    { type: 'tool/result', time: 8_500 },
    { type: 'request/header', time: 8_600 },
    { type: 'request/context', time: 9_100 },
    { type: 'step/start', time: 9_500 },
    { type: 'tool/call', time: 9_900 },
    { type: 'tool/call', time: 10_100 },
    { type: 'tool/result', time: 19_900 },
    { type: 'request/header', time: 20_100 },
  ] as unknown as Parameters<typeof selectEvaluationSessionEvents>[0]
  const selected = selectEvaluationSessionEvents(events, 10_000, 20_000)
  assert.deepEqual(selected.map(value => [value.type, value.time]), [
    ['request/header', 8_600],
    ['request/context', 9_100],
    ['step/start', 9_500],
    ['tool/call', 10_100],
    ['tool/result', 19_900],
  ])
})

test('appeal exclusions produce a new canonical dataset without mutating the original', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-exclusion-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  source.record(healthyAttempt(0, template))
  source.record(healthyAttempt(1, template))
  const datasets = new EvaluationDatasetRuntime(
    source,
    new LocalArtifactStore(root),
  )
  const originalRequest = evaluationRequest('evaluation-before-appeal')
  const original = await datasets.build(
    originalRequest,
    new AbortController().signal,
  )
  const replacementRequest: PerformanceEvaluationRequest = {
    ...evaluationRequest('evaluation-after-appeal'),
    filters: {
      ...originalRequest.filters,
      excludedAttemptIds: ['attempt-0'],
    },
  }
  const replacement = await datasets.build(
    replacementRequest,
    new AbortController().signal,
  )
  assert.equal(original.dataset.attempts.length, 2)
  assert.equal(replacement.dataset.attempts.length, 1)
  assert.equal(replacement.dataset.excludedAttempts[0]?.attemptId, 'attempt-0')
  assert.notEqual(
    String(original.dataset.datasetHash),
    String(replacement.dataset.datasetHash),
  )
})

test('SQLite evaluation lease fences concurrent workers and report lineage supersede is idempotent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-evaluation-lease-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const database = new SqliteMilitaryDatabase({
    path: join(root, 'military.sqlite'),
  })
  t.after(() => database.close())
  const artifacts = new LocalArtifactStore(join(root, 'artifacts'))
  const source = new ObservationCatalog()
  const template = minimalTemplate()
  for (let index = 0; index < 6; index += 1) {
    source.record(healthyAttempt(index, template))
  }
  const archive = new SqliteEvaluationDatasetArchive(database, 'tenant-1')
  const store = new SqliteEvaluationRecordStore(
    database,
    'tenant-1',
    artifacts,
  )
  const datasets = new EvaluationDatasetRuntime(
    source,
    artifacts,
    'tenant-1',
    undefined,
    archive,
  )
  const engine = new MilitaryEvaluationEngine(
    datasets,
    new DeterministicPerformanceNarrative(),
    undefined,
    store,
  )
  const firstRequest = evaluationRequest('evaluation-lease-first')
  await engine.request(firstRequest)
  const held = await store.acquire(
    firstRequest.evaluationRequestId,
    'test-holder',
    new Date(Date.now() + 60_000).toISOString(),
  )
  assert.notEqual(held, null)
  await assert.rejects(
    engine.execute(
      firstRequest.evaluationRequestId,
      new AbortController().signal,
    ),
    /already leased/u,
  )
  await store.release(held!)
  const first = await engine.execute(
    firstRequest.evaluationRequestId,
    new AbortController().signal,
  )

  const secondRequest = evaluationRequest('evaluation-lease-second')
  await engine.request(secondRequest)
  const second = await engine.execute(
    secondRequest.evaluationRequestId,
    new AbortController().signal,
  )
  const history = new SqliteEvaluationHistory(
    database,
    'tenant-1',
    artifacts,
  )
  const link = {
    previousReportId: first.reportId,
    previousRevision: Number(first.reportRevision),
    nextReportId: second.reportId,
    nextRevision: Number(second.reportRevision),
  }
  history.supersede(link)
  history.supersede(link)
  const summaries = history.list()
  assert.equal(
    summaries.find(value => value.reportId === first.reportId)?.state,
    'SUPERSEDED',
  )
  assert.equal(
    summaries.find(value => value.reportId === second.reportId)
      ?.supersedesReportId,
    first.reportId,
  )
})

function attempt(
  index: number,
  template: ReturnType<typeof minimalTemplate>,
): EvaluationAttemptRecord {
  const accepted = index < 5
  return {
    schemaVersion: '1.0.0',
    attemptId: `attempt-${index}`,
    identity: {
      rootSessionId: `root-${Math.floor(index / 2)}`,
      sessionId: `session-${index}`,
      missionId: `mission-${Math.floor(index / 2)}`,
      workspaceKey: 'workspace-1',
      taskId: `task-${index}`,
      taskVersion: 1,
      agentId: `worker-${index}`,
      agentGeneration: 1,
      leaseSeq: index + 1,
    },
    configuration: {
      templateId: template.templateId,
      templateRevision: template.revision,
      role: template.role,
      department: template.department,
      promptRevision: 1,
      configurationHash: brand<string, 'Sha256'>('a'.repeat(64)),
      provider: template.modelPolicy.provider,
      model: template.modelPolicy.model,
      aliasStatus: 'EXACT_ROUTE_OBSERVED',
      reasoningEffort: template.modelPolicy.reasoningEffort,
      toolProfile: {
        id: template.capabilities.toolProfileId,
        revision: template.capabilities.toolProfileRevision,
      },
      permissionProfile: {
        id: template.capabilities.permissionProfileId,
        revision: template.capabilities.permissionProfileRevision,
      },
      presetGeneration: 'military@test',
      bundleVersion: '0.9.0-alpha.24',
      dshRelease: '0.1.1-rc.2',
      dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
    },
    task: {
      taskType: 'test',
      preExecutionDifficulty: index + 1,
      difficultyModelVersion: 'difficulty-v2-pre-execution',
      riskClass: index > 3 ? 'HIGH' : 'MEDIUM',
      acceptanceClauseCount: 1,
      dependencyCount: 0,
      allowedToolCount: 2,
      verifierStrength: 1,
      workspaceDrift: false,
      tacticalCoverage: false,
    },
    outcome: {
      firstPassAccepted: index !== 0 && accepted,
      finalAccepted: accepted,
      completed: accepted,
      missionCompleted: accepted && index % 2 === 1,
      declaredCompleteWithoutEvidence: !accepted,
      frozen: !accepted,
      permissionViolation: false,
      staleSubmission: false,
      regressionEscape: false,
      handoffComplete: accepted && index < 4,
      parentWakeup: accepted,
      recoveryAttempted: !accepted,
      recoverySucceeded: false,
      verifierObserved: true,
      reworkCount: index === 0 ? 1 : 0,
      blockerCount: 0,
      radioCount: 0,
      userInterventionCount: 0,
    },
    usage: {
      inputTokens: 50,
      outputTokens: 20 + index,
      reasoningTokens: 30,
      modelSteps: 2,
      toolCalls: 2,
      correctionCount: index === 0 ? 1 : 0,
      queueLatencyMs: 10,
      modelLatencyMs: 100,
      toolLatencyMs: 50,
      verificationLatencyMs: 20,
      totalLatencyMs: 200,
      fallbackCount: 0,
      retryCount: 0,
      compactionAttempts: 0,
      compactionSuccesses: 0,
      costStatus: 'PROVIDER_PRICING_UNAVAILABLE',
    },
    failure: accepted
      ? { stage: 'NONE' }
      : { stage: 'VERIFICATION_FAILURE', code: 'REJECTED' },
    evidenceRefs: [{
      kind: 'event',
      ref: `event-${index}`,
      claim: 'authoritative evaluation fixture',
    }],
    startedAt: brand<string, 'IsoDateTime'>(
      `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    ),
    completedAt: brand<string, 'IsoDateTime'>(
      `2026-08-${String(index + 1).padStart(2, '0')}T00:01:00.000Z`,
    ),
  }
}

function healthyAttempt(
  index: number,
  template: ReturnType<typeof minimalTemplate>,
): EvaluationAttemptRecord {
  const base = attempt(index, template)
  return {
    ...base,
    identity: {
      ...base.identity,
      rootSessionId: `root-${index}`,
      missionId: `mission-${index}`,
    },
    outcome: {
      ...base.outcome,
      firstPassAccepted: true,
      finalAccepted: true,
      completed: true,
      missionCompleted: true,
      declaredCompleteWithoutEvidence: false,
      frozen: false,
      handoffComplete: true,
      parentWakeup: true,
      recoveryAttempted: false,
      recoverySucceeded: false,
      verifierObserved: true,
      reworkCount: 0,
    },
    failure: { stage: 'NONE' },
  }
}

function evaluationRequest(id: string): PerformanceEvaluationRequest {
  return {
    schemaVersion: '1.0.0',
    evaluationRequestId: brand<string, 'EvaluationRequestId'>(id),
    requestedBy: 'user-1',
    period: {
      from: brand<string, 'IsoDateTime'>('2026-08-01T00:00:00.000Z'),
      to: brand<string, 'IsoDateTime'>('2026-08-31T23:59:59.999Z'),
    },
    filters: {
      templateIds: [],
      departments: [],
      workspaceKeys: [],
      missionIds: [],
      includeIncompleteSessions: true,
    },
    minimumSamples: 5,
    splitByRevision: true,
    comparisonBaseline: 'same-role-same-difficulty',
    reportClassification: 'confidential',
    examinerTemplateId: brand<string, 'AgentTemplateId'>('evaluation-examiner'),
    chairTemplateId: brand<string, 'AgentTemplateId'>('evaluation-chair'),
    createdAt: brand<string, 'IsoDateTime'>('2026-08-31T12:00:00.000Z'),
    idempotencyKey: `evaluation-key-${id}`,
  }
}
