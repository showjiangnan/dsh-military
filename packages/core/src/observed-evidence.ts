import {
  MilitaryError,
  type MilitaryObservedEvidence,
  type ObservedToolCallReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from './util.js'

/** Test/default observed-evidence provider; production uses SQLite. */
export class InMemoryObservedEvidenceStore implements MilitaryObservedEvidence {
  readonly #toolCalls = new Map<string, ObservedToolCallReceipt>()

  async recordToolCall(receipt: ObservedToolCallReceipt): Promise<void> {
    const existing = this.#toolCalls.get(receipt.callId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(receipt)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    this.#toolCalls.set(receipt.callId, cloneFrozen(receipt))
  }

  async toolCalls(callIds: readonly string[]): Promise<readonly ObservedToolCallReceipt[]> {
    return cloneFrozen(callIds.flatMap(callId => {
      const value = this.#toolCalls.get(callId)
      return value === undefined ? [] : [value]
    }))
  }
}
