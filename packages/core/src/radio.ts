import {
  MilitaryError,
  type AgentIdentity,
  type MilitaryRadio,
  type TacticalGuidance,
  type TacticalRequest,
  type TacticalRequestId,
} from '@dsh-military/contracts'
import { cloneFrozen, isExpired, stableJson, type Clock } from './util.js'

interface RadioEntry {
  request: TacticalRequest
  state: 'QUEUED' | 'LEASED' | 'GUIDANCE_READY' | 'DELIVERED' | 'ACKNOWLEDGED' | 'DEAD_LETTERED'
  leaseOwner?: string
  leaseUntil?: number
  attempts: number
  guidance?: TacticalGuidance
  deadLetterReason?: string
}

export class InMemoryMilitaryRadio implements MilitaryRadio {
  readonly #entries = new Map<string, RadioEntry>()
  readonly #byIdempotency = new Map<string, { fingerprint: string; requestId: string }>()
  readonly #clock: Clock
  readonly #leaseMs: number
  readonly #maxAttempts: number

  constructor(options?: { readonly clock?: Clock; readonly leaseMs?: number; readonly maxAttempts?: number }) {
    this.#clock = options?.clock ?? (() => new Date())
    this.#leaseMs = options?.leaseMs ?? 60_000
    this.#maxAttempts = options?.maxAttempts ?? 3
  }

  async request(request: TacticalRequest): Promise<{ readonly requestId: TacticalRequestId; readonly state: 'QUEUED' | 'REJECTED' }> {
    if (!request.blocker.reproducible || request.evidence.length === 0) {
      throw new MilitaryError('REQUEST_NOT_ADMISSIBLE', 'radio request requires a reproducible blocker and evidence')
    }
    const fingerprint = stableJson({
      location: request.location,
      blocker: request.blocker,
      requestedDecision: request.requestedDecision,
    })
    const duplicate = this.#byIdempotency.get(request.idempotencyKey)
    if (duplicate !== undefined) {
      if (duplicate.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return { requestId: duplicate.requestId as TacticalRequestId, state: 'QUEUED' }
    }
    this.#entries.set(String(request.requestId), { request: cloneFrozen(request), state: 'QUEUED', attempts: 0 })
    this.#byIdempotency.set(request.idempotencyKey, { fingerprint, requestId: String(request.requestId) })
    return { requestId: request.requestId, state: 'QUEUED' }
  }

  async lease(advisor: AgentIdentity, signal: AbortSignal): Promise<TacticalRequest | null> {
    if (signal.aborted) throw signal.reason
    this.recoverExpiredLeases()
    const nowMs = this.#clock().getTime()
    const entry = [...this.#entries.values()]
      .filter(item => item.state === 'QUEUED')
      .filter(item => !isExpired(item.request.expiresAt, this.#clock))
      .sort((left, right) => Date.parse(left.request.createdAt) - Date.parse(right.request.createdAt))[0]
    if (entry === undefined) return null
    entry.state = 'LEASED'
    entry.leaseOwner = `${String(advisor.agentId)}@${advisor.generation}`
    entry.leaseUntil = nowMs + this.#leaseMs
    entry.attempts += 1
    return cloneFrozen(entry.request)
  }

  async leased(requestId: TacticalRequestId, advisor: AgentIdentity): Promise<TacticalRequest> {
    this.recoverExpiredLeases()
    const entry = this.#entries.get(String(requestId))
    const owner = `${String(advisor.agentId)}@${advisor.generation}`
    if (entry === undefined || entry.state !== 'LEASED' || entry.leaseOwner !== owner) {
      throw new MilitaryError('GUIDANCE_STALE', 'Tactical Request is not leased by the calling advisor')
    }
    return cloneFrozen(entry.request)
  }

  async issue(guidance: TacticalGuidance): Promise<void> {
    const entry = this.#entries.get(String(guidance.requestId))
    if (entry === undefined) throw new MilitaryError('NOT_FOUND')
    if (entry.state !== 'LEASED') {
      if (String(entry.guidance?.guidanceId ?? '') === String(guidance.guidanceId)) return
      throw new MilitaryError('GUIDANCE_STALE', `radio entry is ${entry.state}`)
    }
    if (Number(guidance.expectedTaskVersion) !== Number(entry.request.location.taskVersion)) throw new MilitaryError('GUIDANCE_STALE')
    if (isExpired(guidance.expiresAt, this.#clock)) throw new MilitaryError('GUIDANCE_EXPIRED')
    entry.guidance = cloneFrozen(guidance)
    entry.state = 'GUIDANCE_READY'
    delete entry.leaseOwner
    delete entry.leaseUntil
  }

  deliver(requestId: TacticalRequestId, currentTaskVersion: number): TacticalGuidance {
    const entry = this.#entries.get(String(requestId))
    if (entry?.guidance === undefined || entry.state !== 'GUIDANCE_READY') throw new MilitaryError('NOT_FOUND')
    if (Number(entry.guidance.expectedTaskVersion) !== currentTaskVersion) {
      entry.state = 'DEAD_LETTERED'
      throw new MilitaryError('GUIDANCE_STALE')
    }
    if (isExpired(entry.guidance.expiresAt, this.#clock)) {
      entry.state = 'DEAD_LETTERED'
      throw new MilitaryError('GUIDANCE_EXPIRED')
    }
    entry.state = 'DELIVERED'
    return cloneFrozen(entry.guidance)
  }

  async guidance(guidanceId: string): Promise<TacticalGuidance> {
    const entry = [...this.#entries.values()].find(item => String(item.guidance?.guidanceId) === guidanceId)
    if (entry?.guidance === undefined) throw new MilitaryError('NOT_FOUND', `unknown guidance ${guidanceId}`)
    if (isExpired(entry.guidance.expiresAt, this.#clock)) throw new MilitaryError('GUIDANCE_EXPIRED')
    if (entry.state === 'GUIDANCE_READY') entry.state = 'DELIVERED'
    return cloneFrozen(entry.guidance)
  }

  async acknowledge(
    guidanceId: string,
    worker: AgentIdentity,
    task?: { readonly taskId: import('@dsh-military/contracts').TaskId; readonly taskVersion: import('@dsh-military/contracts').TaskVersion },
  ): Promise<void> {
    const entry = [...this.#entries.values()].find(item => item.guidance?.guidanceId === guidanceId)
    if (entry === undefined || entry.state !== 'DELIVERED') throw new MilitaryError('NOT_FOUND')
    const originalWorker = String(entry.request.identity.agentId) === String(worker.agentId)
      && entry.request.identity.generation === worker.generation
    const replacementForExactTask = task !== undefined
      && String(entry.request.location.taskId) === String(task.taskId)
      && Number(entry.request.location.taskVersion) === Number(task.taskVersion)
    if (!originalWorker && !replacementForExactTask) {
      throw new MilitaryError('UNAUTHORIZED')
    }
    entry.state = 'ACKNOWLEDGED'
  }

  async expire(requestId: TacticalRequestId, reason: string): Promise<void> {
    const entry = this.#entries.get(String(requestId))
    if (entry === undefined) return
    if (entry.state === 'ACKNOWLEDGED') return
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
      return
    }
    entry.state = 'DEAD_LETTERED'
    entry.deadLetterReason = reason
    delete entry.leaseOwner
    delete entry.leaseUntil
  }

  recoverExpiredLeases(): void {
    const nowMs = this.#clock().getTime()
    for (const entry of this.#entries.values()) {
      if (
        entry.state === 'QUEUED'
        && entry.request.expiresAt !== undefined
        && Date.parse(entry.request.expiresAt) <= nowMs
      ) {
        entry.state = 'DEAD_LETTERED'
        continue
      }
      if (entry.state !== 'LEASED' || entry.leaseUntil === undefined || entry.leaseUntil > nowMs) continue
      delete entry.leaseOwner
      delete entry.leaseUntil
      entry.state = entry.attempts >= this.#maxAttempts ? 'DEAD_LETTERED' : 'QUEUED'
    }
  }

  async reconcileDeadLetters(): Promise<readonly TacticalRequest[]> {
    const before = new Set([...this.#entries.entries()]
      .filter(([, value]) => value.state === 'DEAD_LETTERED')
      .map(([id]) => id))
    this.recoverExpiredLeases()
    return cloneFrozen([...this.#entries.entries()]
      .filter(([id, value]) =>
        value.state === 'DEAD_LETTERED' && !before.has(id))
      .map(([, value]) => value.request))
  }

  snapshot(): readonly Readonly<RadioEntry>[] { return cloneFrozen([...this.#entries.values()]) }
}
