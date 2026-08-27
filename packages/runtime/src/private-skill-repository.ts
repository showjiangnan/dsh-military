import {
  MilitaryError,
  type PrivateSkillBundleSnapshot,
  type PrivateSkillChunkRecord,
  type PrivateSkillIngestionJob,
  type PrivateSkillPromotionReceipt,
  type PrivateSkillReviewReceipt,
  type PrivateSkillSourceHandle,
  type PrivateSkillSourceRecord,
  type PrivateSkillUsageRecord,
  type KnowledgeRevocationOrder,
  type TacticalSourceSnapshot,
  type TacticalExtractionCandidate,
  type TacticalExtractionCandidateId,
  type TacticalIngestionRequest,
  type TacticalIngestionRequestId,
  type TacticalIngestionSnapshot,
} from '@dsh-military/contracts'
import { cloneFrozen } from '@dsh-military/core'

/** One durable aggregate; every stage can be resumed from this exact record. */
export interface PrivateSkillPipelineRecord {
  readonly schemaVersion: '1.0.0'
  readonly request: TacticalIngestionRequest
  readonly job: PrivateSkillIngestionJob
  readonly returnedInstructions: readonly string[]
  readonly snapshot?: TacticalIngestionSnapshot
  readonly chunks: readonly PrivateSkillChunkRecord[]
  readonly candidate?: TacticalExtractionCandidate
}

export interface PrivateSkillRepository {
  source(handle: PrivateSkillSourceHandle): PrivateSkillSourceRecord | null
  putSource(value: PrivateSkillSourceRecord): void
  listSources(): readonly PrivateSkillSourceRecord[]
  pipeline(requestId: TacticalIngestionRequestId): PrivateSkillPipelineRecord | null
  putPipeline(value: PrivateSkillPipelineRecord): void
  listPipelines(): readonly PrivateSkillPipelineRecord[]
  requestIdForCandidate(candidateId: TacticalExtractionCandidateId): TacticalIngestionRequestId | null
  indexCandidate(candidateId: TacticalExtractionCandidateId, requestId: TacticalIngestionRequestId): void
  putReview(value: PrivateSkillReviewReceipt): void
  listReviews(): readonly PrivateSkillReviewReceipt[]
  putPromotion(value: PrivateSkillPromotionReceipt): void
  listPromotions(): readonly PrivateSkillPromotionReceipt[]
  putBundle(value: PrivateSkillBundleSnapshot): void
  bundle(skillId: string, version: string): PrivateSkillBundleSnapshot | null
  listBundles(): readonly PrivateSkillBundleSnapshot[]
  putUsage(value: PrivateSkillUsageRecord): void
  listUsages(): readonly PrivateSkillUsageRecord[]
  putKnowledgeSource(value: TacticalSourceSnapshot): void
  knowledgeSource(snapshotId: string): TacticalSourceSnapshot | null
  listKnowledgeSources(): readonly TacticalSourceSnapshot[]
  putRevocation(value: KnowledgeRevocationOrder): void
  revocation(revocationOrderId: string): KnowledgeRevocationOrder | null
  listRevocations(): readonly KnowledgeRevocationOrder[]
  transaction<T>(operation: () => T): Promise<T>
}

/** Deterministic repository for unit tests and non-SQLite embeddings. */
export class InMemoryPrivateSkillRepository implements PrivateSkillRepository {
  #sources = new Map<string, PrivateSkillSourceRecord>()
  #pipelines = new Map<string, PrivateSkillPipelineRecord>()
  #candidateIndex = new Map<string, TacticalIngestionRequestId>()
  #reviews = new Map<string, PrivateSkillReviewReceipt>()
  #promotions = new Map<string, PrivateSkillPromotionReceipt>()
  #bundles = new Map<string, PrivateSkillBundleSnapshot>()
  #usages = new Map<string, PrivateSkillUsageRecord>()
  #knowledgeSources = new Map<string, TacticalSourceSnapshot>()
  #revocations = new Map<string, KnowledgeRevocationOrder>()

  source(handle: PrivateSkillSourceHandle): PrivateSkillSourceRecord | null {
    return cloneOrNull(this.#sources.get(String(handle)))
  }

  putSource(value: PrivateSkillSourceRecord): void {
    this.#sources.set(String(value.sourceHandle), cloneFrozen(value))
  }

  listSources(): readonly PrivateSkillSourceRecord[] {
    return cloneFrozen([...this.#sources.values()])
  }

  pipeline(requestId: TacticalIngestionRequestId): PrivateSkillPipelineRecord | null {
    return cloneOrNull(this.#pipelines.get(String(requestId)))
  }

  putPipeline(value: PrivateSkillPipelineRecord): void {
    this.#pipelines.set(String(value.request.requestId), cloneFrozen(value))
  }

  listPipelines(): readonly PrivateSkillPipelineRecord[] {
    return cloneFrozen([...this.#pipelines.values()])
  }

  requestIdForCandidate(candidateId: TacticalExtractionCandidateId): TacticalIngestionRequestId | null {
    return this.#candidateIndex.get(String(candidateId)) ?? null
  }

  indexCandidate(candidateId: TacticalExtractionCandidateId, requestId: TacticalIngestionRequestId): void {
    const existing = this.#candidateIndex.get(String(candidateId))
    if (existing !== undefined && existing !== requestId) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
    this.#candidateIndex.set(String(candidateId), requestId)
  }

  putReview(value: PrivateSkillReviewReceipt): void {
    this.#reviews.set(String(value.receiptId), cloneFrozen(value))
  }

  listReviews(): readonly PrivateSkillReviewReceipt[] {
    return cloneFrozen([...this.#reviews.values()])
  }

  putPromotion(value: PrivateSkillPromotionReceipt): void {
    this.#promotions.set(String(value.receiptId), cloneFrozen(value))
  }

  listPromotions(): readonly PrivateSkillPromotionReceipt[] {
    return cloneFrozen([...this.#promotions.values()])
  }

  putBundle(value: PrivateSkillBundleSnapshot): void {
    this.#bundles.set(bundleKey(String(value.skill.skillId), String(value.skill.version)), cloneFrozen(value))
  }

  bundle(skillId: string, version: string): PrivateSkillBundleSnapshot | null {
    return cloneOrNull(this.#bundles.get(bundleKey(skillId, version)))
  }

  listBundles(): readonly PrivateSkillBundleSnapshot[] {
    return cloneFrozen([...this.#bundles.values()])
  }

  putUsage(value: PrivateSkillUsageRecord): void {
    this.#usages.set(String(value.usageId), cloneFrozen(value))
  }

  listUsages(): readonly PrivateSkillUsageRecord[] {
    return cloneFrozen([...this.#usages.values()])
  }

  putKnowledgeSource(value: TacticalSourceSnapshot): void {
    this.#knowledgeSources.set(value.snapshotId, cloneFrozen(value))
  }

  knowledgeSource(snapshotId: string): TacticalSourceSnapshot | null {
    return cloneOrNull(this.#knowledgeSources.get(snapshotId))
  }

  listKnowledgeSources(): readonly TacticalSourceSnapshot[] {
    return cloneFrozen([...this.#knowledgeSources.values()])
  }

  putRevocation(value: KnowledgeRevocationOrder): void {
    this.#revocations.set(value.revocationOrderId, cloneFrozen(value))
  }

  revocation(revocationOrderId: string): KnowledgeRevocationOrder | null {
    return cloneOrNull(this.#revocations.get(revocationOrderId))
  }

  listRevocations(): readonly KnowledgeRevocationOrder[] {
    return cloneFrozen([...this.#revocations.values()])
  }

  async transaction<T>(operation: () => T): Promise<T> {
    const snapshot = structuredClone({
      sources: this.#sources,
      pipelines: this.#pipelines,
      candidateIndex: this.#candidateIndex,
      reviews: this.#reviews,
      promotions: this.#promotions,
      bundles: this.#bundles,
      usages: this.#usages,
      knowledgeSources: this.#knowledgeSources,
      revocations: this.#revocations,
    })
    try {
      return operation()
    } catch (error) {
      this.#sources = snapshot.sources
      this.#pipelines = snapshot.pipelines
      this.#candidateIndex = snapshot.candidateIndex
      this.#reviews = snapshot.reviews
      this.#promotions = snapshot.promotions
      this.#bundles = snapshot.bundles
      this.#usages = snapshot.usages
      this.#knowledgeSources = snapshot.knowledgeSources
      this.#revocations = snapshot.revocations
      throw error
    }
  }
}

export function privateSkillBundleKey(skillId: string, version: string): string {
  return bundleKey(skillId, version)
}

function bundleKey(skillId: string, version: string): string {
  return `${skillId}@${version}`
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : cloneFrozen(value)
}
