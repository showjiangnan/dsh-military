import {
  MilitaryError,
  brand,
  type MilitaryTags,
  type Revision,
  type TacticalTag,
  type TacticalTagId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

interface TagState {
  tags: Record<string, TacticalTag>
}

const emptyTagState = (): TagState => ({ tags: {} })

/** Durable tactical tag registry used by ingestion and routing. */
export class SqliteTacticalTagRegistry implements MilitaryTags {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock

  constructor(database: SqliteMilitaryDatabase, tenantId: string, clock?: Clock) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = clock ?? (() => new Date())
  }

  async list(options?: { readonly status?: 'ACTIVE' | 'PAUSED' | 'DELETED' }): Promise<readonly TacticalTag[]> {
    const state = await this.#records.read<TagState>('tactical-tags', 'state') ?? emptyTagState()
    return cloneFrozen(Object.values(state.tags)
      .filter(tag => options?.status === undefined || tag.status === options.status)
      .sort((left, right) => left.displayName.localeCompare(right.displayName)))
  }

  async get(tagId: TacticalTagId): Promise<TacticalTag> {
    const state = await this.#records.read<TagState>('tactical-tags', 'state') ?? emptyTagState()
    const tag = state.tags[String(tagId)]
    if (tag === undefined) throw new MilitaryError('NOT_FOUND', `unknown tag ${String(tagId)}`)
    return cloneFrozen(tag)
  }

  async create(tag: TacticalTag): Promise<void> {
    if (tag.status === 'DELETED') throw new MilitaryError('INVALID_ARGUMENT', 'cannot create a deleted tag')
    await this.#records.update<TagState, null>(
      'tactical-tags',
      'state',
      emptyTagState,
      state => {
        if (state.tags[String(tag.tagId)] !== undefined) throw new MilitaryError('REVISION_CONFLICT')
        state.tags[String(tag.tagId)] = cloneFrozen(tag)
        return { next: state, result: null }
      },
    )
  }

  async rename(tagId: TacticalTagId, displayName: string, expectedRevision: Revision): Promise<TacticalTag> {
    if (displayName.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      displayName,
      renamedFrom: tag.displayName,
      updatedAt: now(this.#clock),
    }))
  }

  async pause(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      status: 'PAUSED',
      updatedAt: now(this.#clock),
    }))
  }

  async resume(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    return await this.#mutate(tagId, expectedRevision, tag => {
      if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
      return { ...tag, status: 'ACTIVE', updatedAt: now(this.#clock) }
    })
  }

  async delete(tagId: TacticalTagId, expectedRevision: Revision): Promise<TacticalTag> {
    const timestamp = now(this.#clock)
    return await this.#mutate(tagId, expectedRevision, tag => ({
      ...tag,
      status: 'DELETED',
      updatedAt: timestamp,
      deletedAt: timestamp,
    }))
  }

  async #mutate(
    tagId: TacticalTagId,
    expectedRevision: Revision,
    mutate: (tag: TacticalTag) => TacticalTag,
  ): Promise<TacticalTag> {
    return await this.#records.update<TagState, TacticalTag>(
      'tactical-tags',
      'state',
      emptyTagState,
      state => {
        const tag = state.tags[String(tagId)]
        if (tag === undefined) throw new MilitaryError('NOT_FOUND', `unknown tag ${String(tagId)}`)
        if (Number(tag.revision) !== Number(expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
        if (tag.status === 'DELETED') throw new MilitaryError('TACTICAL_TAG_DELETED')
        const body = mutate(tag)
        const { revision: _discardedRevision, ...withoutRevision } = body
        const next = cloneFrozen({
          ...withoutRevision,
          revision: brand<number, 'Revision'>(Number(expectedRevision) + 1),
        } as TacticalTag)
        state.tags[String(tagId)] = next
        return { next: state, result: next }
      },
    )
  }
}
