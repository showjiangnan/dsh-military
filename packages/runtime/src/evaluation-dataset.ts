import {
  MilitaryError,
  brand,
  type EvaluationDatasetManifest,
  type EvaluationRequestId,
  type FrozenEvaluationDataset,
  type MilitaryArtifacts,
  type MilitaryEvaluationDataset,
  type PerformanceEvaluationRequest,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  exactConfigurationKey,
  now,
  sha256,
  stableJson,
  type Clock,
  type EvaluationDataSource,
} from '@dsh-military/core'

export interface EvaluationDatasetArchive {
  read(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<EvaluationDatasetManifest | null>
  write(manifest: EvaluationDatasetManifest): Promise<void>
}

export class EvaluationDatasetRuntime implements MilitaryEvaluationDataset {
  readonly #source: EvaluationDataSource
  readonly #artifacts: MilitaryArtifacts
  readonly #tenantId: string
  readonly #clock: Clock
  readonly #archive: EvaluationDatasetArchive | undefined
  readonly #values = new Map<string, {
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  }>()

  constructor(
    source: EvaluationDataSource,
    artifacts: MilitaryArtifacts,
    tenantId = 'default',
    clock?: Clock,
    archive?: EvaluationDatasetArchive,
  ) {
    this.#source = source
    this.#artifacts = artifacts
    this.#tenantId = tenantId
    this.#clock = clock ?? (() => new Date())
    this.#archive = archive
  }

  async build(
    request: PerformanceEvaluationRequest,
    signal: AbortSignal,
  ): Promise<{
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  }> {
    signal.throwIfAborted()
    const id = String(request.evaluationRequestId)
    const existing = await this.get(request.evaluationRequestId)
    if (existing !== null) {
      if (stableJson(existing.dataset.request) !== stableJson(request)) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          'evaluation request id is already bound to another canonical request',
        )
      }
      return cloneFrozen(existing)
    }

    const collection = await this.#source.collect(request, signal)
    signal.throwIfAborted()
    const excludedIds = new Set(request.filters.excludedAttemptIds ?? [])
    const excludedAttempts: EvaluationDatasetManifest['excludedAttempts'] =
      [...excludedIds].sort().map(attemptId => ({
        attemptId,
        reasonCode: 'APPEAL_USER_CHALLENGE',
        details: '由已授权绩效申诉明确排除；原报告和原数据集保持不变。',
      }))
    const attempts = uniqueSortedAttempts(collection.attempts.filter(value =>
      !excludedIds.has(value.attemptId)))
    const requestHash = brand<string, 'Sha256'>(sha256(stableJson(request)))
    const sourceArtifactRefs = collection.sourceArtifactRefs.length === 0
      ? [`evaluation-request:${id}`]
      : [...new Set(collection.sourceArtifactRefs)].sort()
    const canonicalBody = {
      schemaVersion: '1.0.0' as const,
      requestHash,
      request,
      attempts,
      includedSessions: [...collection.includedSessions].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId)),
      excludedSessions: [...collection.excludedSessions].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId)),
      excludedAttempts,
      strata: strataFor(attempts),
      missingness: [...collection.missingness].sort((left, right) =>
        left.field.localeCompare(right.field)
        || left.mechanism.localeCompare(right.mechanism)),
      sourceArtifactRefs,
    }
    const bytes = new TextEncoder().encode(stableJson(canonicalBody))
    const datasetArtifact = await this.#artifacts.put({
      bytes,
      mediaType: 'application/vnd.dsh-military.evaluation-dataset+json',
      classification: request.reportClassification,
      description: `Canonical Military evaluation dataset ${id}`,
      tenantId: this.#tenantId,
      ownerPrincipalId: 'military-evaluation-engine',
      audiencePrincipalIds: ['military-host', 'military-evaluation-engine'],
      audienceScopes: ['artifact:read', 'military:evaluation-dataset'],
    })
    const dataset: FrozenEvaluationDataset = {
      ...canonicalBody,
      datasetHash: datasetArtifact.sha256,
    }
    const missionIds = [...new Set(attempts.map(value =>
      value.identity.missionId))].sort()
    const manifest: EvaluationDatasetManifest = {
      schemaVersion: '1.0.0',
      evaluationRequestId: id,
      requestHash,
      datasetHash: datasetArtifact.sha256,
      datasetArtifact,
      generatorVersion: '0.9.0-alpha.27',
      rubricVersion: '2.0.0',
      timeRange: request.period,
      filters: {
        tenantId: this.#tenantId,
        templateIds: request.filters.templateIds.map(String).sort(),
        departments: [...request.filters.departments].sort(),
        workspaceIds: [...request.filters.workspaceKeys].sort(),
        missionIds: request.filters.missionIds.map(String).sort(),
        includeIncomplete: request.filters.includeIncompleteSessions,
        excludedAttemptIds: [...excludedIds].sort(),
        actualPreset: 'military',
      },
      includedSessions: dataset.includedSessions,
      excludedSessions: dataset.excludedSessions,
      excludedAttempts: dataset.excludedAttempts,
      strata: dataset.strata,
      missingness: dataset.missingness,
      difficultyModelVersion: 'difficulty-v2-pre-execution',
      deidentificationPolicyRef: 'policy:deidentify-v2',
      sampleWeightPolicy: 'mission-clustered-exact-configuration-v2',
      sourceArtifactRefs,
      attemptCount: attempts.length,
      missionCount: missionIds.length,
      configurationCount: dataset.strata.length,
      frozenAt: now(this.#clock),
    }
    const value = cloneFrozen({ manifest, dataset })
    this.#values.set(id, value)
    await this.#archive?.write(manifest)
    return value
  }

  async get(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<{
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  } | null> {
    const value = this.#values.get(String(evaluationRequestId))
    if (value !== undefined) return cloneFrozen(value)
    const manifest = await this.#archive?.read(evaluationRequestId)
    if (manifest === null || manifest === undefined) return null
    if (String(manifest.datasetHash) !== String(manifest.datasetArtifact.sha256)) {
      throw new MilitaryError(
        'EVALUATION_DATASET_INCOMPLETE',
        'persisted evaluation manifest does not match its artifact',
      )
    }
    const bytes = await this.#artifacts.get(manifest.datasetArtifact.artifactId)
    const body = JSON.parse(new TextDecoder().decode(bytes)) as Omit<
      FrozenEvaluationDataset,
      'datasetHash'
    >
    if (sha256(stableJson(body)) !== String(manifest.datasetHash)) {
      throw new MilitaryError(
        'EVALUATION_DATASET_INCOMPLETE',
        'persisted canonical dataset hash verification failed',
      )
    }
    const restored = cloneFrozen({
      manifest,
      dataset: {
        ...body,
        datasetHash: manifest.datasetHash,
      } satisfies FrozenEvaluationDataset,
    })
    this.#values.set(String(evaluationRequestId), restored)
    return restored
  }

  async verify(manifest: EvaluationDatasetManifest): Promise<boolean> {
    const value = this.#values.get(manifest.evaluationRequestId)
      ?? await this.get(brand<string, 'EvaluationRequestId'>(
        manifest.evaluationRequestId,
      )) ?? undefined
    if (value === undefined) return false
    const archived = await this.#archive?.read(
      brand<string, 'EvaluationRequestId'>(manifest.evaluationRequestId),
    )
    if (archived !== undefined && archived !== null
      && stableJson(archived) !== stableJson(manifest)) return false
    if (stableJson(value.manifest) !== stableJson(manifest)) return false
    if (String(manifest.datasetHash) !== String(manifest.datasetArtifact.sha256)) {
      return false
    }
    if (!await this.#artifacts.verify(manifest.datasetArtifact)) return false
    const { datasetHash: _hash, ...body } = value.dataset
    return sha256(stableJson(body)) === String(manifest.datasetHash)
  }
}

function uniqueSortedAttempts(
  values: readonly FrozenEvaluationDataset['attempts'][number][],
): FrozenEvaluationDataset['attempts'] {
  const attempts = new Map<string, FrozenEvaluationDataset['attempts'][number]>()
  for (const value of values) {
    const existing = attempts.get(value.attemptId)
    if (existing !== undefined && stableJson(existing) !== stableJson(value)) {
      throw new MilitaryError(
        'EVALUATION_DATASET_INCOMPLETE',
        `duplicate Attempt ${value.attemptId} has conflicting evidence`,
      )
    }
    attempts.set(value.attemptId, cloneFrozen(value))
  }
  return [...attempts.values()].sort((left, right) =>
    left.attemptId.localeCompare(right.attemptId))
}

function strataFor(
  attempts: FrozenEvaluationDataset['attempts'],
): EvaluationDatasetManifest['strata'] {
  const groups = new Map<string, number>()
  for (const attempt of attempts) {
    const key = exactConfigurationKey(attempt)
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)).map(([key, sampleCount]) => ({
      key,
      sampleCount,
      weight: attempts.length === 0 ? 0 : sampleCount / attempts.length,
    }))
}
