import {
  MilitaryError,
  brand,
  type ArtifactRef,
  type KnowledgeRevocationOrder,
  type MilitaryArtifacts,
  type MilitaryKnowledgeSupplyChain,
  type TacticalSkillId,
  type TacticalSourceSnapshot,
} from '@dsh-military/contracts'
import { cloneFrozen, semver, stableJson, type InMemoryTacticalRegistry } from '@dsh-military/core'
import { InMemoryPrivateSkillRepository, type PrivateSkillRepository } from './private-skill-repository.js'

/**
 * Durable rights and revocation controller sharing the private Skill repository
 * with ingestion. Revocation atomically disables the source, quarantines every
 * named exact version and preserves the historical derivative graph.
 */
export class KnowledgeSupplyChainRuntime implements MilitaryKnowledgeSupplyChain {
  readonly #artifacts: MilitaryArtifacts
  readonly #repository: PrivateSkillRepository
  readonly #tactics: InMemoryTacticalRegistry | undefined
  readonly #tenantId: string

  constructor(
    artifacts: MilitaryArtifacts,
    options?: {
      readonly repository?: PrivateSkillRepository
      readonly tactics?: InMemoryTacticalRegistry
      readonly tenantId?: string
    },
  ) {
    this.#artifacts = artifacts
    this.#repository = options?.repository ?? new InMemoryPrivateSkillRepository()
    this.#tactics = options?.tactics
    this.#tenantId = options?.tenantId ?? 'local'
  }

  registerSource(snapshot: TacticalSourceSnapshot): void {
    const existing = this.#repository.knowledgeSource(snapshot.snapshotId)
    if (existing !== null && stableJson(existing) !== stableJson(snapshot)) {
      throw new MilitaryError('IDEMPOTENCY_CONFLICT')
    }
    this.#repository.putKnowledgeSource(cloneFrozen(snapshot))
  }

  async source(snapshotId: string): Promise<TacticalSourceSnapshot> {
    const value = this.#repository.knowledgeSource(snapshotId)
    if (value === null) throw new MilitaryError('NOT_FOUND')
    return value
  }

  async revoke(order: KnowledgeRevocationOrder): Promise<void> {
    await this.source(order.snapshotId)
    const existing = this.#repository.revocation(order.revocationOrderId)
    if (existing !== null) {
      if (stableJson(existing) !== stableJson(order)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    await this.#repository.transaction(() => {
      const source = this.#repository.source(brand<string, 'PrivateSkillSourceHandle'>(order.snapshotId))
      if (source !== null) {
        this.#repository.putSource({
          ...source,
          status: 'REVOKED',
          updatedAt: order.createdAt,
        })
      }
      for (const ref of order.affectedTacticVersions) {
        const parsed = parseTacticRef(ref)
        if (parsed === null || this.#tactics === undefined) continue
        const tactic = this.#tactics.get(parsed.skillId, parsed.version)
        if (tactic.lifecycle !== 'QUARANTINED' && tactic.lifecycle !== 'DEPRECATED') {
          this.#tactics.transition(parsed.skillId, parsed.version, 'QUARANTINED')
        }
        const bundle = this.#repository.bundle(String(parsed.skillId), String(parsed.version))
        if (bundle !== null) this.#repository.putBundle({ ...bundle, lifecycle: 'QUARANTINED' })
      }
      this.#repository.putRevocation(cloneFrozen(order))
    })
  }

  async assessImpact(revocationOrderId: string): Promise<ArtifactRef> {
    const order = this.#repository.revocation(revocationOrderId)
    if (order === null) throw new MilitaryError('NOT_FOUND')
    const affected = order.affectedTacticVersions.map((ref) => {
      const parsed = parseTacticRef(ref)
      if (parsed === null || this.#tactics === undefined) return { ref, lifecycle: 'UNKNOWN' }
      try {
        return { ref, lifecycle: this.#tactics.get(parsed.skillId, parsed.version).lifecycle }
      } catch {
        return { ref, lifecycle: 'MISSING' }
      }
    })
    const usages = this.#repository.listUsages().filter(usage => (
      order.affectedTacticVersions.includes(`${String(usage.skill.skillId)}@${String(usage.skill.version)}`)
    ))
    return await this.#artifacts.put({
      bytes: new TextEncoder().encode(JSON.stringify({
        schemaVersion: '1.0.0',
        revocationOrderId,
        snapshotId: order.snapshotId,
        affectedTacticVersions: affected,
        historicalUsageIds: usages.map(value => String(value.usageId)),
        requiredActions: order.requiredActions,
        newRecallBlocked: affected.every(value => value.lifecycle === 'QUARANTINED' || value.lifecycle === 'DEPRECATED' || value.lifecycle === 'MISSING'),
        disposition: 'REQUIRES_GOVERNANCE_EXECUTION',
      }, null, 2)),
      mediaType: 'application/json',
      classification: 'confidential',
      description: 'Derived private Skill revocation impact report',
      tenantId: this.#tenantId,
      ownerPrincipalId: order.requestedBy,
      audiencePrincipalIds: ['military-host', order.requestedBy],
      audienceScopes: ['artifact:read', 'military:private-skill-governance'],
    })
  }
}

function parseTacticRef(value: string): {
  readonly skillId: TacticalSkillId
  readonly version: ReturnType<typeof semver>
} | null {
  const split = value.lastIndexOf('@')
  if (split <= 0 || split === value.length - 1) return null
  return {
    skillId: brand<string, 'TacticalSkillId'>(value.slice(0, split)),
    version: semver(value.slice(split + 1)),
  }
}
