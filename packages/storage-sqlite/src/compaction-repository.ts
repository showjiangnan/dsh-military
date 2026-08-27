import {
  MilitaryError,
  type CompactionAttempt,
  type MilitaryCompactionAttempts,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

/** Durable compaction attempt fencing across host restarts. */
export class SqliteCompactionAttempts implements MilitaryCompactionAttempts {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async require(attempt: CompactionAttempt): Promise<void> {
    validatePendingCompactionAttempt(attempt)
    await this.#records.update<CompactionAttempt | null, null>(
      'compaction-attempt',
      attempt.attemptId,
      () => null,
      current => {
        if (current !== null) {
          if (stableJson(current) !== stableJson(attempt)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: current, result: null }
        }
        return { next: cloneFrozen(attempt), result: null }
      },
    )
  }

  async complete(attempt: CompactionAttempt): Promise<void> {
    await this.#records.update<CompactionAttempt | null, null>(
      'compaction-attempt',
      attempt.attemptId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.outcome !== 'PENDING') {
          if (stableJson(current) !== stableJson(attempt)) throw new MilitaryError('REVISION_CONFLICT')
          return { next: current, result: null }
        }
        if (attempt.outcome === 'PENDING') throw new MilitaryError('INVALID_ARGUMENT', 'completion must be terminal')
        if (attempt.attemptId !== current.attemptId) throw new MilitaryError('REVISION_CONFLICT')
        return { next: cloneFrozen(attempt), result: null }
      },
    )
  }

  async get(attemptId: string): Promise<CompactionAttempt> {
    const attempt = await this.#records.read<CompactionAttempt>('compaction-attempt', attemptId)
    if (attempt === null) throw new MilitaryError('NOT_FOUND')
    return attempt
  }
}

function validatePendingCompactionAttempt(attempt: CompactionAttempt): void {
  if (!Number.isSafeInteger(attempt.contextBudgetTokens) || attempt.contextBudgetTokens <= 0
    || !Number.isSafeInteger(attempt.thresholdTokens) || attempt.thresholdTokens <= 0
    || attempt.thresholdTokens > attempt.contextBudgetTokens
    || !Number.isSafeInteger(attempt.meterTokens) || attempt.meterTokens < attempt.thresholdTokens) {
    throw new MilitaryError('CONTEXT_POLICY_INVALID', 'compaction attempt must be raised at or beyond a valid threshold')
  }
  if (!Object.values(attempt.safeBoundary).every(Boolean)) {
    throw new MilitaryError('COMPACTION_ATTEMPT_FAILED', 'unsafe compaction boundary')
  }
  if (attempt.outcome !== 'PENDING') {
    throw new MilitaryError('INVALID_ARGUMENT', 'new compaction attempt must be PENDING')
  }
}
