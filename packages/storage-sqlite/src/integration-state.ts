import {
  MilitaryError,
  type IntegrationOrder,
  type IntegrationReceipt,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

export interface SqliteIntegrationExecutionRecord {
  readonly order: IntegrationOrder
  readonly state: 'QUEUED' | 'RUNNING' | 'DONE'
  readonly startedAt?: IntegrationReceipt['startedAt']
  readonly beforeHead?: string
  readonly stagingPath?: string
  readonly candidateCommit?: string
  readonly candidateTreeHash?: string
  readonly checkReceiptRefs: readonly string[]
  readonly receipt?: IntegrationReceipt
}

function integrationOrderFingerprint(order: IntegrationOrder): string {
  const { createdAt: _createdAt, ...semantic } = order
  return stableJson(semantic)
}

/** Durable CAS state machine for local-main integration execution. */
export class SqliteIntegrationStateStore {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async queue(order: IntegrationOrder): Promise<void> {
    this.#database.transaction(() => {
      const current = this.#read(order.integrationOrderId)
      if (current !== null) {
        if (integrationOrderFingerprint(current.order)
          !== integrationOrderFingerprint(order)) {
          throw new MilitaryError('IDEMPOTENCY_CONFLICT')
        }
        return
      }
      const record: SqliteIntegrationExecutionRecord = {
        order: cloneFrozen(order),
        state: 'QUEUED',
        checkReceiptRefs: [],
      }
      this.#database.db.prepare(`
        INSERT INTO integration_orders(
          tenant_id, integration_order_id, mission_id, task_id, task_version,
          candidate_patch_id, state, expected_head, expected_tree_hash,
          payload_json, repository_marker, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        this.#tenantId,
        order.integrationOrderId,
        order.missionId,
        order.taskId,
        order.taskVersion,
        order.candidatePatchId,
        record.state,
        order.expectedHead,
        order.expectedTreeHash,
        stableJson(record),
        String(order.createdAt),
        String(order.createdAt),
      )
    })
  }

  async read(integrationOrderId: string): Promise<SqliteIntegrationExecutionRecord | null> {
    return cloneFrozen(this.#read(integrationOrderId))
  }

  async acquire(
    integrationOrderId: string,
    startedAt: IntegrationReceipt['startedAt'],
  ): Promise<SqliteIntegrationExecutionRecord> {
    return this.#database.transaction(() => {
      const current = this.#read(integrationOrderId)
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state === 'RUNNING') throw new MilitaryError('RESOURCE_LOCKED')
        if (current.state === 'DONE') return cloneFrozen(current)
        const running = cloneFrozen({ ...current, state: 'RUNNING' as const, startedAt })
      this.#put(running)
      return running
    })
  }

  async checkpoint(
    integrationOrderId: string,
    input: {
      readonly beforeHead?: string
      readonly stagingPath?: string
      readonly candidateCommit?: string
      readonly candidateTreeHash?: string
      readonly checkReceiptRefs?: readonly string[]
    },
  ): Promise<void> {
    this.#database.transaction(() => {
      const current = this.#read(integrationOrderId)
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
      this.#put(cloneFrozen({
        ...current,
        ...(input.beforeHead === undefined ? {} : { beforeHead: input.beforeHead }),
        ...(input.stagingPath === undefined
          ? {}
          : { stagingPath: input.stagingPath }),
        ...(input.candidateCommit === undefined
          ? {}
          : { candidateCommit: input.candidateCommit }),
        ...(input.candidateTreeHash === undefined
          ? {}
          : { candidateTreeHash: input.candidateTreeHash }),
        ...(input.checkReceiptRefs === undefined ? {} : {
          checkReceiptRefs: [...input.checkReceiptRefs],
        }),
      }))
    })
  }

  async complete(integrationOrderId: string, receipt: IntegrationReceipt): Promise<void> {
    this.#database.transaction(() => {
      const current = this.#read(integrationOrderId)
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state === 'DONE') {
          if (stableJson(current.receipt) !== stableJson(receipt)) throw new MilitaryError('REVISION_CONFLICT')
          return
        }
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
      const completed = cloneFrozen({
        ...current,
        state: 'DONE' as const,
        receipt,
      })
      this.#put(completed)
      this.#database.db.prepare(`
        INSERT INTO integration_receipts(
          tenant_id, integration_receipt_id, integration_order_id,
          disposition, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, integration_order_id) DO UPDATE SET
          integration_receipt_id = excluded.integration_receipt_id,
          disposition = excluded.disposition,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at
      `).run(
        this.#tenantId,
        receipt.integrationReceiptId,
        integrationOrderId,
        receipt.disposition,
        stableJson(receipt),
        String(receipt.completedAt),
      )
    })
  }

  async requeue(integrationOrderId: string): Promise<void> {
    this.#database.transaction(() => {
      const current = this.#read(integrationOrderId)
        if (current === null) throw new MilitaryError('NOT_FOUND')
        if (current.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
      this.#put({
        order: current.order,
        state: 'QUEUED',
        checkReceiptRefs: [],
      })
    })
  }

  async running(): Promise<readonly SqliteIntegrationExecutionRecord[]> {
    const rows = this.#database.db.prepare(`
      SELECT payload_json
      FROM integration_orders
      WHERE tenant_id = ? AND state = 'RUNNING'
      ORDER BY created_at, integration_order_id
    `).all(this.#tenantId) as unknown as Array<{ readonly payload_json: string }>
    return cloneFrozen(rows.map(row =>
      JSON.parse(row.payload_json) as SqliteIntegrationExecutionRecord))
  }

  #read(integrationOrderId: string): SqliteIntegrationExecutionRecord | null {
    const row = this.#database.db.prepare(`
      SELECT payload_json
      FROM integration_orders
      WHERE tenant_id = ? AND integration_order_id = ?
    `).get(this.#tenantId, integrationOrderId) as
      | { readonly payload_json: string }
      | undefined
    return row === undefined
      ? null
      : JSON.parse(row.payload_json) as SqliteIntegrationExecutionRecord
  }

  #put(record: SqliteIntegrationExecutionRecord): void {
    const changed = this.#database.db.prepare(`
      UPDATE integration_orders
      SET state = ?, payload_json = ?, repository_marker = ?, updated_at = ?
      WHERE tenant_id = ? AND integration_order_id = ?
    `).run(
      record.state,
      stableJson(record),
      record.beforeHead ?? null,
      new Date().toISOString(),
      this.#tenantId,
      record.order.integrationOrderId,
    )
    if (Number(changed.changes) !== 1) throw new MilitaryError('REVISION_CONFLICT')
  }
}
