import {
  MilitaryError,
  type AgentIdentity,
  type MilitaryRadio,
  type TacticalGuidance,
  type TacticalRequest,
  type TacticalRequestId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  isExpired,
  stableJson,
  type Clock,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

interface RadioEntry {
  request: TacticalRequest
  state: 'QUEUED' | 'LEASED' | 'GUIDANCE_READY' | 'DELIVERED' | 'ACKNOWLEDGED' | 'DEAD_LETTERED'
  leaseOwner?: string
  leaseUntil?: number
  attempts: number
  guidance?: TacticalGuidance
  deadLetterReason?: string
}

interface RadioState {
  entries: Record<string, RadioEntry>
  byIdempotency: Record<string, { fingerprint: string; requestId: string }>
}

const emptyRadioState = (): RadioState => ({ entries: {}, byIdempotency: {} })

/**
 * Durable Staff Radio queue. Leasing, retry fencing, guidance publication and
 * acknowledgement all mutate one SQLite snapshot under BEGIN IMMEDIATE.
 */
export class SqliteMilitaryRadio implements MilitaryRadio {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock
  #leaseMs: number
  #maxAttempts: number

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    options?: { readonly clock?: Clock; readonly leaseMs?: number; readonly maxAttempts?: number },
  ) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = options?.clock ?? (() => new Date())
    this.#leaseMs = options?.leaseMs ?? 60_000
    this.#maxAttempts = options?.maxAttempts ?? 3
  }

  /** Apply validated live limits to future leases and subsequent recovery decisions. */
  updateLimits(input: { readonly leaseMs: number; readonly maxAttempts: number }): void {
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 10_000 || input.leaseMs > 3_600_000) {
      throw new TypeError('Radio leaseMs must be an integer between 10000 and 3600000')
    }
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 32) {
      throw new TypeError('Radio maxAttempts must be an integer between 1 and 32')
    }
    this.#leaseMs = input.leaseMs
    this.#maxAttempts = input.maxAttempts
  }

  async request(request: TacticalRequest): Promise<{
    readonly requestId: TacticalRequestId
    readonly state: 'QUEUED' | 'REJECTED'
  }> {
    if (!request.blocker.reproducible || request.evidence.length === 0) {
      throw new MilitaryError('REQUEST_NOT_ADMISSIBLE', 'radio request requires a reproducible blocker and evidence')
    }
    const fingerprint = stableJson({
      location: request.location,
      blocker: request.blocker,
      requestedDecision: request.requestedDecision,
    })
    return await this.#records.update<RadioState, { requestId: TacticalRequestId; state: 'QUEUED' }>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const duplicate = state.byIdempotency[request.idempotencyKey]
        if (duplicate !== undefined) {
          if (duplicate.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return {
            next: state,
            result: { requestId: duplicate.requestId as TacticalRequestId, state: 'QUEUED' },
          }
        }
        const requestId = String(request.requestId)
        const existing = state.entries[requestId]
        if (existing !== undefined) {
          if (stableJson(existing.request) !== stableJson(request)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: state, result: { requestId: request.requestId, state: 'QUEUED' } }
        }
        state.entries[requestId] = {
          request: cloneFrozen(request),
          state: 'QUEUED',
          attempts: 0,
        }
        state.byIdempotency[request.idempotencyKey] = { fingerprint, requestId }
        return { next: state, result: { requestId: request.requestId, state: 'QUEUED' } }
      },
    )
  }

  async lease(advisor: AgentIdentity, signal: AbortSignal): Promise<TacticalRequest | null> {
    if (signal.aborted) throw signal.reason
    return await this.#records.update<RadioState, TacticalRequest | null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        if (signal.aborted) throw signal.reason
        const nowMs = this.#clock().getTime()
        recoverRadioEntries(state, nowMs, this.#maxAttempts)
        const entry = Object.values(state.entries)
          .filter(item => item.state === 'QUEUED')
          .sort((left, right) => Date.parse(left.request.createdAt) - Date.parse(right.request.createdAt))[0]
        if (entry === undefined) return { next: state, result: null }
        entry.state = 'LEASED'
        entry.leaseOwner = `${String(advisor.agentId)}@${advisor.generation}`
        entry.leaseUntil = nowMs + this.#leaseMs
        entry.attempts += 1
        return { next: state, result: cloneFrozen(entry.request) }
      },
    )
  }

  async leased(
    requestId: TacticalRequestId,
    advisor: AgentIdentity,
  ): Promise<TacticalRequest> {
    const state = await this.#records.read<RadioState>('radio', 'state')
      ?? emptyRadioState()
    const entry = state.entries[String(requestId)]
    const owner = `${String(advisor.agentId)}@${advisor.generation}`
    if (entry === undefined
      || entry.state !== 'LEASED'
      || entry.leaseOwner !== owner
      || entry.leaseUntil === undefined
      || entry.leaseUntil <= this.#clock().getTime()) {
      throw new MilitaryError(
        'GUIDANCE_STALE',
        'Tactical Request is not actively leased by the calling advisor',
      )
    }
    return cloneFrozen(entry.request)
  }

  async issue(guidance: TacticalGuidance): Promise<void> {
    await this.#records.update<RadioState, null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = state.entries[String(guidance.requestId)]
        if (entry === undefined) throw new MilitaryError('NOT_FOUND')
        if (entry.state !== 'LEASED') {
          if (String(entry.guidance?.guidanceId ?? '') === String(guidance.guidanceId)) {
            return { next: state, result: null }
          }
          throw new MilitaryError('GUIDANCE_STALE', `radio entry is ${entry.state}`)
        }
        if (Number(guidance.expectedTaskVersion) !== Number(entry.request.location.taskVersion)) {
          throw new MilitaryError('GUIDANCE_STALE')
        }
        if (isExpired(guidance.expiresAt, this.#clock)) throw new MilitaryError('GUIDANCE_EXPIRED')
        entry.guidance = cloneFrozen(guidance)
        entry.state = 'GUIDANCE_READY'
        delete entry.leaseOwner
        delete entry.leaseUntil
        return { next: state, result: null }
      },
    )
  }

  async guidance(guidanceId: string): Promise<TacticalGuidance> {
    const result = await this.#records.update<
      RadioState,
      { readonly guidance?: TacticalGuidance; readonly error?: 'NOT_FOUND' | 'GUIDANCE_EXPIRED' }
    >(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = Object.values(state.entries)
          .find(item => String(item.guidance?.guidanceId) === guidanceId)
        if (entry?.guidance === undefined || entry.state === 'DEAD_LETTERED') {
          return { next: state, result: { error: 'NOT_FOUND' } }
        }
        if (isExpired(entry.guidance.expiresAt, this.#clock)) {
          entry.state = 'DEAD_LETTERED'
          return { next: state, result: { error: 'GUIDANCE_EXPIRED' } }
        }
        if (entry.state === 'GUIDANCE_READY') entry.state = 'DELIVERED'
        return { next: state, result: { guidance: cloneFrozen(entry.guidance) } }
      },
    )
    if (result.error === 'GUIDANCE_EXPIRED') throw new MilitaryError('GUIDANCE_EXPIRED')
    if (result.guidance === undefined) throw new MilitaryError('NOT_FOUND', `unknown guidance ${guidanceId}`)
    return result.guidance
  }

  async acknowledge(
    guidanceId: string,
    worker: AgentIdentity,
    task?: {
      readonly taskId: import('@dsh-military/contracts').TaskId
      readonly taskVersion: import('@dsh-military/contracts').TaskVersion
    },
  ): Promise<void> {
    await this.#records.update<RadioState, null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = Object.values(state.entries)
          .find(item => String(item.guidance?.guidanceId) === guidanceId)
        if (entry === undefined || entry.guidance === undefined) throw new MilitaryError('NOT_FOUND')
        const originalWorker = String(entry.request.identity.agentId) === String(worker.agentId)
          && String(entry.request.identity.sessionId) === String(worker.sessionId)
          && entry.request.identity.generation === worker.generation
        const replacementForExactTask = task !== undefined
          && String(entry.request.location.taskId) === String(task.taskId)
          && Number(entry.request.location.taskVersion) === Number(task.taskVersion)
        if (!originalWorker && !replacementForExactTask) {
          throw new MilitaryError('UNAUTHORIZED')
        }
        if (entry.state === 'ACKNOWLEDGED') return { next: state, result: null }
        if (entry.state !== 'DELIVERED') throw new MilitaryError('NOT_FOUND')
        entry.state = 'ACKNOWLEDGED'
        return { next: state, result: null }
      },
    )
  }

  async expire(requestId: TacticalRequestId, reason: string): Promise<void> {
    await this.#records.update<RadioState, null>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const entry = state.entries[String(requestId)]
        if (entry === undefined || entry.state === 'ACKNOWLEDGED') {
          return { next: state, result: null }
        }
        if (entry.state === 'DEAD_LETTERED') {
          if (
            entry.deadLetterReason !== undefined
            && entry.deadLetterReason !== reason
          ) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              'radio request already has another terminal reason',
            )
          }
          return { next: state, result: null }
        }
        entry.state = 'DEAD_LETTERED'
        entry.deadLetterReason = reason
        delete entry.leaseOwner
        delete entry.leaseUntil
        return { next: state, result: null }
      },
    )
  }

  async reconcileDeadLetters(): Promise<readonly TacticalRequest[]> {
    return await this.#records.update<RadioState, readonly TacticalRequest[]>(
      'radio',
      'state',
      emptyRadioState,
      state => {
        const before = new Set(Object.entries(state.entries)
          .filter(([, value]) => value.state === 'DEAD_LETTERED')
          .map(([id]) => id))
        recoverRadioEntries(state, this.#clock().getTime(), this.#maxAttempts)
        const dead = Object.entries(state.entries)
          .filter(([id, value]) =>
            value.state === 'DEAD_LETTERED' && !before.has(id))
          .map(([, value]) => cloneFrozen(value.request))
        return { next: state, result: dead }
      },
    )
  }
}

function recoverRadioEntries(state: RadioState, nowMs: number, maxAttempts: number): void {
  for (const entry of Object.values(state.entries)) {
    if (entry.state === 'QUEUED'
      && entry.request.expiresAt !== undefined
      && Date.parse(entry.request.expiresAt) <= nowMs) {
      entry.state = 'DEAD_LETTERED'
      continue
    }
    if (entry.state !== 'LEASED' || entry.leaseUntil === undefined || entry.leaseUntil > nowMs) continue
    delete entry.leaseOwner
    delete entry.leaseUntil
    entry.state = entry.attempts >= maxAttempts ? 'DEAD_LETTERED' : 'QUEUED'
  }
}
