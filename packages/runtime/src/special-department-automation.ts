import {
  MilitaryError,
  brand,
  type AgentTemplateId,
  type IsoDateTime,
  type MilitaryLedger,
  type MissionEvent,
  type MissionId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  sha256,
  stableJson,
  uuid,
  type Clock,
} from '@dsh-military/core'

export type SpecialDepartmentJobKind =
  | 'TRAJECTORY_AFTER_WAVE'
  | 'EFFECTIVENESS_AFTER_GENERAL_COMPACTION'
  | 'EVALUATION_EXAMINER'
  | 'EVALUATION_CHAIR'
  | 'MUSEUM_CANARY_AFTER_EVALUATION'

export interface SpecialDepartmentJob {
  readonly schemaVersion: '1.0.0'
  readonly jobId: string
  readonly missionId: MissionId
  readonly sourceEventId: string
  readonly sourceEventSeq: number
  readonly kind: SpecialDepartmentJobKind
  readonly templateId: AgentTemplateId
  readonly label: string
  readonly prompt: string
  readonly state: 'PENDING' | 'RUNNING' | 'DISPATCHED' | 'FAILED'
  readonly attempts: number
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly childSessionId?: string
  readonly bindingId?: string
  readonly lastError?: string
  readonly claimOwner?: string
  readonly claimExpiresAt?: IsoDateTime
}

export interface SpecialDepartmentAutomationStore {
  register(job: SpecialDepartmentJob): Promise<SpecialDepartmentJob>
  claim(jobId: string, ownerId: string): Promise<SpecialDepartmentJob | null>
  complete(
    jobId: string,
    result: { readonly childSessionId: string; readonly bindingId: string },
  ): Promise<SpecialDepartmentJob>
  fail(jobId: string, error: string): Promise<SpecialDepartmentJob>
  list(missionId: MissionId): Promise<readonly SpecialDepartmentJob[]>
}

export interface SpecialDepartmentDispatcher<Parent> {
  dispatch(
    job: SpecialDepartmentJob,
    parent: Parent,
    signal: AbortSignal,
  ): Promise<{ readonly childSessionId: string; readonly bindingId: string }>
}

export interface SpecialDepartmentReconcileReceipt {
  readonly jobId: string
  readonly kind: SpecialDepartmentJobKind
  readonly disposition: 'DISPATCHED' | 'ALREADY_DISPATCHED' | 'FAILED'
  readonly childSessionId?: string
  readonly error?: string
}

/** Durable event-to-department outbox. Reconciliation is idempotent by source event. */
export class SpecialDepartmentAutomation<Parent> {
  readonly #ledger: MilitaryLedger
  readonly #store: SpecialDepartmentAutomationStore
  readonly #dispatcher: SpecialDepartmentDispatcher<Parent>
  readonly #enabled: (kind: SpecialDepartmentJobKind) => boolean
  readonly #workerId: string

  constructor(input: {
    readonly ledger: MilitaryLedger
    readonly store: SpecialDepartmentAutomationStore
    readonly dispatcher: SpecialDepartmentDispatcher<Parent>
    /** Live feature gate. Disabled kinds remain durable and can resume when re-enabled. */
    readonly enabled?: (kind: SpecialDepartmentJobKind) => boolean
    readonly workerId?: string
  }) {
    this.#ledger = input.ledger
    this.#store = input.store
    this.#dispatcher = input.dispatcher
    this.#enabled = input.enabled ?? (() => true)
    this.#workerId = input.workerId ?? uuid('special-automation-worker')
  }

  async reconcile(input: {
    readonly missionId: MissionId
    readonly parent: Parent
    readonly signal: AbortSignal
  }): Promise<readonly SpecialDepartmentReconcileReceipt[]> {
    input.signal.throwIfAborted()
    const events = await this.#ledger.readEvents(input.missionId)
    for (const event of events) {
      const descriptor = describeSpecialJob(event)
      if (descriptor === null || !this.#enabled(descriptor.kind)) continue
      await this.#store.register(createJob(input.missionId, event, descriptor))
    }

    const receipts: SpecialDepartmentReconcileReceipt[] = []
    const jobs = await this.#store.list(input.missionId)
    for (const job of jobs) {
      input.signal.throwIfAborted()
      if (!this.#enabled(job.kind)) continue
      if (job.state === 'DISPATCHED') {
        receipts.push({
          jobId: job.jobId,
          kind: job.kind,
          disposition: 'ALREADY_DISPATCHED',
          ...(job.childSessionId === undefined ? {} : { childSessionId: job.childSessionId }),
        })
        continue
      }
      const claimed = await this.#store.claim(job.jobId, this.#workerId)
      if (claimed === null) continue
      try {
        const dispatched = await this.#dispatcher.dispatch(claimed, input.parent, input.signal)
        await this.#store.complete(claimed.jobId, dispatched)
        receipts.push({
          jobId: claimed.jobId,
          kind: claimed.kind,
          disposition: 'DISPATCHED',
          childSessionId: dispatched.childSessionId,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.#store.fail(claimed.jobId, message)
        receipts.push({
          jobId: claimed.jobId,
          kind: claimed.kind,
          disposition: 'FAILED',
          error: message,
        })
      }
    }
    return cloneFrozen(receipts)
  }
}

/** Test/default implementation; production composes the SQLite store. */
export class InMemorySpecialDepartmentAutomationStore implements SpecialDepartmentAutomationStore {
  readonly #jobs = new Map<string, SpecialDepartmentJob>()
  readonly #clock: Clock
  readonly #claimLeaseMs: number

  constructor(options?: {
    readonly clock?: Clock
    readonly claimLeaseMs?: number
  }) {
    this.#clock = options?.clock ?? (() => new Date())
    this.#claimLeaseMs = options?.claimLeaseMs ?? 30_000
  }

  async register(job: SpecialDepartmentJob): Promise<SpecialDepartmentJob> {
    const existing = this.#jobs.get(job.jobId)
    if (existing !== undefined) {
      if (jobFingerprint(existing) !== jobFingerprint(job)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT', `special automation job ${job.jobId} changed`)
      }
      return cloneFrozen(existing)
    }
    this.#jobs.set(job.jobId, cloneFrozen(job))
    return cloneFrozen(job)
  }

  async claim(jobId: string, ownerId: string): Promise<SpecialDepartmentJob | null> {
    const job = this.#require(jobId)
    if (job.state === 'DISPATCHED'
      || (job.state !== 'RUNNING' && job.attempts >= 3)) return null
    if (job.state === 'RUNNING'
      && job.claimExpiresAt !== undefined
      && Date.parse(job.claimExpiresAt) > this.#clock().getTime()) return null
    const claimedAt = now(this.#clock)
    const next = cloneFrozen({
      ...job,
      state: 'RUNNING' as const,
      attempts: job.state === 'RUNNING' ? job.attempts : job.attempts + 1,
      claimOwner: ownerId,
      claimExpiresAt: brand<string, 'IsoDateTime'>(
        new Date(Date.parse(claimedAt) + this.#claimLeaseMs).toISOString(),
      ),
      updatedAt: claimedAt,
    })
    this.#jobs.set(jobId, next)
    return cloneFrozen(next)
  }

  async complete(
    jobId: string,
    result: { readonly childSessionId: string; readonly bindingId: string },
  ): Promise<SpecialDepartmentJob> {
    const job = this.#require(jobId)
    if (job.state === 'DISPATCHED') {
      if (job.childSessionId !== result.childSessionId || job.bindingId !== result.bindingId) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT', `special automation completion ${jobId} changed`)
      }
      return cloneFrozen(job)
    }
    if (job.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT', `${jobId} is ${job.state}`)
    const {
      claimOwner: _claimOwner,
      claimExpiresAt: _claimExpiresAt,
      ...withoutClaim
    } = job
    const next = cloneFrozen({
      ...withoutClaim,
      state: 'DISPATCHED' as const,
      childSessionId: result.childSessionId,
      bindingId: result.bindingId,
      updatedAt: now(),
    })
    this.#jobs.set(jobId, next)
    return cloneFrozen(next)
  }

  async fail(jobId: string, error: string): Promise<SpecialDepartmentJob> {
    const job = this.#require(jobId)
    if (job.state !== 'RUNNING') return cloneFrozen(job)
    const {
      claimOwner: _claimOwner,
      claimExpiresAt: _claimExpiresAt,
      ...withoutClaim
    } = job
    const next = cloneFrozen({
      ...withoutClaim,
      state: 'FAILED' as const,
      lastError: error,
      updatedAt: now(),
    })
    this.#jobs.set(jobId, next)
    return cloneFrozen(next)
  }

  async list(missionId: MissionId): Promise<readonly SpecialDepartmentJob[]> {
    return cloneFrozen([...this.#jobs.values()]
      .filter(job => String(job.missionId) === String(missionId))
      .sort((left, right) => left.sourceEventSeq - right.sourceEventSeq
        || left.jobId.localeCompare(right.jobId)))
  }

  #require(jobId: string): SpecialDepartmentJob {
    const job = this.#jobs.get(jobId)
    if (job === undefined) throw new MilitaryError('NOT_FOUND', `unknown special automation job ${jobId}`)
    return job
  }
}

interface SpecialJobDescriptor {
  readonly kind: SpecialDepartmentJobKind
  readonly templateId: string
  readonly label: string
  readonly prompt: string
}

function describeSpecialJob(event: MissionEvent): SpecialJobDescriptor | null {
  const payload = event.payload as Readonly<Record<string, unknown>>
  if (event.type === 'wave/barrier-satisfied') {
    return {
      kind: 'TRAJECTORY_AFTER_WAVE',
      templateId: 'trajectory-memory',
      label: `Trajectory memory for ${String(payload['waveId'] ?? event.eventId)}`,
      prompt: `Build a source-covered tactical trajectory from accepted and integrated facts through Mission event ${event.eventId}. Submit the result only as a research artifact.`,
    }
  }
  if (event.type === 'context/compaction-completed'
    && event.actor.role === 'general'
    && payload['outcome'] === 'SUCCEEDED') {
    return {
      kind: 'EFFECTIVENESS_AFTER_GENERAL_COMPACTION',
      templateId: 'effectiveness-assessor',
      label: `Compaction effectiveness ${String(payload['attemptId'] ?? event.eventId)}`,
      prompt: `Evaluate the external outcome effectiveness associated with General compaction event ${event.eventId}. Distinguish correlation from causation and submit a sourced research artifact.`,
    }
  }
  return null
}

function createJob(
  missionId: MissionId,
  event: MissionEvent,
  descriptor: SpecialJobDescriptor,
): SpecialDepartmentJob {
  const stamp = now()
  const jobId = `special-${sha256(stableJson({
    missionId: String(missionId),
    sourceEventId: String(event.eventId),
    kind: descriptor.kind,
  })).slice(0, 32)}`
  return cloneFrozen({
    schemaVersion: '1.0.0',
    jobId,
    missionId,
    sourceEventId: String(event.eventId),
    sourceEventSeq: event.seq,
    kind: descriptor.kind,
    templateId: brand<string, 'AgentTemplateId'>(descriptor.templateId),
    label: descriptor.label,
    prompt: descriptor.prompt,
    state: 'PENDING',
    attempts: 0,
    createdAt: stamp,
    updatedAt: stamp,
  })
}

function jobFingerprint(job: SpecialDepartmentJob): string {
  return stableJson({
    missionId: String(job.missionId),
    sourceEventId: job.sourceEventId,
    sourceEventSeq: job.sourceEventSeq,
    kind: job.kind,
    templateId: String(job.templateId),
    label: job.label,
    prompt: job.prompt,
  })
}
