import {
  MilitaryError,
  type CompactionAttempt,
  type MilitaryCompactionAttempts,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from './util.js'

export class InMemoryCompactionAttempts implements MilitaryCompactionAttempts {
  readonly #attempts = new Map<string, CompactionAttempt>()

  async require(attempt: CompactionAttempt): Promise<void> {
    const existing = this.#attempts.get(attempt.attemptId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(attempt)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    if (!Number.isSafeInteger(attempt.contextBudgetTokens) || attempt.contextBudgetTokens <= 0
      || !Number.isSafeInteger(attempt.thresholdTokens) || attempt.thresholdTokens <= 0
      || attempt.thresholdTokens > attempt.contextBudgetTokens
      || !Number.isSafeInteger(attempt.meterTokens) || attempt.meterTokens < attempt.thresholdTokens) {
      throw new MilitaryError('CONTEXT_POLICY_INVALID', 'compaction attempt must be raised at or beyond a valid threshold')
    }
    if (!Object.values(attempt.safeBoundary).every(Boolean)) throw new MilitaryError('COMPACTION_ATTEMPT_FAILED', 'unsafe compaction boundary')
    if (attempt.outcome !== 'PENDING') throw new MilitaryError('INVALID_ARGUMENT', 'new compaction attempt must be PENDING')
    this.#attempts.set(attempt.attemptId, cloneFrozen(attempt))
  }

  async complete(attempt: CompactionAttempt): Promise<void> {
    const existing = this.#attempts.get(attempt.attemptId)
    if (existing === undefined) throw new MilitaryError('NOT_FOUND')
    if (existing.outcome !== 'PENDING') {
      if (stableJson(existing) !== stableJson(attempt)) throw new MilitaryError('REVISION_CONFLICT')
      return
    }
    if (attempt.outcome === 'PENDING') throw new MilitaryError('INVALID_ARGUMENT', 'completion must be terminal')
    this.#attempts.set(attempt.attemptId, cloneFrozen(attempt))
  }

  async get(attemptId: string): Promise<CompactionAttempt> {
    const attempt = this.#attempts.get(attemptId)
    if (attempt === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(attempt)
  }
}
