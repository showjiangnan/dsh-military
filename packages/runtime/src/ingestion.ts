import {
  MilitaryError,
  brand,
  type ArtifactRef,
  type MilitaryArtifacts,
  type MilitaryIngestion,
  type MilitaryPrivateSkillBundles,
  type MilitaryTags,
  type PrivateSkillBundleSnapshot,
  type PrivateSkillChunkRecord,
  type PrivateSkillExtractionStartInput,
  type PrivateSkillIngestionJob,
  type PrivateSkillOperationSnapshot,
  type PrivateSkillPromotionReceipt,
  type PrivateSkillReviewReceipt,
  type PrivateSkillSourceCreateInput,
  type PrivateSkillSourceHandle,
  type PrivateSkillSourceRecord,
  type PrivateSkillUsageRecord,
  type SemVer,
  type TacticalExtractionCandidate,
  type TacticalExtractionCandidateId,
  type TacticalIngestionRequest,
  type TacticalIngestionRequestId,
  type TacticalIngestionSnapshot,
  type TacticalLifecycle,
  type TacticalSkillId,
  type TacticalSourceSnapshot,
  type TacticalTag,
} from '@dsh-military/contracts'
import {
  InMemoryTacticalRegistry,
  cloneFrozen,
  now,
  semver,
  sha256,
  stableJson,
  tacticalId,
  type Clock,
  type TacticalProcedure,
} from '@dsh-military/core'
import {
  InMemoryPrivateSkillRepository,
  type PrivateSkillPipelineRecord,
  type PrivateSkillRepository,
} from './private-skill-repository.js'
import {
  aggregateClaims,
  assertSourceRights,
  assertTextualSource,
  canRouteToExternalExtractor,
  chunkRanges,
  cleanBoundedStrings,
  compileExample,
  compileProcedureMarkdown,
  compileReference,
  compileSkillMd,
  compileVerifierScript,
  deliveryRightsReasons,
  legacySource,
  resolveRights,
  sanitizeSource,
  skillDescription,
  skillIdFromTitle,
  skillName,
  unique,
  uniqueBy,
  validateChunkExtraction,
  visibilityAllowedUse,
} from './ingestion-support.js'

export interface TacticalChunkExtraction {
  readonly proposedTitle?: string
  readonly claims: readonly {
    readonly claim: string
    readonly confidence: number
  }[]
  readonly risks: readonly string[]
  readonly validationPlan: readonly string[]
}

/**
 * Narrow extractor seam. The Host supplies one sanitized, bounded chunk and
 * owns all IDs, evidence, aggregation, lifecycle and publication decisions.
 */
export interface TacticalExtractor {
  readonly route: {
    readonly mode: 'FLASH' | 'DETERMINISTIC_FALLBACK'
    readonly provider?: string
    readonly model?: string
  }
  extractChunk(input: {
    readonly request: TacticalIngestionRequest
    readonly chunk: PrivateSkillChunkRecord
    readonly content: string
    readonly primaryTag: TacticalTag
    readonly additionalTags: readonly TacticalTag[]
    readonly signal: AbortSignal
  }): Promise<TacticalChunkExtraction>
}

export interface SessionSourceReader {
  read(input: {
    readonly sessionId: string
    readonly startSeq?: number
    readonly endSeq?: number
    readonly includeToolResults: boolean
  }): Promise<Uint8Array>
}

interface TacticalRegistryPort {
  publish(procedure: TacticalProcedure): void
  get(skillId: TacticalSkillId, version?: SemVer): TacticalProcedure
  list(): readonly TacticalProcedure[]
  transition(skillId: TacticalSkillId, version: SemVer, to: TacticalLifecycle): TacticalProcedure
}

interface KnowledgeSourceRegistrar {
  registerSource(snapshot: TacticalSourceSnapshot): void
}

const TERMINAL_JOB_STATES = new Set<PrivateSkillIngestionJob['state']>([
  'PENDING_REVIEW',
  'APPROVED_AS_DRAFT',
  'RETURNED',
  'REJECTED',
  'CANCELLED',
])

/**
 * One Host-owned private Skill supply chain. Every resumable domain stage is
 * committed through the repository; raw material, sanitized artifacts and
 * compiled bundles use physically separate stores in production.
 */
export class TacticalIngestionRuntime implements MilitaryIngestion {
  readonly #artifacts: MilitaryArtifacts
  readonly #rawVault: MilitaryArtifacts
  readonly #bundles: MilitaryPrivateSkillBundles
  readonly #tags: MilitaryTags
  readonly #extractor: TacticalExtractor
  readonly #fallbackExtractor: TacticalExtractor
  readonly #sessions: SessionSourceReader
  readonly #repository: PrivateSkillRepository
  readonly #tactics: TacticalRegistryPort
  readonly #knowledge: KnowledgeSourceRegistrar | undefined
  readonly #clock: Clock
  readonly #tenantId: string
  readonly #listeners = new Set<() => void>()
  readonly #creatingSources = new Map<string, Promise<PrivateSkillSourceRecord>>()
  readonly #processing = new Map<string, Promise<PrivateSkillIngestionJob>>()

  constructor(input: {
    readonly artifacts: MilitaryArtifacts
    readonly rawVault?: MilitaryArtifacts
    readonly bundles?: MilitaryPrivateSkillBundles
    readonly tags: MilitaryTags
    readonly extractor: TacticalExtractor
    readonly fallbackExtractor?: TacticalExtractor
    readonly sessions: SessionSourceReader
    readonly repository?: PrivateSkillRepository
    readonly tactics?: InMemoryTacticalRegistry
    readonly knowledge?: KnowledgeSourceRegistrar
    readonly clock?: Clock
    readonly tenantId?: string
  }) {
    this.#artifacts = input.artifacts
    this.#rawVault = input.rawVault ?? input.artifacts
    this.#tenantId = input.tenantId ?? 'local'
    this.#bundles = input.bundles
      ?? new ArtifactBackedPrivateSkillBundleStore(
        input.artifacts,
        this.#tenantId,
      )
    this.#tags = input.tags
    this.#extractor = input.extractor
    this.#fallbackExtractor = input.fallbackExtractor ?? new HeuristicTacticalExtractor()
    this.#sessions = input.sessions
    this.#repository = input.repository ?? new InMemoryPrivateSkillRepository()
    this.#tactics = input.tactics ?? new InMemoryTacticalRegistry()
    this.#knowledge = input.knowledge
    this.#clock = input.clock ?? (() => new Date())
  }

  async createSource(input: {
    readonly requestedBy: string
    readonly source: PrivateSkillSourceCreateInput
  }): Promise<PrivateSkillSourceRecord> {
    if (input.requestedBy.trim().length === 0 || input.requestedBy.length > 256) {
      throw new MilitaryError('INVALID_ARGUMENT', 'requestedBy must contain 1-256 characters')
    }
    if (
      input.source.title.trim().length === 0
      || input.source.title.length > 256
      || /[\u0000\r\n]/u.test(input.source.title)
    ) {
      throw new MilitaryError('INVALID_ARGUMENT', 'source title must be one line containing 1-256 characters')
    }
    const bytes = await this.#sourceCreateBytes(input.source)
    if (bytes.byteLength === 0) throw new MilitaryError('INVALID_ARGUMENT', 'private Skill source is empty')
    assertTextualSource(input.source, bytes)
    const sourceHash = brand<string, 'Sha256'>(sha256(bytes))
    const classification = input.source.classification ?? 'confidential'
    const requestedVisibility = input.source.visibility ?? 'user-private'
    const rights = resolveRights(
      input.requestedBy,
      input.source.kind,
      requestedVisibility,
      input.source.rights,
    )
    const visibility = rights.license === 'UNKNOWN' ? 'user-private' : requestedVisibility
    assertSourceRights(input.requestedBy, rights, visibility)
    const handle = brand<string, 'PrivateSkillSourceHandle'>(
      `private-source-${sha256(stableJson({
        requestedBy: input.requestedBy,
        sourceKind: input.source.kind,
        title: input.source.title.trim(),
        sourceHash: String(sourceHash),
        classification,
        visibility,
        rights,
      })).slice(0, 32)}`,
    )
    const existing = this.#repository.source(handle)
    if (existing !== null) return existing
    const inFlight = this.#creatingSources.get(String(handle))
    if (inFlight !== undefined) return await inFlight
    const creation = (async (): Promise<PrivateSkillSourceRecord> => {
      const raced = this.#repository.source(handle)
      if (raced !== null) return raced
      const raw = await this.#rawVault.put({
        bytes,
        mediaType: 'text/plain',
        classification,
        description: `Raw private Skill source ${String(handle)}; pipeline-only`,
        tenantId: this.#tenantId,
        ownerPrincipalId: rights.ownerId,
        audiencePrincipalIds: ['military-host', ...rights.allowedAudience],
        audienceScopes: ['artifact:read', 'military:private-skill-raw-vault'],
        ...(rights.validUntil === undefined
          ? {}
          : { retentionUntil: rights.validUntil }),
        residencyPolicyRef: 'local-private-skill-raw-vault@1',
      })
      const timestamp = now(this.#clock)
      const source: PrivateSkillSourceRecord = {
        schemaVersion: '1.0.0',
        sourceHandle: handle,
        sourceKind: input.source.kind,
        title: input.source.title.trim(),
        requestedBy: input.requestedBy,
        classification,
        visibility,
        rights,
        rawVaultRef: String(raw.artifactId),
        sourceHash,
        status: 'IMPORTED',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.#repository.putSource(source)
      this.#changed()
      return cloneFrozen(source)
    })()
    this.#creatingSources.set(String(handle), creation)
    try {
      return await creation
    } finally {
      if (this.#creatingSources.get(String(handle)) === creation) {
        this.#creatingSources.delete(String(handle))
      }
    }
  }

  async source(sourceHandle: PrivateSkillSourceHandle): Promise<PrivateSkillSourceRecord> {
    const value = this.#repository.source(sourceHandle)
    if (value === null) throw new MilitaryError('NOT_FOUND', `unknown private Skill source ${String(sourceHandle)}`)
    return value
  }

  async revokeSource(input: {
    readonly sourceHandle: PrivateSkillSourceHandle
    readonly requestedBy: string
    readonly reason: 'OWNER_REQUEST' | 'LICENSE_CHANGE' | 'SECURITY_INCIDENT' | 'PROVEN_INCORRECT' | 'RETENTION_EXPIRY'
  }): Promise<{ readonly affectedTacticVersions: readonly string[] }> {
    const source = await this.source(input.sourceHandle)
    this.#assertSourceActor(source, input.requestedBy, 'revoke')
    const bundles = this.#repository.listBundles()
      .filter(value => value.sourceSnapshotIds.includes(String(input.sourceHandle)))
    const affected = bundles.map(value => `${String(value.skill.skillId)}@${String(value.skill.version)}`)
    await this.#repository.transaction(() => {
      if (source.status !== 'REVOKED') {
        this.#repository.putSource({ ...source, status: 'REVOKED', updatedAt: now(this.#clock) })
      }
      for (const bundle of bundles) {
        try {
          const tactic = this.#tactics.get(bundle.skill.skillId, bundle.skill.version)
          if (tactic.lifecycle !== 'QUARANTINED' && tactic.lifecycle !== 'DEPRECATED') {
            this.#repository.putBundle({ ...bundle, lifecycle: 'QUARANTINED' })
            // Transition last: on the in-memory repository there is no later
            // fallible write that could leave its registry ahead of rollback;
            // on SQLite both stores share this surrounding transaction.
            this.#tactics.transition(bundle.skill.skillId, bundle.skill.version, 'QUARANTINED')
          }
        } catch (error) {
          if (!(error instanceof MilitaryError) || error.failure.code !== 'NOT_FOUND') throw error
          // Missing legacy tactical content cannot be recalled; retain lineage
          // and continue revoking every other exact derivative.
        }
      }
    })
    this.#changed()
    return { affectedTacticVersions: affected }
  }

  async startExtraction(input: {
    readonly requestedBy: string
    readonly value: PrivateSkillExtractionStartInput
  }): Promise<PrivateSkillIngestionJob> {
    const source = await this.source(input.value.sourceHandle)
    this.#assertSourceActor(source, input.requestedBy, 'extract')
    this.#assertUsableSource(source)
    const primary = await this.#tags.get(input.value.primaryTagId)
    if (primary.status !== 'ACTIVE') throw new MilitaryError('TACTICAL_TAG_INACTIVE')
    const additionalIds = unique(input.value.additionalTagIds ?? [])
      .sort((left, right) => String(left).localeCompare(String(right)))
    for (const id of additionalIds) {
      const tag = await this.#tags.get(id)
      if (tag.status !== 'ACTIVE') throw new MilitaryError('TACTICAL_TAG_INACTIVE')
    }
    if (input.value.targetSkill !== undefined) {
      this.#assertSupplementTarget(input.value.targetSkill, input.requestedBy)
    }
    const goal = input.value.extractionGoal.trim()
    if (goal.length === 0 || goal.length > 160 || /[\u0000\r\n]/u.test(goal)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'extractionGoal must be one line containing 1-160 characters')
    }
    const desiredOutcome = input.value.desiredOutcome
      ?? (input.value.targetSkill === undefined ? 'AUTO' : 'SUPPLEMENT')
    if (
      (desiredOutcome === 'SUPPLEMENT' && input.value.targetSkill === undefined)
      || (desiredOutcome === 'NEW_TACTIC' && input.value.targetSkill !== undefined)
    ) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'SUPPLEMENT requires one exact target Skill; NEW_TACTIC must not name a target',
      )
    }
    const deterministicFallbackAllowed = input.value.allowDeterministicFallback === true
    const requestId = brand<string, 'TacticalIngestionRequestId'>(
      `private-ingestion-${sha256(stableJson({
        requestedBy: input.requestedBy,
        sourceHandle: String(source.sourceHandle),
        goal,
        primaryTagId: String(primary.tagId),
        additionalTagIds: additionalIds.map(String),
        targetSkill: input.value.targetSkill,
        desiredOutcome,
        deterministicFallbackAllowed,
        extractorRoute: this.#extractor.route,
      })).slice(0, 32)}`,
    )
    const existing = this.#repository.pipeline(requestId)
    if (existing !== null) return existing.job
    const timestamp = now(this.#clock)
    const request: TacticalIngestionRequest = {
      schemaVersion: '1.0.0',
      requestId,
      requestedBy: input.requestedBy,
      source: { sourceType: 'source-handle', sourceHandle: source.sourceHandle },
      tagSelection: {
        primaryTagId: primary.tagId,
        additionalTagIds: additionalIds,
        allowProposeNewTags: false,
      },
      desiredOutcome,
      ...(input.value.targetSkill === undefined ? {} : { targetSkill: input.value.targetSkill }),
      extractionGoal: goal,
      extractionPolicy: {
        classification: source.classification,
        visibility: source.visibility,
        redactSecrets: true,
        requireUserReview: true,
        allowExternalModel: canRouteToExternalExtractor(source, this.#extractor.route),
      },
      consent: {
        confirmed: true,
        purpose: 'Create a governed private Skill candidate',
        confirmedAt: timestamp,
      },
      createdAt: timestamp,
      idempotencyKey: String(requestId),
    }
    const job: PrivateSkillIngestionJob = {
      schemaVersion: '1.0.0',
      requestId,
      sourceHandle: source.sourceHandle,
      state: 'REQUESTED',
      extractionGoal: goal,
      primaryTagId: primary.tagId,
      additionalTagIds: additionalIds,
      ...(input.value.targetSkill === undefined ? {} : { targetSkill: input.value.targetSkill }),
      extractorRoute: this.#extractor.route,
      deterministicFallbackAllowed,
      chunkCount: 0,
      completedChunkCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.#repository.putPipeline({
      schemaVersion: '1.0.0',
      request,
      job,
      returnedInstructions: [],
      chunks: [],
    })
    this.#changed()
    return cloneFrozen(job)
  }

  async process(
    requestId: TacticalIngestionRequestId,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<PrivateSkillIngestionJob> {
    const key = String(requestId)
    const running = this.#processing.get(key)
    if (running !== undefined) return await running
    const operation = this.#process(requestId, signal).finally(() => { this.#processing.delete(key) })
    this.#processing.set(key, operation)
    return await operation
  }

  async #process(requestId: TacticalIngestionRequestId, signal: AbortSignal): Promise<PrivateSkillIngestionJob> {
    signal.throwIfAborted()
    let record = this.#requirePipeline(requestId)
    if (TERMINAL_JOB_STATES.has(record.job.state)) return record.job
    if (record.job.state === 'FAILED') {
      const {
        failureCode: _failureCode,
        failureMessage: _failureMessage,
        ...retryable
      } = record.job
      record = this.#replaceRecord(record, {
        job: {
          ...retryable,
          state: record.snapshot === undefined
            ? 'REQUESTED'
            : record.chunks.length === 0
              ? 'SCANNING'
              : 'EXTRACTING',
          updatedAt: now(this.#clock),
        },
      })
    }
    try {
      const snapshot = await this.snapshot(requestId)
      signal.throwIfAborted()
      record = this.#requirePipeline(requestId)
      const source = await this.source(record.job.sourceHandle)
      if (source.promptInjectionScan?.status === 'FAIL') {
        return await this.#fail(record, 'TACTICAL_SOURCE_PROMPT_INJECTION', 'source contains high-risk prompt injection')
      }
      if (source.promptInjectionScan?.status === 'WARN' && source.promptInjectionScan.acknowledgedBy === undefined) {
        return this.#replaceJob(record, { state: 'AWAITING_INJECTION_ACK' }).job
      }
      if (record.chunks.length === 0) {
        const content = new TextDecoder().decode(await this.#artifacts.get(snapshot.sourceArtifact.artifactId))
        const chunks = await this.#chunk(
          requestId,
          content,
          record.request.extractionPolicy.classification,
          source,
        )
        record = this.#replaceRecord(record, {
          chunks,
          job: {
            ...record.job,
            state: 'EXTRACTING',
            chunkCount: chunks.length,
            completedChunkCount: 0,
            updatedAt: now(this.#clock),
          },
        })
      }
      const candidate = await this.#extractCandidate(record, signal)
      const latest = this.#requirePipeline(requestId)
      return this.#replaceRecord(latest, {
        candidate,
        job: {
          ...latest.job,
          state: 'PENDING_REVIEW',
          candidateId: candidate.candidateId,
          completedChunkCount: latest.chunks.length,
          updatedAt: now(this.#clock),
        },
      }).job
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const code = error instanceof MilitaryError ? error.failure.code : 'TACTICAL_EXTRACTION_FAILED'
      const message = error instanceof Error ? error.message : String(error)
      return await this.#fail(this.#requirePipeline(requestId), code, message)
    }
  }

  async job(requestId: TacticalIngestionRequestId): Promise<PrivateSkillIngestionJob> {
    return this.#requirePipeline(requestId).job
  }

  async acknowledgeInjection(input: {
    readonly requestId: TacticalIngestionRequestId
    readonly actor: { readonly kind: 'USER'; readonly id: string }
  }): Promise<PrivateSkillIngestionJob> {
    if (input.actor.kind !== 'USER' || input.actor.id.trim().length === 0) {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', 'prompt-injection acknowledgement requires a user')
    }
    const record = this.#requirePipeline(input.requestId)
    const source = await this.source(record.job.sourceHandle)
    this.#assertSourceActor(source, input.actor.id, 'acknowledge prompt-injection findings for')
    if (source.promptInjectionScan?.status !== 'WARN') {
      throw new MilitaryError('REVISION_CONFLICT', 'only WARN sources can be acknowledged')
    }
    if (source.promptInjectionScan.acknowledgedBy === input.actor.id) {
      return cloneFrozen(record.job)
    }
    const updated: PrivateSkillSourceRecord = {
      ...source,
      promptInjectionScan: {
        ...source.promptInjectionScan,
        acknowledgedBy: input.actor.id,
        acknowledgedAt: now(this.#clock),
      },
      updatedAt: now(this.#clock),
    }
    this.#repository.putSource(updated)
    return this.#replaceJob(record, { state: 'SCANNING' }).job
  }

  async editCandidate(input: {
    readonly candidateId: TacticalExtractionCandidateId
    readonly expectedCandidateHash: string
    readonly actor: { readonly kind: 'USER'; readonly id: string }
    readonly title: string
    readonly claims: readonly string[]
    readonly risks: readonly string[]
    readonly validationPlan: readonly string[]
  }): Promise<TacticalExtractionCandidate> {
    if (input.actor.kind !== 'USER' || input.actor.id.trim().length === 0) {
      throw new MilitaryError('TACTICAL_REVIEW_REQUIRED', 'candidate editing requires an authenticated user action')
    }
    const record = this.#requireCandidate(input.candidateId)
    const candidate = record.candidate!
    const source = await this.source(record.job.sourceHandle)
    this.#assertSourceActor(source, input.actor.id, 'edit')
    const title = input.title.trim()
    const claims = input.claims.map(value => value.trim()).filter(Boolean)
    if (title.length === 0 || title.length > 160 || claims.length === 0 || claims.length > 24) {
      throw new MilitaryError('INVALID_ARGUMENT', 'candidate title and 1-24 claims are required')
    }
    if (claims.some(value => value.length < 10 || value.length > 1_200)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'each candidate claim must contain 10-1200 characters')
    }
    const risks = cleanBoundedStrings(input.risks, 20)
    const validationPlan = cleanBoundedStrings(input.validationPlan, 20)
    const exactEditAlreadyApplied = (
      candidate.proposedTitle === title
      && stableJson(candidate.highValueClaims.map(value => value.claim)) === stableJson(claims)
      && stableJson(candidate.risks) === stableJson(risks)
      && stableJson(candidate.validationPlan) === stableJson(validationPlan)
    )
    if (sha256(stableJson(candidate)) !== input.expectedCandidateHash) {
      if (exactEditAlreadyApplied) return cloneFrozen(candidate)
      throw new MilitaryError('TACTICAL_CANDIDATE_STALE')
    }
    if (!['PENDING_REVIEW', 'RETURNED'].includes(candidate.status)) {
      throw new MilitaryError('REVISION_CONFLICT')
    }
    if (exactEditAlreadyApplied) return cloneFrozen(candidate)
    const highValueClaims = claims.map((claim, index) => {
      const prior = candidate.highValueClaims[index]
      return {
        claim,
        evidence: prior?.evidence ?? [{
          kind: 'artifact' as const,
          ref: String(candidate.sourceSnapshot.artifactId),
          claim: `User-edited claim by ${input.actor.id}; verify against source`,
        }],
        confidence: Math.min(prior?.confidence ?? 0.5, 0.75),
      }
    })
    const content = compileProcedureMarkdown(title, highValueClaims, [{
      proposedTitle: title,
      claims: highValueClaims.map(value => ({ claim: value.claim, confidence: value.confidence })),
      risks,
      validationPlan,
    }])
    const proposedContent = await this.#artifacts.put({
      bytes: new TextEncoder().encode(content),
      mediaType: 'text/markdown',
      classification: record.request.extractionPolicy.classification,
      description: `User-edited private Skill candidate ${String(candidate.candidateId)}`,
      ...this.#artifactContext(source),
    })
    const diffArtifact = await this.#candidateDiff(record, content)
    const updated: TacticalExtractionCandidate = {
      ...candidate,
      proposedTitle: title,
      highValueClaims,
      risks,
      validationPlan,
      proposedContent,
      diffArtifact,
      status: 'PENDING_REVIEW',
    }
    this.#replaceRecord(record, {
      candidate: updated,
      job: { ...record.job, state: 'PENDING_REVIEW', updatedAt: now(this.#clock) },
    })
    return cloneFrozen(updated)
  }

  async reviewCandidate(input: {
    readonly candidateId: TacticalExtractionCandidateId
    readonly expectedCandidateHash: string
    readonly expectedDiffHash: string
    readonly action: 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT'
    readonly actor: { readonly kind: 'USER'; readonly id: string }
    readonly instructions?: string
  }): Promise<PrivateSkillReviewReceipt> {
    if (input.actor.kind !== 'USER' || input.actor.id.trim().length === 0) {
      throw new MilitaryError('TACTICAL_REVIEW_REQUIRED', 'candidate approval requires an authenticated user action')
    }
    const current = this.#requireCandidate(input.candidateId)
    const candidate = current.candidate!
    const source = await this.source(current.job.sourceHandle)
    this.#assertSourceActor(source, input.actor.id, 'review')
    const candidateHash = sha256(stableJson(candidate))
    const diffHash = String(candidate.diffArtifact?.sha256 ?? candidate.proposedContent.sha256)
    if (candidateHash !== input.expectedCandidateHash || diffHash !== input.expectedDiffHash) {
      throw new MilitaryError('TACTICAL_CANDIDATE_STALE', 'candidate or diff changed since review', {
        candidateHash,
        diffHash,
      })
    }
    if (input.action !== 'APPROVE_AS_DRAFT' && (input.instructions ?? '').trim().length === 0) {
      throw new MilitaryError('INVALID_ARGUMENT', 'return/reject requires instructions')
    }
    const receiptId = brand<string, 'PrivateSkillReviewReceiptId'>(
      `private-review-${sha256(stableJson({
        candidateId: String(candidate.candidateId),
        candidateHash,
        diffHash,
        action: input.action,
        actor: input.actor.id,
      })).slice(0, 32)}`,
    )
    const existing = this.#repository.listReviews().find(value => value.receiptId === receiptId)
    if (existing !== undefined) return existing
    if (candidate.status !== 'PENDING_REVIEW' && candidate.status !== 'RETURNED') {
      throw new MilitaryError('REVISION_CONFLICT', `candidate is ${candidate.status}`)
    }
    if (input.action === 'RETURN' || input.action === 'REJECT') {
      let mutated = false
      const receipt = await this.#repository.transaction(() => {
        const concurrent = this.#repository.listReviews()
          .find(value => value.receiptId === receiptId)
        if (concurrent !== undefined) return concurrent
        const latest = this.#requireCandidate(input.candidateId)
        if (sha256(stableJson(latest.candidate)) !== candidateHash) {
          throw new MilitaryError('TACTICAL_CANDIDATE_STALE')
        }
        const status = input.action === 'RETURN' ? 'RETURNED' as const : 'REJECTED' as const
        const review = this.#reviewReceipt(
          latest,
          input,
          candidateHash,
          diffHash,
          receiptId,
        )
        this.#repository.putPipeline({
          ...latest,
          returnedInstructions: [...latest.returnedInstructions, input.instructions!.trim()],
          candidate: { ...latest.candidate!, status },
          job: { ...latest.job, state: status, updatedAt: now(this.#clock) },
        })
        this.#repository.putReview(review)
        mutated = true
        return review
      })
      if (mutated) this.#changed()
      return cloneFrozen(receipt)
    }
    this.#assertUsableSource(source)
    const procedure = this.#procedureFor(candidate, source)
    // Bundle compilation writes files/artifacts and therefore runs outside the
    // short repository transaction. Its content address and exact
    // skill/version make an orphan recoverable; the fenced commit below is
    // the only operation that publishes the bundle into canonical state.
    const bundle = await this.#compileBundle(
      procedure,
      candidate,
      source,
    )
    let mutated = false
    const receipt = await this.#repository.transaction(() => {
      const concurrent = this.#repository.listReviews()
        .find(value => value.receiptId === receiptId)
      if (concurrent !== undefined) return concurrent
      const latest = this.#requireCandidate(input.candidateId)
      if (sha256(stableJson(latest.candidate)) !== candidateHash) throw new MilitaryError('TACTICAL_CANDIDATE_STALE')
      const latestSource = this.#repository.source(latest.job.sourceHandle)
      if (latestSource === null) {
        throw new MilitaryError('NOT_FOUND', 'private Skill source is missing')
      }
      this.#assertSourceActor(latestSource, input.actor.id, 'review')
      this.#assertUsableSource(latestSource)
      if (latest.candidate!.targetSkill !== undefined) {
        this.#assertSupplementTarget(latest.candidate!.targetSkill, input.actor.id)
      }
      const latestProcedure = this.#procedureFor(
        latest.candidate!,
        latestSource,
      )
      if (stableJson(latestProcedure) !== stableJson(procedure)) {
        throw new MilitaryError(
          'TACTICAL_CANDIDATE_STALE',
          'private Skill procedure changed while its bundle was compiled',
        )
      }
      const committed = cloneFrozen({ ...latest.candidate!, status: 'APPROVED_AS_DRAFT' as const })
      this.#repository.putPipeline({
        ...latest,
        candidate: committed,
        job: { ...latest.job, state: 'APPROVED_AS_DRAFT', updatedAt: now(this.#clock) },
      })
      this.#repository.putBundle(bundle)
      const receipt = this.#reviewReceipt(
        latest,
        input,
        candidateHash,
        diffHash,
        receiptId,
        { skillId: procedure.skillId, version: procedure.version },
      )
      this.#repository.putReview(receipt)
      // Publish last. If it rejects, repository state rolls back; if it
      // succeeds, there is no later fallible mutation that can strand the
      // in-memory tactical registry outside the aggregate transaction.
      this.#tactics.publish(procedure)
      mutated = true
      return receipt
    })
    if (mutated) this.#changed()
    return cloneFrozen(receipt)
  }

  async promote(input: {
    readonly skillId: string
    readonly version: SemVer
    readonly to: 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED'
    readonly requestedBy: string
    readonly reason: string
    readonly evidenceRefs: readonly string[]
  }): Promise<PrivateSkillPromotionReceipt> {
    if (input.requestedBy.trim().length === 0 || input.reason.trim().length === 0) {
      throw new MilitaryError('INVALID_ARGUMENT', 'promotion requires user identity and reason')
    }
    const skillId = tacticalId(input.skillId)
    this.#tactics.get(skillId, input.version)
    if (!['QUARANTINED', 'DEPRECATED'].includes(input.to) && input.evidenceRefs.length === 0) {
      throw new MilitaryError('TACTICAL_REVIEW_REQUIRED', 'promotion requires validation evidence')
    }
    const bundle = this.#repository.bundle(input.skillId, String(input.version))
    if (bundle === null) throw new MilitaryError('NOT_FOUND', 'compiled private Skill bundle is missing')
    const sources = this.#sourcesForBundle(bundle)
    for (const source of sources) {
      this.#assertSourceActor(source, input.requestedBy, 'promote')
      this.#assertPromotionRights(source, input.to)
    }
    const receiptId = brand<string, 'PrivateSkillPromotionReceiptId'>(
      `private-promotion-${sha256(stableJson({
        skillId: input.skillId,
        version: String(input.version),
        to: input.to,
        requestedBy: input.requestedBy,
        reason: input.reason,
        evidenceRefs: input.evidenceRefs,
      })).slice(0, 32)}`,
    )
    const existing = this.#repository.listPromotions().find(value => value.receiptId === receiptId)
    if (existing !== undefined) return existing
    let mutated = false
    const receipt = await this.#repository.transaction(() => {
      const concurrent = this.#repository.listPromotions()
        .find(value => value.receiptId === receiptId)
      if (concurrent !== undefined) return concurrent
      const latestBundle = this.#repository.bundle(input.skillId, String(input.version))
      if (latestBundle === null) {
        throw new MilitaryError('NOT_FOUND', 'compiled private Skill bundle is missing')
      }
      const latestSources = this.#sourcesForBundle(latestBundle)
      for (const latestSource of latestSources) {
        this.#assertSourceActor(latestSource, input.requestedBy, 'promote')
        this.#assertPromotionRights(latestSource, input.to)
      }
      const latest = this.#tactics.get(skillId, input.version)
      const receipt: PrivateSkillPromotionReceipt = {
        schemaVersion: '1.0.0',
        receiptId,
        skill: { skillId, version: input.version },
        from: latest.lifecycle,
        to: input.to,
        requestedBy: input.requestedBy,
        evidenceRefs: [...input.evidenceRefs],
        reason: input.reason.trim(),
        createdAt: now(this.#clock),
      }
      this.#repository.putPromotion(receipt)
      this.#repository.putBundle({ ...latestBundle, lifecycle: input.to })
      const updated = this.#tactics.transition(skillId, input.version, input.to)
      if (updated.lifecycle !== input.to) throw new MilitaryError('REVISION_CONFLICT')
      mutated = true
      return cloneFrozen(receipt)
    })
    if (mutated) this.#changed()
    return cloneFrozen(receipt)
  }

  async bundle(skillId: string, version: SemVer): Promise<PrivateSkillBundleSnapshot> {
    const value = this.#repository.bundle(skillId, String(version))
    if (value === null) throw new MilitaryError('NOT_FOUND', `unknown private Skill ${skillId}@${String(version)}`)
    return value
  }

  async deliveryEligibility(skillId: string, version: SemVer): Promise<{
    readonly eligible: boolean
    readonly reasons: readonly string[]
  }> {
    const bundle = this.#repository.bundle(skillId, String(version))
    if (bundle === null) return { eligible: false, reasons: ['BUNDLE_MISSING'] }
    let sources: readonly PrivateSkillSourceRecord[]
    try {
      sources = this.#sourcesForBundle(bundle)
    } catch {
      return { eligible: false, reasons: ['SOURCE_LINEAGE_MISSING'] }
    }
    const reasons = unique(sources.flatMap(
      source => deliveryRightsReasons(source, bundle.lifecycle, this.#clock().getTime()),
    ))
    return {
      eligible: reasons.length === 0,
      reasons,
    }
  }

  async recordUsage(
    input: Omit<PrivateSkillUsageRecord, 'schemaVersion' | 'usageId' | 'createdAt'>,
  ): Promise<PrivateSkillUsageRecord> {
    const procedure = this.#tactics.get(input.skill.skillId, input.skill.version)
    if (procedure.lifecycle === 'DRAFT' || procedure.lifecycle === 'SIMULATION') {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', `cannot use ${procedure.lifecycle} private Skill`)
    }
    const usageId = brand<string, 'PrivateSkillUsageId'>(
      `private-skill-usage-${sha256(stableJson({
        skill: input.skill,
        missionId: input.missionId,
        taskId: input.taskId,
        verifierReceiptRefs: input.verifierReceiptRefs,
        ...(input.verifierReceiptRefs.length === 0
          ? {
            toolEvidenceRefs: input.toolEvidenceRefs,
            outcome: input.outcome,
          }
          : {}),
      })).slice(0, 32)}`,
    )
    const existing = this.#repository.listUsages().find(value => value.usageId === usageId)
    if (existing !== undefined) return cloneFrozen(existing)
    let mutated = false
    const usage = await this.#repository.transaction(() => {
      const concurrent = this.#repository.listUsages().find(value => value.usageId === usageId)
      if (concurrent !== undefined) return cloneFrozen(concurrent)
      const usage: PrivateSkillUsageRecord = {
        ...input,
        schemaVersion: '1.0.0',
        usageId,
        createdAt: now(this.#clock),
      }
      this.#repository.putUsage(usage)
      mutated = true
      return cloneFrozen(usage)
    })
    if (mutated) this.#changed()
    return usage
  }

  async operationSnapshot(): Promise<PrivateSkillOperationSnapshot> {
    const sources = this.#repository.listSources().map((source) => {
      const { rawVaultRef: _rawVaultRef, ...visible } = source
      return visible
    })
    return cloneFrozen({
      schemaVersion: '1.0.0',
      sources,
      pipelines: this.#repository.listPipelines().map(value => ({
        requestId: value.request.requestId,
        sourceHandle: value.job.sourceHandle,
        returnedInstructions: value.returnedInstructions,
        ...(value.snapshot === undefined ? {} : { snapshot: value.snapshot }),
        chunks: value.chunks,
        ...(value.candidate === undefined
          ? {}
          : { candidateId: value.candidate.candidateId }),
      })),
      jobs: this.#repository.listPipelines().map(value => value.job),
      candidates: this.#repository.listPipelines().flatMap(value => value.candidate === undefined ? [] : [value.candidate]),
      reviews: this.#repository.listReviews(),
      promotions: this.#repository.listPromotions(),
      bundles: this.#repository.listBundles(),
      usages: this.#repository.listUsages(),
      revocations: this.#repository.listRevocations(),
      generatedAt: now(this.#clock),
    })
  }

  async request(input: TacticalIngestionRequest): Promise<{
    readonly requestId: TacticalIngestionRequestId
    readonly state: 'REQUESTED'
  }> {
    const existing = this.#repository.pipeline(input.requestId)
    if (existing !== null) {
      const canonicalInput = input.source.sourceType === 'source-handle'
        ? input
        : { ...input, source: existing.request.source }
      if (stableJson(existing.request) !== stableJson(canonicalInput)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return { requestId: input.requestId, state: 'REQUESTED' }
    }
    if (!input.consent.confirmed || !input.extractionPolicy.requireUserReview) {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED')
    }
    const source = input.source.sourceType === 'source-handle'
      ? await this.source(input.source.sourceHandle)
      : await this.createSource({
          requestedBy: input.requestedBy,
          source: legacySource(input),
        })
    const timestamp = now(this.#clock)
    const request: TacticalIngestionRequest = {
      ...input,
      source: { sourceType: 'source-handle', sourceHandle: source.sourceHandle },
    }
    this.#repository.putPipeline({
      schemaVersion: '1.0.0',
      request,
      job: {
        schemaVersion: '1.0.0',
        requestId: input.requestId,
        sourceHandle: source.sourceHandle,
        state: 'REQUESTED',
        extractionGoal: input.extractionGoal ?? source.title,
        primaryTagId: input.tagSelection.primaryTagId,
        additionalTagIds: [...input.tagSelection.additionalTagIds],
        ...(input.targetSkill === undefined ? {} : { targetSkill: input.targetSkill }),
        extractorRoute: this.#extractor.route,
        deterministicFallbackAllowed: this.#extractor.route.mode === 'DETERMINISTIC_FALLBACK',
        chunkCount: 0,
        completedChunkCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      returnedInstructions: [],
      chunks: [],
    })
    this.#changed()
    return { requestId: input.requestId, state: 'REQUESTED' }
  }

  async snapshot(requestId: TacticalIngestionRequestId): Promise<TacticalIngestionSnapshot> {
    let record = this.#requirePipeline(requestId)
    if (record.snapshot !== undefined) return record.snapshot
    record = this.#replaceJob(record, { state: 'SNAPSHOTTING' })
    const source = await this.source(record.job.sourceHandle)
    const rawBytes = await this.#rawVault.get(brand<string, 'ArtifactId'>(source.rawVaultRef))
    const scan = sanitizeSource(new TextDecoder().decode(rawBytes))
    const sanitizedBytes = new TextEncoder().encode(scan.sanitized)
    const sourceArtifact = await this.#artifacts.put({
      bytes: sanitizedBytes,
      mediaType: 'text/plain',
      classification: source.classification,
      description: `Sanitized private Skill source ${String(source.sourceHandle)}`,
      ...this.#artifactContext(source),
    })
    const receiptBody = {
      schemaVersion: '1.0.0',
      sourceHandle: String(source.sourceHandle),
      sourceHash: String(source.sourceHash),
      sanitizedHash: sha256(sanitizedBytes),
      redactions: scan.redactions,
      promptInjectionScan: scan.injection,
      rawBytes: rawBytes.byteLength,
      sanitizedBytes: sanitizedBytes.byteLength,
    }
    const redactionReceipt = await this.#artifacts.put({
      bytes: new TextEncoder().encode(`${JSON.stringify(receiptBody, null, 2)}\n`),
      mediaType: 'application/json',
      classification: source.classification,
      description: 'Private Skill deterministic sanitization receipt',
      ...this.#artifactContext(source),
    })
    const snapshot: TacticalIngestionSnapshot = {
      requestId,
      sourceArtifact,
      contentHash: sha256(sanitizedBytes),
      redactionReceipt,
      ...(source.sourceKind === 'SESSION_RANGE' ? { sourcePresetId: 'military' } : {}),
    }
    const updatedSource: PrivateSkillSourceRecord = {
      ...source,
      status: scan.injection.status === 'FAIL' ? 'QUARANTINED' : 'SANITIZED',
      sanitizedArtifact: sourceArtifact,
      redactionReceipt,
      promptInjectionScan: scan.injection,
      updatedAt: now(this.#clock),
    }
    const next: PrivateSkillPipelineRecord = cloneFrozen({
      ...record,
      snapshot,
      job: {
        ...record.job,
        state: 'SCANNING',
        updatedAt: now(this.#clock),
      },
    })
    await this.#repository.transaction(() => {
      this.#repository.putSource(updatedSource)
      this.#knowledge?.registerSource(this.#knowledgeSnapshot(updatedSource, snapshot))
      this.#repository.putPipeline(next)
    })
    this.#changed()
    return cloneFrozen(snapshot)
  }

  async candidate(requestId: TacticalIngestionRequestId): Promise<TacticalExtractionCandidate | null> {
    const record = this.#requirePipeline(requestId)
    if (record.candidate !== undefined) return record.candidate
    const job = await this.process(requestId)
    if (job.state === 'AWAITING_INJECTION_ACK' || job.state === 'FAILED') return null
    return this.#requirePipeline(requestId).candidate ?? null
  }

  async candidateById(candidateId: TacticalExtractionCandidateId): Promise<TacticalExtractionCandidate> {
    return this.#requireCandidate(candidateId).candidate!
  }

  async returnCandidate(candidateId: TacticalExtractionCandidateId, instructions: string): Promise<void> {
    if (instructions.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    const record = this.#requireCandidate(candidateId)
    if (!['PENDING_REVIEW', 'RETURNED'].includes(record.candidate!.status)) throw new MilitaryError('REVISION_CONFLICT')
    this.#replaceRecord(record, {
      returnedInstructions: [...record.returnedInstructions, instructions.trim()],
      candidate: { ...record.candidate!, status: 'RETURNED' },
      job: { ...record.job, state: 'RETURNED', updatedAt: now(this.#clock) },
    })
  }

  async rejectCandidate(candidateId: TacticalExtractionCandidateId, reason: string): Promise<void> {
    if (reason.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    const record = this.#requireCandidate(candidateId)
    this.#replaceRecord(record, {
      returnedInstructions: [...record.returnedInstructions, reason.trim()],
      candidate: { ...record.candidate!, status: 'REJECTED' },
      job: { ...record.job, state: 'REJECTED', updatedAt: now(this.#clock) },
    })
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async #extractCandidate(
    initial: PrivateSkillPipelineRecord,
    signal: AbortSignal,
  ): Promise<TacticalExtractionCandidate> {
    let record = initial
    const source = await this.source(record.job.sourceHandle)
    const primary = await this.#tags.get(record.job.primaryTagId)
    const additional = await Promise.all(record.job.additionalTagIds.map(async id => await this.#tags.get(id)))
    const results: TacticalChunkExtraction[] = []
    for (const chunk of record.chunks) {
      signal.throwIfAborted()
      if (chunk.extractionState === 'COMPLETED') {
        results.push(await this.#readChunkReceipt(chunk))
        continue
      }
      record = this.#replaceChunk(record, chunk.chunkId, {
        ...chunk,
        extractionState: 'EXTRACTING',
        attempts: chunk.attempts + 1,
      })
      const content = new TextDecoder().decode(await this.#artifacts.get(chunk.artifact.artifactId))
      let result: TacticalChunkExtraction
      let usedExtractor = this.#extractor
      try {
        try {
          if (
            this.#extractor.route.mode === 'FLASH'
            && record.request.extractionPolicy.allowExternalModel !== true
          ) {
            if (!record.job.deterministicFallbackAllowed) {
              throw new MilitaryError(
                'TACTICAL_SOURCE_NOT_AUTHORIZED',
                'confidential/restricted source has no consent for external model processing',
              )
            }
            usedExtractor = this.#fallbackExtractor
          }
          result = await usedExtractor.extractChunk({
            request: record.request,
            chunk,
            content,
            primaryTag: primary,
            additionalTags: additional,
            signal,
          })
        } catch (error) {
          if (
            usedExtractor === this.#fallbackExtractor
            || !record.job.deterministicFallbackAllowed
            || this.#extractor === this.#fallbackExtractor
          ) throw error
          usedExtractor = this.#fallbackExtractor
          result = await this.#fallbackExtractor.extractChunk({
            request: record.request,
            chunk,
            content,
            primaryTag: primary,
            additionalTags: additional,
            signal,
          })
        }
      } catch (error) {
        record = this.#replaceChunk(record, chunk.chunkId, {
          ...chunk,
          extractionState: 'FAILED',
          attempts: chunk.attempts + 1,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
        })
        throw error
      }
      validateChunkExtraction(result)
      const receipt = await this.#artifacts.put({
        bytes: new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`),
        mediaType: 'application/json',
        classification: record.request.extractionPolicy.classification,
        description: `Private Skill chunk extraction ${chunk.chunkId}`,
        ...this.#artifactContext(source),
      })
      const completed: PrivateSkillChunkRecord = {
        ...chunk,
        extractionState: 'COMPLETED',
        extractorRoute: usedExtractor.route,
        extractionArtifact: receipt,
        attempts: chunk.attempts + 1,
      }
      record = this.#replaceChunk(record, chunk.chunkId, completed)
      record = this.#replaceRecord(record, {
        job: {
          ...record.job,
          completedChunkCount: record.chunks.filter(value => value.extractionState === 'COMPLETED').length,
          updatedAt: now(this.#clock),
        },
      })
      results.push(result)
    }
    record = this.#replaceJob(record, { state: 'VALIDATING' })
    const claims = aggregateClaims(results, record.chunks)
    if (claims.length === 0) throw new MilitaryError('TACTICAL_EXTRACTION_FAILED', 'extractor produced no reviewable claims')
    const title = results.map(value => value.proposedTitle?.trim()).find(value => value !== undefined && value.length > 0)
      ?? record.job.extractionGoal
    const content = compileProcedureMarkdown(title, claims, results)
    const proposedContent = await this.#artifacts.put({
      bytes: new TextEncoder().encode(content),
      mediaType: 'text/markdown',
      classification: record.request.extractionPolicy.classification,
      description: 'Aggregated private Skill candidate',
      ...this.#artifactContext(source),
    })
    const diffArtifact = await this.#candidateDiff(record, content)
    const candidate: TacticalExtractionCandidate = {
      schemaVersion: '1.0.0',
      candidateId: brand<string, 'TacticalExtractionCandidateId'>(
        `private-candidate-${sha256(`${String(record.request.requestId)}\n${String(proposedContent.sha256)}`).slice(0, 32)}`,
      ),
      requestId: record.request.requestId,
      sourceSnapshot: record.snapshot!.sourceArtifact,
      disposition: record.request.desiredOutcome === 'SUPPLEMENT' ? 'SUPPLEMENT' : 'NEW_TACTIC',
      primaryTagId: primary.tagId,
      additionalTagIds: additional.map(tag => tag.tagId),
      ...(record.request.targetSkill === undefined ? {} : { targetSkill: record.request.targetSkill }),
      proposedTitle: title,
      highValueClaims: claims,
      proposedContent,
      diffArtifact,
      risks: unique(results.flatMap(value => value.risks)).slice(0, 20),
      validationPlan: unique(results.flatMap(value => value.validationPlan)).slice(0, 20),
      status: 'PENDING_REVIEW',
      createdAt: now(this.#clock),
    }
    this.#repository.indexCandidate(candidate.candidateId, record.request.requestId)
    return cloneFrozen(candidate)
  }

  async #readChunkReceipt(chunk: PrivateSkillChunkRecord): Promise<TacticalChunkExtraction> {
    if (chunk.extractionArtifact === undefined) {
      throw new MilitaryError('TACTICAL_EXTRACTION_FAILED', `chunk ${chunk.chunkId} has no extraction receipt`)
    }
    const bytes = await this.#artifacts.get(chunk.extractionArtifact.artifactId)
    const value = JSON.parse(new TextDecoder().decode(bytes)) as TacticalChunkExtraction
    validateChunkExtraction(value)
    return value
  }

  async #chunk(
    requestId: TacticalIngestionRequestId,
    content: string,
    classification: TacticalIngestionRequest['extractionPolicy']['classification'],
    source: PrivateSkillSourceRecord,
  ): Promise<PrivateSkillChunkRecord[]> {
    const ranges = chunkRanges(content, 6_000, 320)
    const chunks: PrivateSkillChunkRecord[] = []
    for (const [ordinal, range] of ranges.entries()) {
      const text = content.slice(range.start, range.end)
      const artifact = await this.#artifacts.put({
        bytes: new TextEncoder().encode(text),
        mediaType: 'text/plain',
        classification,
        description: `Sanitized private Skill chunk ${ordinal + 1}/${ranges.length}`,
        ...this.#artifactContext(source),
      })
      chunks.push({
        schemaVersion: '1.0.0',
        requestId,
        chunkId: `chunk-${String(ordinal + 1).padStart(4, '0')}-${sha256(text).slice(0, 12)}`,
        ordinal,
        startOffset: range.start,
        endOffset: range.end,
        contentHash: brand<string, 'Sha256'>(sha256(text)),
        artifact,
        extractionState: 'PENDING',
        attempts: 0,
      })
    }
    return chunks
  }

  async #candidateDiff(record: PrivateSkillPipelineRecord, content: string): Promise<ArtifactRef> {
    let previous = ''
    if (record.request.targetSkill !== undefined) {
      try {
        const tactic = this.#tactics.get(record.request.targetSkill.skillId, record.request.targetSkill.version)
        previous = tactic.steps.map(step => `- ${step.action}`).join('\n')
      } catch { /* exact target absence remains visible as an empty previous snapshot */ }
    }
    const diff = [
      '# Candidate review diff',
      '',
      '## Existing',
      previous === '' ? '_No existing exact version._' : previous,
      '',
      '## Proposed',
      content,
    ].join('\n')
    return await this.#artifacts.put({
      bytes: new TextEncoder().encode(diff),
      mediaType: 'text/markdown',
      classification: record.request.extractionPolicy.classification,
      description: 'Private Skill user-review diff',
      ...this.#artifactContext(await this.source(record.job.sourceHandle)),
    })
  }

  #artifactContext(source: PrivateSkillSourceRecord) {
    return {
      tenantId: this.#tenantId,
      ownerPrincipalId: source.rights.ownerId,
      audiencePrincipalIds: [
        'military-host',
        ...source.rights.allowedAudience,
      ],
      audienceScopes: ['artifact:read', 'military:private-skill'],
      ...(source.rights.validUntil === undefined
        ? {}
        : { retentionUntil: source.rights.validUntil }),
      residencyPolicyRef: 'local-private-skill-artifacts@1',
    } as const
  }

  #procedureFor(
    candidate: TacticalExtractionCandidate,
    source: PrivateSkillSourceRecord,
  ): TacticalProcedure {
    const skillId = candidate.targetSkill?.skillId ?? tacticalId(skillIdFromTitle(candidate.proposedTitle, candidate))
    const version = this.#nextVersion(skillId, candidate.targetSkill?.version)
    const base = candidate.targetSkill === undefined
      ? undefined
      : this.#tactics.get(candidate.targetSkill.skillId, candidate.targetSkill.version)
    const newSteps = candidate.highValueClaims.map((claim) => ({
      id: '',
      action: claim.claim,
      expectedObservation: `Evidence confidence ${(claim.confidence * 100).toFixed(0)}%`,
    }))
    const steps = uniqueBy(
      [...(base?.steps ?? []), ...newSteps],
      value => value.action.trim().toLocaleLowerCase(),
    ).map((step, index) => ({ ...step, id: `step-${index + 1}` }))
    const stopConditions = unique([...(base?.stopConditions ?? []), ...candidate.risks])
    const verifierRequirements = unique([
      ...(base?.verifierRequirements ?? []),
      ...(candidate.validationPlan.length === 0
        ? ['Run the procedure in simulation and retain deterministic evidence.']
        : candidate.validationPlan),
    ])
    if (steps.length > 64 || stopConditions.length > 64 || verifierRequirements.length > 64) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'supplement would exceed the bounded 64-item procedure, stop-condition, or verifier contract',
      )
    }
    const value: Omit<TacticalProcedure, 'contentHash'> = {
      schemaVersion: '1.0.0',
      skillId,
      version,
      title: candidate.proposedTitle,
      lifecycle: 'DRAFT',
      scenarioTags: unique([
        ...(base?.scenarioTags ?? []),
        String(candidate.primaryTagId),
        ...candidate.additionalTagIds.map(String),
      ]),
      preconditions: unique([
        ...(base?.preconditions ?? []),
        ...source.rights.dependencyVersions.map(value => `Required dependency version: ${value}`),
      ]),
      exclusions: [...(base?.exclusions ?? [])],
      steps,
      stopConditions,
      verifierRequirements,
      provenanceRefs: unique([
        ...(base?.provenanceRefs ?? []),
        String(candidate.sourceSnapshot.artifactId),
        ...source.rights.dependencyVersions.map(value => `dependency-version:${value}`),
        ...candidate.highValueClaims.flatMap(claim => claim.evidence.map(value => value.ref)),
      ]),
    }
    return { ...value, contentHash: sha256(stableJson(value)) }
  }

  #nextVersion(skillId: TacticalSkillId, requested?: SemVer): SemVer {
    const versions = this.#tactics.list()
      .filter(value => value.skillId === skillId)
      .map(value => String(value.version))
    if (versions.length === 0 && requested === undefined) return semver('0.1.0')
    const base = requested === undefined ? versions.at(-1)! : String(requested)
    const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(base)
    if (match === null) return semver(`0.1.${versions.length}`)
    return semver(`${match[1]}.${match[2]}.${Number(match[3]) + 1}`)
  }

  async #compileBundle(
    procedure: TacticalProcedure,
    candidate: TacticalExtractionCandidate,
    source: PrivateSkillSourceRecord,
  ): Promise<PrivateSkillBundleSnapshot> {
    const name = skillName(String(procedure.skillId), candidate.proposedTitle)
    const description = skillDescription(candidate, procedure)
    const skillMd = compileSkillMd(name, description, procedure)
    if (skillMd.split(/\r?\n/u).length > 500) {
      throw new MilitaryError('INVALID_ARGUMENT', 'compiled SKILL.md exceeds the 500-line disclosure budget')
    }
    const inheritedSourceIds = candidate.targetSkill === undefined
      ? []
      : this.#requireBundle(candidate.targetSkill).sourceSnapshotIds
    const sourceSnapshotIds = unique([...inheritedSourceIds, String(source.sourceHandle)])
    const lineageSources = sourceSnapshotIds.map(handle => {
      const value = this.#repository.source(brand<string, 'PrivateSkillSourceHandle'>(handle))
      if (value === null) throw new MilitaryError('NOT_FOUND', 'private Skill source lineage is missing')
      return value
    })
    return await this.#bundles.write({
      skill: { skillId: procedure.skillId, version: procedure.version },
      name,
      description,
      lifecycle: procedure.lifecycle,
      sourceSnapshotIds,
      files: [
        { path: 'SKILL.md', content: skillMd },
        { path: 'references/procedure.md', content: compileReference(candidate, procedure, lineageSources) },
        { path: 'examples/minimal.md', content: compileExample(procedure) },
        { path: 'scripts/verify.mjs', content: compileVerifierScript(name), executable: true },
      ],
      createdAt: candidate.createdAt,
    })
  }

  #reviewReceipt(
    record: PrivateSkillPipelineRecord,
    input: Parameters<MilitaryIngestion['reviewCandidate']>[0],
    candidateHash: string,
    diffHash: string,
    receiptId: PrivateSkillReviewReceipt['receiptId'],
    committedSkill?: PrivateSkillReviewReceipt['committedSkill'],
  ): PrivateSkillReviewReceipt {
    return cloneFrozen({
      schemaVersion: '1.0.0',
      receiptId,
      candidateId: input.candidateId,
      candidateHash: brand<string, 'Sha256'>(candidateHash),
      diffHash: brand<string, 'Sha256'>(diffHash),
      action: input.action,
      actor: input.actor,
      scope: record.request.extractionPolicy.visibility,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions.trim() }),
      ...(committedSkill === undefined ? {} : { committedSkill }),
      createdAt: now(this.#clock),
    })
  }

  #requireBundle(skill: { readonly skillId: TacticalSkillId; readonly version: SemVer }): PrivateSkillBundleSnapshot {
    const bundle = this.#repository.bundle(String(skill.skillId), String(skill.version))
    if (bundle === null) {
      throw new MilitaryError(
        'NOT_FOUND',
        `target private Skill ${String(skill.skillId)}@${String(skill.version)} is missing`,
      )
    }
    return bundle
  }

  #sourcesForBundle(bundle: PrivateSkillBundleSnapshot): readonly PrivateSkillSourceRecord[] {
    if (bundle.sourceSnapshotIds.length === 0) {
      throw new MilitaryError('NOT_FOUND', 'private Skill has no source lineage')
    }
    return bundle.sourceSnapshotIds.map(handle => {
      const source = this.#repository.source(brand<string, 'PrivateSkillSourceHandle'>(handle))
      if (source === null) throw new MilitaryError('NOT_FOUND', 'private Skill source lineage is missing')
      return source
    })
  }

  #assertSupplementTarget(
    skill: { readonly skillId: TacticalSkillId; readonly version: SemVer },
    requestedBy: string,
  ): void {
    const bundle = this.#requireBundle(skill)
    this.#tactics.get(skill.skillId, skill.version)
    if (bundle.lifecycle === 'QUARANTINED' || bundle.lifecycle === 'DEPRECATED') {
      throw new MilitaryError(
        'TACTICAL_SOURCE_NOT_AUTHORIZED',
        `cannot supplement a ${bundle.lifecycle} private Skill`,
      )
    }
    for (const source of this.#sourcesForBundle(bundle)) {
      this.#assertSourceActor(source, requestedBy, 'supplement')
      this.#assertUsableSource(source)
    }
  }

  #assertPromotionRights(
    source: PrivateSkillSourceRecord,
    to: PrivateSkillPromotionReceipt['to'],
  ): void {
    if (source.status === 'REVOKED' || source.status === 'QUARANTINED') {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', `source is ${source.status}`)
    }
    if (['CANARY', 'TESTING', 'STABLE'].includes(to) && source.rights.license === 'UNKNOWN') {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', 'unknown source rights cannot leave private draft/simulation')
    }
    const requiredUse = visibilityAllowedUse(source.visibility)
    if (['CANARY', 'TESTING', 'STABLE'].includes(to) && !source.rights.allowedUse.includes(requiredUse)) {
      throw new MilitaryError(
        'TACTICAL_SOURCE_NOT_AUTHORIZED',
        `source rights do not permit ${source.visibility} delivery (${requiredUse})`,
      )
    }
    if (source.rights.validUntil !== undefined && Date.parse(source.rights.validUntil) <= this.#clock().getTime()) {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', 'source rights have expired')
    }
  }

  #assertDraftRights(source: PrivateSkillSourceRecord): void {
    if (!source.rights.derivativeWorkAllowed) {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', 'source rights prohibit derivative work')
    }
    const requiredUse = visibilityAllowedUse(source.visibility)
    if (!source.rights.allowedUse.includes(requiredUse)) {
      throw new MilitaryError(
        'TACTICAL_SOURCE_NOT_AUTHORIZED',
        `source rights do not permit ${source.visibility} compilation (${requiredUse})`,
      )
    }
  }

  #assertSourceActor(
    source: PrivateSkillSourceRecord,
    actorId: string,
    action: string,
  ): void {
    if (actorId.trim().length === 0 || actorId !== source.rights.ownerId) {
      throw new MilitaryError(
        'TACTICAL_SOURCE_NOT_AUTHORIZED',
        `only source owner ${source.rights.ownerId} may ${action} this private Skill source`,
      )
    }
  }

  #assertUsableSource(source: PrivateSkillSourceRecord): void {
    if (source.status === 'REVOKED' || source.status === 'QUARANTINED') {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', `source is ${source.status}`)
    }
    this.#assertDraftRights(source)
    if (source.rights.validUntil !== undefined && Date.parse(source.rights.validUntil) <= this.#clock().getTime()) {
      throw new MilitaryError('TACTICAL_SOURCE_NOT_AUTHORIZED', 'source rights have expired')
    }
  }

  #knowledgeSnapshot(
    source: PrivateSkillSourceRecord,
    snapshot: TacticalIngestionSnapshot,
  ): TacticalSourceSnapshot {
    const validUntil = source.rights.validUntil
      ?? brand<string, 'IsoDateTime'>(new Date(this.#clock().getTime() + 10 * 365 * 24 * 60 * 60 * 1_000).toISOString())
    return {
      schemaVersion: '1.0.0',
      snapshotId: String(source.sourceHandle),
      requestId: String(snapshot.requestId),
      sourceKind: source.sourceKind,
      sourceOwnerId: source.rights.ownerId,
      sourceLicense: source.rights.license,
      allowedUse: source.rights.allowedUse,
      allowedAudience: source.rights.allowedAudience,
      derivativeWorkAllowed: source.rights.derivativeWorkAllowed,
      externalModelProcessingAllowed: source.rights.externalModelProcessingAllowed,
      retentionPolicyRef: source.rights.retentionPolicyRef,
      revocationPolicyRef: source.rights.revocationPolicyRef,
      sourceArtifact: snapshot.sourceArtifact,
      sourceHash: source.sourceHash,
      classification: source.classification,
      redactionReceipt: snapshot.redactionReceipt,
      promptInjectionScan: source.promptInjectionScan ?? { status: 'PASS', findings: [] },
      temporalValidity: {
        validFrom: source.createdAt,
        validUntil,
        dependencyVersions: source.rights.dependencyVersions,
      },
      sourcePresetId: source.sourceKind === 'SESSION_RANGE' ? 'military' : 'external-material',
      createdAt: now(this.#clock),
    }
  }

  async #sourceCreateBytes(source: PrivateSkillSourceCreateInput): Promise<Uint8Array> {
    switch (source.kind) {
      case 'DIRECT_TEXT':
        return new TextEncoder().encode(source.content)
      case 'ARTIFACT':
        return await this.#artifacts.get(source.artifact.artifactId)
      case 'SESSION_RANGE':
        return await this.#sessions.read({
          sessionId: String(source.sessionId),
          ...(source.startSeq === undefined ? {} : { startSeq: source.startSeq }),
          ...(source.endSeq === undefined ? {} : { endSeq: source.endSeq }),
          includeToolResults: source.includeToolResults === true,
        })
    }
  }

  #requirePipeline(id: TacticalIngestionRequestId): PrivateSkillPipelineRecord {
    const value = this.#repository.pipeline(id)
    if (value === null) throw new MilitaryError('NOT_FOUND', `unknown ingestion request ${String(id)}`)
    return value
  }

  #requireCandidate(id: TacticalExtractionCandidateId): PrivateSkillPipelineRecord {
    const requestId = this.#repository.requestIdForCandidate(id)
    if (requestId === null) throw new MilitaryError('NOT_FOUND', `unknown tactical candidate ${String(id)}`)
    const value = this.#requirePipeline(requestId)
    if (value.candidate === undefined) throw new MilitaryError('NOT_FOUND')
    return value
  }

  #replaceJob(
    record: PrivateSkillPipelineRecord,
    patch: Partial<Pick<PrivateSkillIngestionJob, 'state' | 'failureCode' | 'failureMessage'>>,
  ): PrivateSkillPipelineRecord {
    return this.#replaceRecord(record, {
      job: {
        ...record.job,
        ...patch,
        updatedAt: now(this.#clock),
      },
    })
  }

  #replaceChunk(
    record: PrivateSkillPipelineRecord,
    chunkId: string,
    chunk: PrivateSkillChunkRecord,
  ): PrivateSkillPipelineRecord {
    return this.#replaceRecord(record, {
      chunks: record.chunks.map(value => value.chunkId === chunkId ? chunk : value),
    })
  }

  #replaceRecord(
    record: PrivateSkillPipelineRecord,
    patch: Partial<Omit<PrivateSkillPipelineRecord, 'schemaVersion' | 'request'>>,
  ): PrivateSkillPipelineRecord {
    const next = cloneFrozen({ ...record, ...patch })
    this.#repository.putPipeline(next)
    this.#changed()
    return next
  }

  async #fail(
    record: PrivateSkillPipelineRecord,
    code: string,
    message: string,
  ): Promise<PrivateSkillIngestionJob> {
    return this.#replaceJob(record, {
      state: 'FAILED',
      failureCode: code,
      failureMessage: message.slice(0, 1_000),
    }).job
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      try { listener() } catch { /* cache/UI observers cannot veto durable state */ }
    }
  }
}

/** Deterministic, explicitly labelled fallback for offline/private deployments. */
export class HeuristicTacticalExtractor implements TacticalExtractor {
  readonly route = { mode: 'DETERMINISTIC_FALLBACK' as const }

  constructor(_legacyArtifacts?: MilitaryArtifacts) {}

  async extractChunk(input: Parameters<TacticalExtractor['extractChunk']>[0]): Promise<TacticalChunkExtraction> {
    input.signal.throwIfAborted()
    const sentences = input.content
      .split(/(?<=[。！？.!?])\s+|\n{2,}/u)
      .map(value => value.trim())
      .filter(value => value.length >= 20 && value.length <= 800)
      .slice(0, 12)
    return {
      ...(input.request.extractionGoal === undefined ? {} : { proposedTitle: input.request.extractionGoal }),
      claims: sentences.map(claim => ({ claim, confidence: 0.5 })),
      risks: ['Deterministic fallback did not establish causality.'],
      validationPlan: [
        'Run the procedure in an isolated simulation.',
        'Retain objective tool evidence before lifecycle promotion.',
      ],
    }
  }
}

class ArtifactBackedPrivateSkillBundleStore implements MilitaryPrivateSkillBundles {
  readonly #artifacts: MilitaryArtifacts
  readonly #tenantId: string
  constructor(artifacts: MilitaryArtifacts, tenantId = 'local') {
    this.#artifacts = artifacts
    this.#tenantId = tenantId
  }

  async write(input: Parameters<MilitaryPrivateSkillBundles['write']>[0]): Promise<PrivateSkillBundleSnapshot> {
    const files = await Promise.all(input.files.map(async file => ({
      path: file.path,
      artifact: await this.#artifacts.put({
        bytes: new TextEncoder().encode(file.content),
        mediaType: file.path.endsWith('.mjs') ? 'text/javascript' : 'text/markdown',
        classification: 'confidential',
        description: `${input.name}@${String(input.skill.version)} ${file.path}`,
        tenantId: this.#tenantId,
        ownerPrincipalId: 'military-private-skill-compiler',
        audiencePrincipalIds: ['military-host'],
        audienceScopes: ['artifact:read', 'military:private-skill-bundle'],
      }),
      executable: file.executable === true,
    })))
    const value = {
      schemaVersion: '1.0.0',
      skill: input.skill,
      name: input.name,
      description: input.description,
      lifecycle: input.lifecycle,
      rootPath: `military-private-skill://${input.name}/${String(input.skill.version)}`,
      files,
      contentHash: brand<string, 'Sha256'>(sha256(stableJson({
        skill: {
          skillId: String(input.skill.skillId),
          version: String(input.skill.version),
        },
        name: input.name,
        description: input.description,
        sourceSnapshotIds: [...input.sourceSnapshotIds],
        createdAt: String(input.createdAt),
        files: files.map(file => ({
          path: file.path,
          sha256: String(file.artifact.sha256),
          byteLength: file.artifact.byteLength,
          executable: file.executable,
        })),
      }))),
      sourceSnapshotIds: [...input.sourceSnapshotIds],
      createdAt: input.createdAt,
    } satisfies PrivateSkillBundleSnapshot
    return cloneFrozen(value)
  }
}
