import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MILITARY_KNOWLEDGE_CONTROL_SCHEMA_VERSION,
  MilitaryError,
  brand,
  type ArtifactRef,
  type MilitaryPrivateSkillPipelineTransparency,
  type MilitaryRecallSimulationResult,
  type PrivateSkillOperationSnapshot,
  type PrivateSkillSourceRecord,
  type TacticalTag,
} from '@dsh-military/contracts'
import { resolveTacticalRecall, sha256, stableJson } from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import { renderTacticApplicabilityCards } from './context-audit.js'

const ACTOR_ID = 'web-user'
const MAX_ACTION_BYTES = 17 * 1_024 * 1_024
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const RECALL_SIMULATION_NAMESPACE = 'military-private-skill-recall-simulation'
const MAX_TRANSPARENCY_CHUNKS = 80

export interface PrivateSkillRemotePolicy {
  readonly allowDeterministicFallback: boolean
  readonly defaultVisibility: 'user-private' | 'workspace-private' | 'organization-private'
  readonly defaultRetentionDays: number
}

/**
 * Trusted-Host RPC boundary for Knowledge Center mutations.
 *
 * Source text crosses the authenticated RC.2 Typert channel exactly once and
 * is handed directly to the isolated Raw Vault. It never enters the shared
 * Settings document, browser-readable projections, logs, or action receipts.
 */
export class PrivateSkillRemoteService extends TypertRemoteService {
  private readonly state: SqliteStateRecords
  private policy: PrivateSkillRemotePolicy = {
    allowDeterministicFallback: false,
    defaultVisibility: 'user-private',
    defaultRetentionDays: 365,
  }

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryPrivateSkills')
    this.state = new SqliteStateRecords(host.database, host.tenantId)
  }

  configure(policy: PrivateSkillRemotePolicy): void {
    if (!Number.isSafeInteger(policy.defaultRetentionDays)
      || policy.defaultRetentionDays < 1
      || policy.defaultRetentionDays > 3_650) {
      throw new TypeError('private Skill retention must be an integer between 1 and 3650 days')
    }
    this.policy = Object.freeze({ ...policy })
  }

  /**
   * Execute one shallow, user-initiated Knowledge Center operation.
   * The caller never supplies an actor or Host-owned authority field.
   */
  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const value = privateSkillAction(action)
    const type = requireString(value, 'type', 'private Skill action')
    const operationId = privateSkillOperationId(value.operationId)
    const result = await this.executeAction(type, operationId, value, signal)
    return {
      schemaVersion: '1.0.0',
      operationId,
      type,
      completed: true,
      result,
    }
  }

  /**
   * Read the redacted operation projection. Raw Vault locators and imported
   * bytes are never part of this response; review content is sanitized output.
   */
  @Remote
  async snapshot(signal: AbortSignal): Promise<{
    readonly operation: PrivateSkillOperationSnapshot & {
      readonly candidates: readonly (PrivateSkillOperationSnapshot['candidates'][number] & {
        readonly reviewHash: string
        readonly diffHash: string
        readonly diffText: string
      })[]
    }
    readonly tags: readonly TacticalTag[]
    readonly transparency: readonly MilitaryPrivateSkillPipelineTransparency[]
    readonly recallSimulations: readonly MilitaryRecallSimulationResult[]
  }> {
    signal.throwIfAborted()
    const operation = await this.host.application.ingestion.operationSnapshot()
    const candidates = await Promise.all(operation.candidates.map(async candidate => {
      signal.throwIfAborted()
      return {
        ...candidate,
        reviewHash: sha256(stableJson(candidate)),
        diffHash: String(candidate.diffArtifact?.sha256 ?? candidate.proposedContent.sha256),
        diffText: candidate.diffArtifact === undefined
          ? ''
          : new TextDecoder().decode(
            await this.host.application.artifacts.get(candidate.diffArtifact.artifactId),
          ),
      }
    }))
    signal.throwIfAborted()
    return {
      operation: { ...operation, candidates },
      tags: await this.host.application.tags.list(),
      transparency: await this.transparency(operation, signal),
      recallSimulations: [...this.state.listSync<MilitaryRecallSimulationResult>(
        RECALL_SIMULATION_NAMESPACE,
      )].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 40),
    }
  }

  private async executeAction(
    type: string,
    operationId: string,
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (type === 'SIMULATE_RECALL') {
      return await this.simulateRecall(operationId, action, signal)
    }
    const requestedVisibility = privateSkillVisibility(
      action.visibility,
      this.policy.defaultVisibility,
    )
    const license = privateSkillLicense(action.license)
    const visibility = license === 'UNKNOWN' ? 'user-private' : requestedVisibility
    const retentionDays = boundedNumber(
      action.retentionDays,
      this.policy.defaultRetentionDays,
      1,
      3_650,
    )
    const retentionAnchor = operationTime(operationId)
    const validUntil = brand<string, 'IsoDateTime'>(
      new Date(retentionAnchor + retentionDays * 86_400_000).toISOString(),
    )
    const rights = {
      ownerId: ACTOR_ID,
      license,
      allowedUse: [visibilityAllowedUse(visibility)],
      allowedAudience: [...new Set([ACTOR_ID, visibilityAudience(visibility)])],
      derivativeWorkAllowed: true,
      externalModelProcessingAllowed: action.externalModelProcessingAllowed === true,
      retentionPolicyRef: `retain-${retentionDays}-days`,
      revocationPolicyRef: 'immediate-quarantine',
      validUntil,
      dependencyVersions: [...new Set(optionalStringArray(action.dependencyVersions, 32))],
    }

    switch (type) {
      case 'CREATE_DIRECT_SOURCE': {
        const source = await this.host.application.ingestion.createSource({
          requestedBy: ACTOR_ID,
          source: {
            kind: 'DIRECT_TEXT',
            title: requireString(action, 'title', type),
            content: requireString(action, 'content', type),
            classification: privateSkillClassification(action.classification),
            visibility,
            rights,
          },
        })
        return sourceActionResult(source)
      }
      case 'CREATE_SESSION_SOURCE': {
        const startSeq = optionalInteger(action.startSeq)
        const endSeq = optionalInteger(action.endSeq)
        if (
          (action.startSeq !== undefined && startSeq === undefined)
          || (action.endSeq !== undefined && endSeq === undefined)
          || (startSeq !== undefined && endSeq !== undefined && startSeq > endSeq)
        ) {
          throw new TypeError('session event range requires non-negative integers with startSeq <= endSeq')
        }
        const source = await this.host.application.ingestion.createSource({
          requestedBy: ACTOR_ID,
          source: {
            kind: 'SESSION_RANGE',
            title: requireString(action, 'title', type),
            sessionId: brand<string, 'SessionId'>(requireString(action, 'sessionId', type)),
            ...(startSeq === undefined ? {} : { startSeq }),
            ...(endSeq === undefined ? {} : { endSeq }),
            includeToolResults: action.includeToolResults === true,
            classification: privateSkillClassification(action.classification),
            visibility,
            rights,
          },
        })
        return sourceActionResult(source)
      }
      case 'CREATE_ARTIFACT_SOURCE': {
        const artifactId = brand<string, 'ArtifactId'>(requireString(action, 'artifactId', type))
        const bytes = await this.host.application.artifacts.get(artifactId)
        const classification = privateSkillClassification(action.classification)
        const source = await this.host.application.ingestion.createSource({
          requestedBy: ACTOR_ID,
          source: {
            kind: 'ARTIFACT',
            title: requireString(action, 'title', type),
            artifact: {
              artifactId,
              sha256: brand<string, 'Sha256'>(sha256(bytes)),
              mediaType: typeof action.mediaType === 'string' && action.mediaType.trim() !== ''
                ? action.mediaType.trim()
                : 'text/plain',
              byteLength: bytes.byteLength,
              classification,
            },
            classification,
            visibility,
            rights,
          },
        })
        return sourceActionResult(source)
      }
      case 'START_EXTRACTION': {
        const job = await this.host.application.ingestion.startExtraction({
          requestedBy: ACTOR_ID,
          value: {
            sourceHandle: brand<string, 'PrivateSkillSourceHandle'>(
              requireString(action, 'sourceHandle', type),
            ),
            extractionGoal: requireString(action, 'goal', type),
            primaryTagId: brand<string, 'TacticalTagId'>(
              requireString(action, 'primaryTagId', type),
            ),
            additionalTagIds: optionalStringArray(action.additionalTagIds, 8)
              .map(value => brand<string, 'TacticalTagId'>(value)),
            allowDeterministicFallback: this.policy.allowDeterministicFallback,
            ...(typeof action.targetSkillId !== 'string' || typeof action.targetVersion !== 'string'
              ? {}
              : {
                targetSkill: {
                  skillId: brand<string, 'TacticalSkillId'>(action.targetSkillId),
                  version: brand<string, 'SemVer'>(action.targetVersion),
                },
              }),
          },
        })
        const processed = await this.host.application.ingestion.process(job.requestId, signal)
        return jobActionResult(processed)
      }
      case 'PROCESS_JOB': {
        const job = await this.host.application.ingestion.process(
          brand<string, 'TacticalIngestionRequestId'>(requireString(action, 'requestId', type)),
          signal,
        )
        return jobActionResult(job)
      }
      case 'ACKNOWLEDGE_INJECTION': {
        const job = await this.host.application.ingestion.acknowledgeInjection({
          requestId: brand<string, 'TacticalIngestionRequestId'>(
            requireString(action, 'requestId', type),
          ),
          actor: { kind: 'USER', id: ACTOR_ID },
        })
        return jobActionResult(job)
      }
      case 'EDIT_CANDIDATE': {
        const candidate = await this.host.application.ingestion.editCandidate({
          candidateId: brand<string, 'TacticalExtractionCandidateId'>(
            requireString(action, 'candidateId', type),
          ),
          expectedCandidateHash: requireString(action, 'candidateHash', type),
          actor: { kind: 'USER', id: ACTOR_ID },
          title: requireString(action, 'title', type),
          claims: optionalStringArray(action.claims, 24),
          risks: optionalStringArray(action.risks, 20),
          validationPlan: optionalStringArray(action.validationPlan, 20),
        })
        return { candidateId: String(candidate.candidateId), status: candidate.status }
      }
      case 'REVIEW_CANDIDATE': {
        const reviewAction = requireString(action, 'action', type)
        if (!['APPROVE_AS_DRAFT', 'RETURN', 'REJECT'].includes(reviewAction)) {
          throw new TypeError(`unknown private Skill review action ${reviewAction}`)
        }
        const review = await this.host.application.ingestion.reviewCandidate({
          candidateId: brand<string, 'TacticalExtractionCandidateId'>(
            requireString(action, 'candidateId', type),
          ),
          expectedCandidateHash: requireString(action, 'candidateHash', type),
          expectedDiffHash: requireString(action, 'diffHash', type),
          action: reviewAction as 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT',
          actor: { kind: 'USER', id: ACTOR_ID },
          ...(typeof action.instructions !== 'string' || action.instructions.trim() === ''
            ? {}
            : { instructions: action.instructions.trim() }),
        })
        return {
          reviewId: String(review.receiptId),
          candidateId: String(review.candidateId),
          action: review.action,
        }
      }
      case 'PROMOTE_SKILL': {
        const promotion = await this.host.application.ingestion.promote({
          skillId: requireString(action, 'skillId', type),
          version: brand<string, 'SemVer'>(requireString(action, 'version', type)),
          to: privateSkillLifecycle(action.to),
          requestedBy: ACTOR_ID,
          reason: requireString(action, 'reason', type),
          evidenceRefs: optionalStringArray(action.evidenceRefs, 32),
        })
        return {
          receiptId: String(promotion.receiptId),
          skillId: String(promotion.skill.skillId),
          version: String(promotion.skill.version),
          from: promotion.from,
          to: promotion.to,
        }
      }
      case 'REVOKE_SOURCE': {
        const sourceHandle = brand<string, 'PrivateSkillSourceHandle'>(
          requireString(action, 'sourceHandle', type),
        )
        const reason = privateSkillRevocationReason(action.reason)
        const revoked = await this.host.application.ingestion.revokeSource({
          sourceHandle,
          requestedBy: ACTOR_ID,
          reason,
        })
        const revokedSource = await this.host.application.ingestion.source(sourceHandle)
        const revocationOrderId = `private-revocation-${sha256(`${String(sourceHandle)}\n${reason}`).slice(0, 32)}`
        const order = {
          schemaVersion: '1.0.0' as const,
          revocationOrderId,
          snapshotId: String(sourceHandle),
          reason,
          requestedBy: ACTOR_ID,
          authorizedBy: ACTOR_ID,
          authorizationReceiptRef: `private-skill-revocation:${revocationOrderId}`,
          affectedTacticVersions: revoked.affectedTacticVersions,
          requiredActions: [
            'QUARANTINE_TACTIC',
            'REVERIFY_TASKS',
            'DELETE_DERIVATIVES',
            'NOTIFY_USERS',
          ] as const,
          createdAt: revokedSource.updatedAt,
        }
        try {
          await this.host.application.knowledge.revoke(order)
          const impact = await this.host.application.knowledge.assessImpact(order.revocationOrderId)
          return {
            revocationOrderId: order.revocationOrderId,
            disposition: 'REVOKED',
            affectedTacticVersions: order.affectedTacticVersions,
            impactArtifact: artifactActionResult(impact),
          }
        } catch (error) {
          if (!isNotFound(error)) throw error
          return {
            revocationOrderId: order.revocationOrderId,
            disposition: 'REVOKED_BEFORE_SNAPSHOT',
            affectedTacticVersions: order.affectedTacticVersions,
          }
        }
      }
      case 'ASSESS_REVOCATION': {
        const impact = await this.host.application.knowledge.assessImpact(
          requireString(action, 'revocationOrderId', type),
        )
        return {
          revocationOrderId: requireString(action, 'revocationOrderId', type),
          impactArtifact: artifactActionResult(impact),
        }
      }
      default:
        throw new TypeError(`unknown private Skill action ${type}`)
    }
  }

  private async simulateRecall(
    simulationId: string,
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<MilitaryRecallSimulationResult> {
    const existing = this.state.readSync<MilitaryRecallSimulationResult>(
      RECALL_SIMULATION_NAMESPACE,
      simulationId,
    )
    if (existing !== null) return existing
    const taskText = requireString(action, 'taskText', 'SIMULATE_RECALL')
    if (taskText.length > 20_000) {
      throw new TypeError('SIMULATE_RECALL.taskText 不能超过 20000 字符')
    }
    const stateTokenBudget = boundedInteger(
      action.stateTokenBudget,
      4_096,
      512,
      100_000,
      'SIMULATE_RECALL.stateTokenBudget',
    )
    const settings = this.host.featureSettings()
    const maximumCandidates = settings.tactics.candidateRecallMaximum
    const maximumTagMatches = Math.min(5, maximumCandidates)
    const resolution = await resolveTacticalRecall({
      text: taskText,
      tags: await this.host.application.tags.list({ status: 'ACTIVE' }),
      registry: this.host.tactics,
      includeTesting: settings.tactics.allowCanaryDelivery,
      maximumTagMatches,
      maximumCandidates,
      eligibility: async (skillId, version) =>
        await this.host.application.ingestion.deliveryEligibility(skillId, version),
    })
    signal.throwIfAborted()
    const selectedProcedures = resolution.selected.map(value => value.procedure)
    const result: MilitaryRecallSimulationResult = {
      schemaVersion: MILITARY_KNOWLEDGE_CONTROL_SCHEMA_VERSION,
      simulationId,
      textHash: sha256(taskText),
      inputCharacters: taskText.length,
      stateTokenBudget,
      matchedTagIds: resolution.matchedTagIds.map(String),
      selected: resolution.selected.map(value => ({
        exactSkill: `${String(value.procedure.skillId)}@${String(value.procedure.version)}`,
        title: value.procedure.title,
        lifecycle: value.procedure.lifecycle,
        rank: value.rank!,
        matchedTagIds: value.matchedTagIds,
        reasons: value.reasons,
      })),
      excluded: resolution.excluded.map(value => ({
        exactSkill: `${String(value.procedure.skillId)}@${String(value.procedure.version)}`,
        title: value.procedure.title,
        lifecycle: value.procedure.lifecycle,
        matchedTagIds: value.matchedTagIds,
        reasons: value.reasons,
      })),
      deliveryBlocks: renderTacticApplicabilityCards(
        selectedProcedures,
        stateTokenBudget,
      ),
      policy: {
        tenantIsolation: 'CURRENT_HOST_TENANT',
        includeTesting: settings.tactics.allowCanaryDelivery,
        maximumTagMatches,
        maximumCandidates,
        sourceRightsChecked: true,
        createsTask: false,
      },
      createdAt: new Date().toISOString(),
    }
    this.state.putSync(RECALL_SIMULATION_NAMESPACE, simulationId, result, {
      createOnly: true,
    })
    return result
  }

  private async transparency(
    operation: PrivateSkillOperationSnapshot,
    signal: AbortSignal,
  ): Promise<readonly MilitaryPrivateSkillPipelineTransparency[]> {
    const result: MilitaryPrivateSkillPipelineTransparency[] = []
    for (const pipeline of operation.pipelines) {
      signal.throwIfAborted()
      const candidateId = pipeline.candidateId === undefined
        ? undefined
        : String(pipeline.candidateId)
      const reviews = candidateId === undefined
        ? []
        : operation.reviews.filter(value => String(value.candidateId) === candidateId)
      const sourceHandle = String(pipeline.sourceHandle)
      const bundles = operation.bundles.filter(value =>
        value.sourceSnapshotIds.includes(sourceHandle)
        || reviews.some(review =>
          review.committedSkill !== undefined
          && review.committedSkill.skillId === value.skill.skillId
          && review.committedSkill.version === value.skill.version))
      const exactSkills = bundles.map(value =>
        `${String(value.skill.skillId)}@${String(value.skill.version)}`)
      const chunks = pipeline.chunks.slice(0, MAX_TRANSPARENCY_CHUNKS)
      result.push({
        requestId: String(pipeline.requestId),
        sourceHandle,
        ...(pipeline.snapshot === undefined
          ? {}
          : {
              snapshot: {
                contentHash: pipeline.snapshot.contentHash,
                sanitized: await this.artifactPreview(
                  pipeline.snapshot.sourceArtifact,
                  8_000,
                ),
                redactionReceipt: await this.artifactPreview(
                  pipeline.snapshot.redactionReceipt,
                  4_000,
                ),
              },
            }),
        chunks: await Promise.all(chunks.map(async chunk => ({
          chunkId: chunk.chunkId,
          ordinal: chunk.ordinal,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          contentHash: String(chunk.contentHash),
          extractionState: chunk.extractionState,
          attempts: chunk.attempts,
          ...(chunk.extractorRoute === undefined
            ? {}
            : { extractorRoute: chunk.extractorRoute }),
          sanitized: await this.artifactPreview(chunk.artifact, 3_000),
          ...(chunk.extractionArtifact === undefined
            ? {}
            : {
                extraction: await this.artifactPreview(
                  chunk.extractionArtifact,
                  3_000,
                ),
              }),
          ...(chunk.lastError === undefined
            ? {}
            : { lastError: boundedDisplayText(chunk.lastError, 500) }),
        }))),
        truncatedChunkCount: Math.max(0, pipeline.chunks.length - chunks.length),
        lineage: {
          ...(candidateId === undefined ? {} : { candidateId }),
          reviewReceiptIds: reviews.map(value => String(value.receiptId)),
          skillVersions: exactSkills,
          promotionReceiptIds: operation.promotions.filter(value =>
            exactSkills.includes(`${String(value.skill.skillId)}@${String(value.skill.version)}`))
            .map(value => String(value.receiptId)),
          usageIds: operation.usages.filter(value =>
            exactSkills.includes(`${String(value.skill.skillId)}@${String(value.skill.version)}`))
            .map(value => String(value.usageId)),
          revocationOrderIds: operation.revocations.filter(value =>
            value.snapshotId === sourceHandle
            || value.affectedTacticVersions.some(exact => exactSkills.includes(exact)))
            .map(value => value.revocationOrderId),
          inheritedSourceHandles: [...new Set(bundles.flatMap(value =>
            value.sourceSnapshotIds.filter(handle => handle !== sourceHandle)))],
        },
        returnedInstructions: pipeline.returnedInstructions.map(value =>
          boundedDisplayText(value, 1_000)),
      })
    }
    return result
  }

  private async artifactPreview(
    artifact: ArtifactRef,
    maximumCharacters: number,
  ): Promise<MilitaryPrivateSkillPipelineTransparency['chunks'][number]['sanitized']> {
    const bytes = await this.host.application.artifacts.get(artifact.artifactId)
    const decoded = new TextDecoder().decode(bytes)
    const content = boundedDisplayText(decoded, maximumCharacters)
    return {
      sha256: String(artifact.sha256),
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      verified: sha256(bytes) === String(artifact.sha256),
      text: content,
      truncated: content.length < decoded.length,
    }
  }
}

function privateSkillAction(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('private Skill action must be one JSON object')
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('private Skill action must be a plain JSON object')
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_ACTION_BYTES) {
    throw new TypeError('private Skill action exceeds the 17 MiB RPC boundary')
  }
  return value as Record<string, unknown>
}

function privateSkillOperationId(value: unknown): string {
  if (value === undefined) return randomUUID()
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) {
    throw new TypeError('private Skill operationId must be 1-128 safe identifier characters')
  }
  return value
}

function operationTime(operationId: string): number {
  const match = /^web-([0-9a-z]+)-/u.exec(operationId)
  if (match === null) return Date.now()
  const milliseconds = Number.parseInt(match[1]!, 36)
  // A future timestamp could lengthen rights. Only accept browser clocks up to
  // five minutes ahead; historical timestamps remain valid for exact retries.
  if (
    !Number.isSafeInteger(milliseconds)
    || milliseconds < Date.parse('2020-01-01T00:00:00.000Z')
    || milliseconds > Date.now() + 5 * 60_000
  ) return Date.now()
  return milliseconds
}

function sourceActionResult(source: PrivateSkillSourceRecord): {
  readonly sourceHandle: string
  readonly title: string
  readonly status: string
  readonly sourceHash: string
} {
  return {
    sourceHandle: String(source.sourceHandle),
    title: source.title,
    status: source.status,
    sourceHash: String(source.sourceHash),
  }
}

function jobActionResult(job: {
  readonly requestId: unknown
  readonly state: string
  readonly candidateId?: unknown
  readonly completedChunkCount: number
  readonly chunkCount: number
}): {
  readonly requestId: string
  readonly state: string
  readonly candidateIds: readonly string[]
  readonly completedChunks: number
  readonly totalChunks: number
} {
  return {
    requestId: String(job.requestId),
    state: job.state,
    candidateIds: job.candidateId === undefined ? [] : [String(job.candidateId)],
    completedChunks: job.completedChunkCount,
    totalChunks: job.chunkCount,
  }
}

function artifactActionResult(artifact: {
  readonly artifactId: unknown
  readonly sha256: unknown
  readonly mediaType: string
  readonly byteLength: number
}): {
  readonly artifactId: string
  readonly sha256: string
  readonly mediaType: string
  readonly byteLength: number
} {
  return {
    artifactId: String(artifact.artifactId),
    sha256: String(artifact.sha256),
    mediaType: artifact.mediaType,
    byteLength: artifact.byteLength,
  }
}

function privateSkillClassification(value: unknown): 'public' | 'internal' | 'confidential' | 'restricted' {
  return value === 'public' || value === 'internal' || value === 'restricted'
    ? value
    : 'confidential'
}

function privateSkillVisibility(
  value: unknown,
  fallback: PrivateSkillRemotePolicy['defaultVisibility'],
): PrivateSkillRemotePolicy['defaultVisibility'] {
  return value === 'user-private' || value === 'workspace-private' || value === 'organization-private'
    ? value
    : fallback
}

function privateSkillLicense(value: unknown): 'USER_OWNED' | 'ENTERPRISE_INTERNAL' | 'LICENSED' | 'UNKNOWN' {
  return value === 'USER_OWNED' || value === 'ENTERPRISE_INTERNAL' || value === 'LICENSED'
    ? value
    : 'UNKNOWN'
}

function visibilityAllowedUse(
  visibility: PrivateSkillRemotePolicy['defaultVisibility'],
): 'PRIVATE_TACTIC' | 'WORKSPACE_TACTIC' | 'ORGANIZATION_TACTIC' {
  switch (visibility) {
    case 'user-private': return 'PRIVATE_TACTIC'
    case 'workspace-private': return 'WORKSPACE_TACTIC'
    case 'organization-private': return 'ORGANIZATION_TACTIC'
  }
}

function visibilityAudience(
  visibility: PrivateSkillRemotePolicy['defaultVisibility'],
): string {
  switch (visibility) {
    case 'user-private': return ACTOR_ID
    case 'workspace-private': return 'workspace:local-profile'
    case 'organization-private': return 'organization:local-profile'
  }
}

function privateSkillLifecycle(value: unknown): 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | 'QUARANTINED' | 'DEPRECATED' {
  if (
    value === 'DRAFT'
    || value === 'SIMULATION'
    || value === 'CANARY'
    || value === 'TESTING'
    || value === 'STABLE'
    || value === 'QUARANTINED'
    || value === 'DEPRECATED'
  ) return value
  throw new TypeError(`invalid private Skill lifecycle ${String(value)}`)
}

function privateSkillRevocationReason(value: unknown): 'OWNER_REQUEST' | 'LICENSE_CHANGE' | 'SECURITY_INCIDENT' | 'PROVEN_INCORRECT' | 'RETENTION_EXPIRY' {
  if (
    value === 'OWNER_REQUEST'
    || value === 'LICENSE_CHANGE'
    || value === 'SECURITY_INCIDENT'
    || value === 'PROVEN_INCORRECT'
    || value === 'RETENTION_EXPIRY'
  ) return value
  return 'OWNER_REQUEST'
}

function optionalStringArray(value: unknown, maximum: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`expected at most ${maximum} text items`)
  }
  return value.map(item => (item as string).trim()).filter(Boolean)
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  at: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${at} must be an integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}

function boundedDisplayText(value: string, maximum: number): string {
  const safe = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,
    '�',
  )
  return safe.length <= maximum
    ? safe
    : `${safe.slice(0, Math.max(0, maximum - 18))}\n＜Host 已截断＞`
}

function requireString(value: Record<string, unknown>, key: string, at: string): string {
  const candidate = value[key]
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new TypeError(`${at}.${key} must be a non-empty string`)
  }
  return candidate
}

function isNotFound(error: unknown): boolean {
  return error instanceof MilitaryError && error.failure.code === 'NOT_FOUND'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryPrivateSkills: PrivateSkillRemoteService
  }
}
