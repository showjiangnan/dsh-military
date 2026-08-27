import {
  MilitaryError,
  type IntegrationOrder,
  type IntegrationReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

export interface SqliteIntegrationExecutionRecord {
  readonly order: IntegrationOrder
  readonly state: 'QUEUED' | 'RUNNING' | 'DONE'
  readonly startedAt?: IntegrationReceipt['startedAt']
  readonly beforeHead?: string
  readonly checkReceiptRefs: readonly string[]
  readonly receipt?: IntegrationReceipt
}

function integrationOrderFingerprint(order: IntegrationOrder): string {
  const { createdAt: _createdAt, ...semantic } = order
  return stableJson(semantic)
}

/** Durable CAS state machine for local-main integration execution. */
export class SqliteIntegrationStateStore {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async queue(order: IntegrationOrder): Promise<void> {
    await this.#records.update<SqliteIntegrationExecutionRecord | null, null>(
      'integration-execution',
      order.integrationOrderId,
      () => null,
      current => {
        if (current !== null) {
          if (integrationOrderFingerprint(current.order) !== integrationOrderFingerprint(order)) {
            throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          }
          return { next: current, result: null }
        }
        return {
          next: {
            order: cloneFrozen(order),
            state: 'QUEUED',
            checkReceiptRefs: [],
          },
          result: null,
        }
      },
    )
  }

  async read(integrationOrderId: string): Promise<SqliteIntegrationExecutionRecord | null> {
    return await this.#records.read<SqliteIntegrationExecutionRecord>(
      'integration-execution',
      integrationOrderId,
    )
  }

  async acquire(
    integrationOrderId: string,
    startedAt: IntegrationReceipt['startedAt'],
  ): Promise<SqliteIntegrationExecutionRecord> {
    return await this.#records.update<
      SqliteIntegrationExecutionRecord | null,
      SqliteIntegrationExecutionRecord
    >(
      'integration-execution',
      integrationOrderId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state === 'RUNNING') throw new MilitaryError('RESOURCE_LOCKED')
        if (current.state === 'DONE') return { next: current, result: current }
        const running = cloneFrozen({ ...current, state: 'RUNNING' as const, startedAt })
        return { next: running, result: running }
      },
    )
  }

  async checkpoint(
    integrationOrderId: string,
    input: { readonly beforeHead?: string; readonly checkReceiptRefs?: readonly string[] },
  ): Promise<void> {
    await this.#records.update<SqliteIntegrationExecutionRecord | null, null>(
      'integration-execution',
      integrationOrderId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
        return {
          next: cloneFrozen({
            ...current,
            ...(input.beforeHead === undefined ? {} : { beforeHead: input.beforeHead }),
            ...(input.checkReceiptRefs === undefined ? {} : {
              checkReceiptRefs: [...input.checkReceiptRefs],
            }),
          }),
          result: null,
        }
      },
    )
  }

  async complete(integrationOrderId: string, receipt: IntegrationReceipt): Promise<void> {
    await this.#records.update<SqliteIntegrationExecutionRecord | null, null>(
      'integration-execution',
      integrationOrderId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state === 'DONE') {
          if (stableJson(current.receipt) !== stableJson(receipt)) throw new MilitaryError('REVISION_CONFLICT')
          return { next: current, result: null }
        }
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
        return {
          next: cloneFrozen({ ...current, state: 'DONE' as const, receipt }),
          result: null,
        }
      },
    )
  }

  async requeue(integrationOrderId: string): Promise<void> {
    await this.#records.update<SqliteIntegrationExecutionRecord | null, null>(
      'integration-execution',
      integrationOrderId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
        return {
          next: {
            order: current.order,
            state: 'QUEUED' as const,
            checkReceiptRefs: [],
          },
          result: null,
        }
      },
    )
  }

  async running(): Promise<readonly SqliteIntegrationExecutionRecord[]> {
    return cloneFrozen(this.#records
      .listSync<SqliteIntegrationExecutionRecord>('integration-execution')
      .filter(record => record.state === 'RUNNING'))
  }
}
