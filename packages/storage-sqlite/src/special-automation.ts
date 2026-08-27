import {
  MilitaryError,
  brand,
  isoNow,
  type MissionId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  stableJson,
  type Clock,
} from '@dsh-military/core'
import type {
  SpecialDepartmentAutomationStore,
  SpecialDepartmentJob,
} from '@dsh-military/runtime'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

const NAMESPACE = 'special-department-automation'

/** Durable CAS outbox for event-driven special department dispatch. */
export class SqliteSpecialDepartmentAutomationStore implements SpecialDepartmentAutomationStore {
  readonly #records: SqliteStateRecords
  readonly #clock: Clock
  readonly #claimLeaseMs: number

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    options?: { readonly clock?: Clock; readonly claimLeaseMs?: number },
  ) {
    this.#records = new SqliteStateRecords(database, tenantId)
    this.#clock = options?.clock ?? (() => new Date())
    this.#claimLeaseMs = options?.claimLeaseMs ?? 30_000
  }

  async register(job: SpecialDepartmentJob): Promise<SpecialDepartmentJob> {
    return await this.#records.update<SpecialDepartmentJob | null, SpecialDepartmentJob>(
      NAMESPACE,
      job.jobId,
      () => null,
      current => {
        if (current !== null) {
          if (fingerprint(current) !== fingerprint(job)) {
            throw new MilitaryError('IDEMPOTENCY_CONFLICT', `special automation job ${job.jobId} changed`)
          }
          return { next: current, result: current }
        }
        const next = cloneFrozen(job)
        return { next, result: next }
      },
    )
  }

  async claim(jobId: string, ownerId: string): Promise<SpecialDepartmentJob | null> {
    return await this.#records.update<SpecialDepartmentJob | null, SpecialDepartmentJob | null>(
      NAMESPACE,
      jobId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND', `unknown special automation job ${jobId}`)
        if (current.state === 'DISPATCHED'
          || (current.state !== 'RUNNING' && current.attempts >= 3)) {
          return { next: current, result: null }
        }
        if (current.state === 'RUNNING'
          && current.claimExpiresAt !== undefined
          && Date.parse(current.claimExpiresAt) > this.#clock().getTime()) {
          return { next: current, result: null }
        }
        const claimedAt = now(this.#clock)
        const next = cloneFrozen({
          ...current,
          state: 'RUNNING' as const,
          attempts: current.state === 'RUNNING'
            ? current.attempts
            : current.attempts + 1,
          claimOwner: ownerId,
          claimExpiresAt: brand<string, 'IsoDateTime'>(
            new Date(Date.parse(claimedAt) + this.#claimLeaseMs).toISOString(),
          ),
          updatedAt: claimedAt,
        })
        return { next, result: next }
      },
    )
  }

  async complete(
    jobId: string,
    result: { readonly childSessionId: string; readonly bindingId: string },
  ): Promise<SpecialDepartmentJob> {
    return await this.#records.update<SpecialDepartmentJob | null, SpecialDepartmentJob>(
      NAMESPACE,
      jobId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND', `unknown special automation job ${jobId}`)
        if (current.state === 'DISPATCHED') {
          if (current.childSessionId !== result.childSessionId || current.bindingId !== result.bindingId) {
            throw new MilitaryError('IDEMPOTENCY_CONFLICT', `special automation completion ${jobId} changed`)
          }
          return { next: current, result: current }
        }
        if (current.state !== 'RUNNING') {
          throw new MilitaryError('REVISION_CONFLICT', `${jobId} is ${current.state}`)
        }
        const {
          claimOwner: _claimOwner,
          claimExpiresAt: _claimExpiresAt,
          ...withoutClaim
        } = current
        const next = cloneFrozen({
          ...withoutClaim,
          state: 'DISPATCHED' as const,
          childSessionId: result.childSessionId,
          bindingId: result.bindingId,
          updatedAt: isoNow(),
        })
        return { next, result: next }
      },
    )
  }

  async fail(jobId: string, error: string): Promise<SpecialDepartmentJob> {
    return await this.#records.update<SpecialDepartmentJob | null, SpecialDepartmentJob>(
      NAMESPACE,
      jobId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND', `unknown special automation job ${jobId}`)
        if (current.state !== 'RUNNING') return { next: current, result: current }
        const {
          claimOwner: _claimOwner,
          claimExpiresAt: _claimExpiresAt,
          ...withoutClaim
        } = current
        const next = cloneFrozen({
          ...withoutClaim,
          state: 'FAILED' as const,
          lastError: error,
          updatedAt: isoNow(),
        })
        return { next, result: next }
      },
    )
  }

  async list(missionId: MissionId): Promise<readonly SpecialDepartmentJob[]> {
    return cloneFrozen(this.#records.listSync<SpecialDepartmentJob>(NAMESPACE)
      .filter(job => String(job.missionId) === String(missionId))
      .sort((left, right) => left.sourceEventSeq - right.sourceEventSeq
        || left.jobId.localeCompare(right.jobId)))
  }
}

function fingerprint(job: SpecialDepartmentJob): string {
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
