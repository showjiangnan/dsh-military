import {
  MilitaryError,
  type MilitaryObservedEvidence,
  type ObservedToolCallReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

/** Durable host-observed tool result receipts used by external verification. */
export class SqliteObservedEvidenceStore implements MilitaryObservedEvidence {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async recordToolCall(receipt: ObservedToolCallReceipt): Promise<void> {
    await this.#records.update<ObservedToolCallReceipt | null, null>(
      'observed-tool-call',
      receipt.callId,
      () => null,
      current => {
        if (current !== null) {
          if (stableJson(current) !== stableJson(receipt)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: current, result: null }
        }
        return { next: cloneFrozen(receipt), result: null }
      },
    )
  }

  async toolCalls(callIds: readonly string[]): Promise<readonly ObservedToolCallReceipt[]> {
    const unique = [...new Set(callIds)]
    const values = await Promise.all(unique.map(callId =>
      this.#records.read<ObservedToolCallReceipt>('observed-tool-call', callId)))
    return cloneFrozen(values.filter((value): value is ObservedToolCallReceipt => value !== null))
  }
}
