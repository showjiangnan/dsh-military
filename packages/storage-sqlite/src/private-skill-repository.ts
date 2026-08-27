import {
  MilitaryError,
  type KnowledgeRevocationOrder,
  type PrivateSkillBundleSnapshot,
  type PrivateSkillPromotionReceipt,
  type PrivateSkillReviewReceipt,
  type PrivateSkillSourceHandle,
  type PrivateSkillSourceRecord,
  type PrivateSkillUsageRecord,
  type TacticalExtractionCandidateId,
  type TacticalIngestionRequestId,
  type TacticalSourceSnapshot,
} from '@dsh-military/contracts'
import { stableJson } from '@dsh-military/core'
import type { PrivateSkillPipelineRecord, PrivateSkillRepository } from '@dsh-military/runtime'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

const SOURCE_NS = 'private-skill-source'
const PIPELINE_NS = 'private-skill-pipeline'
const CANDIDATE_INDEX_NS = 'private-skill-candidate-index'
const REVIEW_NS = 'private-skill-review'
const PROMOTION_NS = 'private-skill-promotion'
const BUNDLE_NS = 'private-skill-bundle'
const USAGE_NS = 'private-skill-usage'
const KNOWLEDGE_SOURCE_NS = 'private-skill-knowledge-source'
const REVOCATION_NS = 'private-skill-revocation'

/** SQLite-backed aggregate repository for the complete private Skill supply chain. */
export class SqlitePrivateSkillRepository implements PrivateSkillRepository {
  readonly #database: SqliteMilitaryDatabase
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  source(handle: PrivateSkillSourceHandle): PrivateSkillSourceRecord | null {
    return this.#records.readSync<PrivateSkillSourceRecord>(SOURCE_NS, String(handle))
  }

  putSource(value: PrivateSkillSourceRecord): void {
    this.#records.putSync(SOURCE_NS, String(value.sourceHandle), value)
  }

  listSources(): readonly PrivateSkillSourceRecord[] {
    return this.#records.listSync<PrivateSkillSourceRecord>(SOURCE_NS)
  }

  pipeline(requestId: TacticalIngestionRequestId): PrivateSkillPipelineRecord | null {
    return this.#records.readSync<PrivateSkillPipelineRecord>(PIPELINE_NS, String(requestId))
  }

  putPipeline(value: PrivateSkillPipelineRecord): void {
    this.#records.putSync(PIPELINE_NS, String(value.request.requestId), value)
  }

  listPipelines(): readonly PrivateSkillPipelineRecord[] {
    return this.#records.listSync<PrivateSkillPipelineRecord>(PIPELINE_NS)
  }

  requestIdForCandidate(candidateId: TacticalExtractionCandidateId): TacticalIngestionRequestId | null {
    return this.#records.readSync<TacticalIngestionRequestId>(CANDIDATE_INDEX_NS, String(candidateId))
  }

  indexCandidate(candidateId: TacticalExtractionCandidateId, requestId: TacticalIngestionRequestId): void {
    const existing = this.requestIdForCandidate(candidateId)
    if (existing !== null && stableJson(existing) !== stableJson(requestId)) {
      throw new MilitaryError('IDEMPOTENCY_CONFLICT', `candidate ${String(candidateId)} already has another request`)
    }
    this.#records.putSync(CANDIDATE_INDEX_NS, String(candidateId), requestId, { createOnly: true })
  }

  putReview(value: PrivateSkillReviewReceipt): void {
    this.#records.putSync(REVIEW_NS, String(value.receiptId), value, { createOnly: true })
  }

  listReviews(): readonly PrivateSkillReviewReceipt[] {
    return this.#records.listSync<PrivateSkillReviewReceipt>(REVIEW_NS)
  }

  putPromotion(value: PrivateSkillPromotionReceipt): void {
    this.#records.putSync(PROMOTION_NS, String(value.receiptId), value, { createOnly: true })
  }

  listPromotions(): readonly PrivateSkillPromotionReceipt[] {
    return this.#records.listSync<PrivateSkillPromotionReceipt>(PROMOTION_NS)
  }

  putBundle(value: PrivateSkillBundleSnapshot): void {
    this.#records.putSync(BUNDLE_NS, key(String(value.skill.skillId), String(value.skill.version)), value)
  }

  bundle(skillId: string, version: string): PrivateSkillBundleSnapshot | null {
    return this.#records.readSync<PrivateSkillBundleSnapshot>(BUNDLE_NS, key(skillId, version))
  }

  listBundles(): readonly PrivateSkillBundleSnapshot[] {
    return this.#records.listSync<PrivateSkillBundleSnapshot>(BUNDLE_NS)
  }

  putUsage(value: PrivateSkillUsageRecord): void {
    this.#records.putSync(USAGE_NS, String(value.usageId), value, { createOnly: true })
  }

  listUsages(): readonly PrivateSkillUsageRecord[] {
    return this.#records.listSync<PrivateSkillUsageRecord>(USAGE_NS)
  }

  putKnowledgeSource(value: TacticalSourceSnapshot): void {
    this.#records.putSync(KNOWLEDGE_SOURCE_NS, value.snapshotId, value)
  }

  knowledgeSource(snapshotId: string): TacticalSourceSnapshot | null {
    return this.#records.readSync<TacticalSourceSnapshot>(KNOWLEDGE_SOURCE_NS, snapshotId)
  }

  listKnowledgeSources(): readonly TacticalSourceSnapshot[] {
    return this.#records.listSync<TacticalSourceSnapshot>(KNOWLEDGE_SOURCE_NS)
  }

  putRevocation(value: KnowledgeRevocationOrder): void {
    this.#records.putSync(REVOCATION_NS, value.revocationOrderId, value, { createOnly: true })
  }

  revocation(revocationOrderId: string): KnowledgeRevocationOrder | null {
    return this.#records.readSync<KnowledgeRevocationOrder>(REVOCATION_NS, revocationOrderId)
  }

  listRevocations(): readonly KnowledgeRevocationOrder[] {
    return this.#records.listSync<KnowledgeRevocationOrder>(REVOCATION_NS)
  }

  async transaction<T>(operation: () => T): Promise<T> {
    return this.#database.transaction(operation)
  }
}

function key(skillId: string, version: string): string {
  return `${skillId}@${version}`
}
