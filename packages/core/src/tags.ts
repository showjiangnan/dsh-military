import {
  MilitaryError,
  type MilitaryTags,
  type Revision,
  type SemVer,
  type TacticalTag,
  type TacticalTagId,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, type Clock } from './util.js'
import type { TacticalProcedure } from './tactics.js'

export class InMemoryTacticalTagRegistry implements MilitaryTags {
  readonly #tags = new Map<string, TacticalTag>()
  readonly #clock: Clock

  constructor(clock?: Clock) { this.#clock = clock ?? (() => new Date()) }

  async list(options?: { readonly status?: 'ACTIVE' | 'PAUSED' | 'DELETED' }): Promise<readonly TacticalTag[]> {
    return cloneFrozen([...this.#tags.values()]
      .filter(tag => options?.status === undefined || tag.status === options.status)
      .sort((left, right) => left.displayName.localeCompare(right.displayName)))
  }

  async get(tagId: TacticalTagId): Promise<TacticalTag> {
    const tag = this.#tags.get(String(tagId))
    if (tag === undefined) throw new MilitaryError('NOT_FOUND', `unknown tag ${String(tagId)}`)
    return cloneFrozen(tag)
  }

  async create(tag: TacticalTag): Promise<void> {
    if (this.#tags.has(String(tag.tagId))) throw new MilitaryError('REVISION_CONFLICT')
    if (tag.status === 'DELETED') throw new MilitaryError('INVALID_ARGUMENT', 'cannot create a deleted tag')
    this.#tags.set(String(tag.tagId), cloneFrozen(tag))
  }

  async rename(tagId: TacticalTagId, displayName: string, expectedRevision: Revision): Promise<TacticalTag> {
    if (displayName.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    return this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      displayName,
      renamedFrom: tag.displayName,
      updatedAt: now(this.#clock),
    }))
  }

  async pause(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return this.#mutate(tagId, expectedRevision, tag => ({ ...tag, status: 'PAUSED', updatedAt: now(this.#clock) }))
  }

  async resume(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return this.#mutate(tagId, expectedRevision, tag => {
      if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
      return { ...tag, status: 'ACTIVE', updatedAt: now(this.#clock) }
    })
  }

  async delete(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      status: 'DELETED',
      updatedAt: now(this.#clock),
      deletedAt: now(this.#clock),
    }))
  }

  match(text: string): readonly TacticalTagId[] {
    return matchTacticalTags(text, [...this.#tags.values()])
  }

  async #mutate(
    tagId: TacticalTagId,
    expectedRevision: Revision,
    mutate: (tag: TacticalTag) => TacticalTag,
  ): Promise<TacticalTag> {
    const tag = await this.get(tagId)
    if (Number(tag.revision) !== Number(expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
    if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
    const body = mutate(tag)
    const { revision: _discardedRevision, ...withoutRevision } = body
    const next = cloneFrozen({ ...withoutRevision, revision: brand<number, 'Revision'>(Number(expectedRevision) + 1) } as TacticalTag)
    this.#tags.set(String(tagId), next)
    return next
  }
}

/** Host-side deterministic matcher shared by in-memory and durable Task recall. */
export function matchTacticalTags(
  text: string,
  tags: readonly TacticalTag[],
  maximum = 5,
): readonly TacticalTagId[] {
  const normalized = text.toLocaleLowerCase()
  return cloneFrozen(tags
    .filter(tag => tag.status === 'ACTIVE')
    .map(tag => ({
      tag,
      matches: [tag.displayName, ...tag.aliases, ...tag.matchTerms]
        .filter(term => term.trim().length > 0)
        .filter(term => normalized.includes(term.toLocaleLowerCase()))
        .length,
    }))
    .filter(value => value.matches > 0)
    .sort((left, right) => (
      right.matches - left.matches
      || left.tag.displayName.localeCompare(right.tag.displayName)
    ))
    .slice(0, Math.max(0, maximum))
    .map(value => brand<string, 'TacticalTagId'>(String(value.tag.tagId))))
}

export interface TacticalRecallDecision {
  readonly procedure: TacticalProcedure
  readonly selected: boolean
  readonly rank?: number
  readonly matchedTagIds: readonly string[]
  readonly reasons: readonly string[]
}

export interface TacticalRecallResolution {
  readonly matchedTagIds: readonly TacticalTagId[]
  readonly selected: readonly TacticalRecallDecision[]
  readonly excluded: readonly TacticalRecallDecision[]
}

/**
 * Exact tenant-local recall resolver shared by Task compilation and the
 * Knowledge Center simulator. The registry provides lifecycle/ranking rules;
 * the asynchronous eligibility callback applies source rights, retention and
 * revocation policy before any procedure can be selected.
 */
export async function resolveTacticalRecall(input: {
  readonly text: string
  readonly tags: readonly TacticalTag[]
  readonly registry: {
    retrieve(value: {
      readonly tags: readonly string[]
      readonly includeTesting?: boolean
      readonly maxCandidates?: number
    }): readonly TacticalProcedure[]
    list(): readonly TacticalProcedure[]
  }
  readonly includeTesting: boolean
  readonly maximumTagMatches: number
  readonly maximumCandidates: number
  readonly eligibility: (
    skillId: string,
    version: SemVer,
  ) => Promise<{ readonly eligible: boolean; readonly reasons: readonly string[] }>
}): Promise<TacticalRecallResolution> {
  const maximumCandidates = Math.max(0, Math.floor(input.maximumCandidates))
  const tagIds = matchTacticalTags(
    input.text,
    input.tags,
    Math.max(0, Math.floor(input.maximumTagMatches)),
  )
  const recalled = tagIds.length === 0 || maximumCandidates === 0
    ? []
    : input.registry.retrieve({
        tags: tagIds.map(String),
        includeTesting: input.includeTesting,
        maxCandidates: maximumCandidates,
      })
  const selected: TacticalRecallDecision[] = []
  const excluded: TacticalRecallDecision[] = []
  const recalledKeys = new Set(recalled.map(procedure => procedureKey(procedure)))
  for (const procedure of recalled) {
    const matchedTagIds = procedure.scenarioTags.filter(tag =>
      tagIds.some(value => String(value) === tag))
    const eligibility = await input.eligibility(
      String(procedure.skillId),
      procedure.version,
    )
    if (!eligibility.eligible) {
      excluded.push({
        procedure,
        selected: false,
        matchedTagIds,
        reasons: eligibility.reasons.length === 0
          ? ['SOURCE_RIGHTS_NOT_ELIGIBLE']
          : eligibility.reasons,
      })
      continue
    }
    selected.push({
      procedure,
      selected: true,
      rank: selected.length + 1,
      matchedTagIds,
      reasons: [
        ...matchedTagIds.map(tag => `TAG_MATCH:${tag}`),
        `LIFECYCLE_ALLOWED:${procedure.lifecycle}`,
        'SOURCE_RIGHTS_ELIGIBLE',
      ],
    })
  }

  const allowedLifecycle = new Set(
    input.includeTesting
      ? ['CANARY', 'TESTING', 'STABLE']
      : ['STABLE'],
  )
  for (const procedure of input.registry.list()) {
    if (recalledKeys.has(procedureKey(procedure))) continue
    const matchedTagIds = procedure.scenarioTags.filter(tag =>
      tagIds.some(value => String(value) === tag))
    const reasons: string[] = []
    if (!allowedLifecycle.has(procedure.lifecycle)) {
      reasons.push(`LIFECYCLE_EXCLUDED:${procedure.lifecycle}`)
    }
    if (matchedTagIds.length === 0) reasons.push('NO_ACTIVE_TAG_MATCH')
    if (reasons.length === 0) reasons.push('CANDIDATE_LIMIT_OR_LOWER_RANK')
    excluded.push({
      procedure,
      selected: false,
      matchedTagIds,
      reasons,
    })
  }
  return cloneFrozen({
    matchedTagIds: tagIds,
    selected,
    excluded: excluded.sort((left, right) =>
      String(left.procedure.skillId).localeCompare(String(right.procedure.skillId))
      || String(left.procedure.version).localeCompare(String(right.procedure.version))),
  })
}

function procedureKey(value: TacticalProcedure): string {
  return `${String(value.skillId)}@${String(value.version)}`
}
