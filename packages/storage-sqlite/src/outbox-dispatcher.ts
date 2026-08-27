import {
  MilitaryError,
  type DurableQueueHandler,
  type DurableQueueMessage,
  type MilitaryDurableQueue,
} from '@dsh-military/contracts'
import { randomUUID } from 'node:crypto'
import { cloneFrozen, sha256, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

export type TransactionalOutboxMessage = DurableQueueMessage & {
  readonly outboxId: number
}

export type TransactionalOutboxHandler = DurableQueueHandler

interface OutboxRow {
  readonly outbox_id: number
  readonly tenant_id: string
  readonly topic: string
  readonly partition_key: string
  readonly event_id: string
  readonly payload_json: string
  readonly attempts: number
}

/**
 * Claim/effect/ack dispatcher. Claims and acknowledgements are short SQLite
 * transactions; external handlers always run after the claim transaction.
 */
export class SqliteOutboxDispatcher implements MilitaryDurableQueue {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #handlers = new Map<string, DurableQueueHandler>()

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  register(topic: string, handler: DurableQueueHandler): void {
    if (this.#handlers.has(topic)) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        `outbox handler already registered for ${topic}`,
      )
    }
    this.#handlers.set(topic, handler)
  }

  enqueue(input: {
    readonly topic: string
    readonly partitionKey: string
    readonly eventId: string
    readonly payload: unknown
    readonly availableAt?: string
  }): void {
    const encoded = stableJson(input.payload)
    this.#database.transaction(() => {
      const current = this.#database.db.prepare(`
        SELECT partition_key, payload_json
        FROM transactional_outbox
        WHERE tenant_id = ? AND topic = ? AND event_id = ?
      `).get(
        this.#tenantId,
        input.topic,
        input.eventId,
      ) as {
        readonly partition_key: string
        readonly payload_json: string
      } | undefined
      if (current !== undefined) {
        if (current.partition_key !== input.partitionKey
          || stableJson(JSON.parse(current.payload_json)) !== encoded) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            `outbox ${input.topic}/${input.eventId} payload changed`,
          )
        }
        return
      }
      this.#database.db.prepare(`
        INSERT INTO transactional_outbox(
          tenant_id, topic, partition_key, event_id, payload_json,
          available_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.#tenantId,
        input.topic,
        input.partitionKey,
        input.eventId,
        encoded,
        input.availableAt ?? new Date().toISOString(),
      )
    })
  }

  async dispatchAvailable(input?: {
    readonly workerId?: string
    readonly limit?: number
    readonly leaseMs?: number
    readonly maximumAttempts?: number
  }): Promise<{
    readonly delivered: number
    readonly failed: number
    readonly deadLettered: number
    readonly remaining: number
  }> {
    const workerId = input?.workerId
      ?? `outbox-${process.pid}-${randomUUID()}`
    const limit = Math.max(1, Math.min(256, input?.limit ?? 32))
    const leaseMs = Math.max(1_000, input?.leaseMs ?? 30_000)
    const maximumAttempts = Math.max(
      1,
      Math.min(1_000, input?.maximumAttempts ?? 12),
    )
    let delivered = 0
    let failed = 0
    let deadLettered = 0
    for (let index = 0; index < limit; index += 1) {
      const row = this.#claim(workerId, leaseMs)
      if (row === undefined) break
      const handler = this.#handlers.get(row.topic)
      try {
        if (handler === undefined) {
          throw new MilitaryError(
            'NOT_FOUND',
            `no outbox handler for ${row.topic}`,
          )
        }
        const message: TransactionalOutboxMessage = cloneFrozen({
          queueMessageId: String(row.outbox_id),
          outboxId: row.outbox_id,
          tenantId: row.tenant_id,
          topic: row.topic,
          partitionKey: row.partition_key,
          eventId: row.event_id,
          payload: JSON.parse(row.payload_json) as unknown,
          attempts: row.attempts,
        })
        await handler(message)
        this.#ack(row, workerId)
        delivered += 1
      } catch (error) {
        if (row.attempts >= maximumAttempts) {
          this.#deadLetter(row.outbox_id, workerId, row.attempts, error)
          deadLettered += 1
        } else {
          this.#retry(row.outbox_id, workerId, row.attempts, error)
          failed += 1
        }
      }
    }
    const remaining = (this.#database.db.prepare(`
      SELECT count(*) AS count
      FROM transactional_outbox
      WHERE tenant_id = ?
        AND delivered_at IS NULL
        AND dead_lettered_at IS NULL
    `).get(this.#tenantId) as { count: number }).count
    return { delivered, failed, deadLettered, remaining }
  }

  #claim(workerId: string, leaseMs: number): OutboxRow | undefined {
    return this.#database.transaction(() => {
      const now = new Date()
      const row = this.#database.db.prepare(`
        SELECT outbox_id, tenant_id, topic, partition_key, event_id,
               payload_json, attempts
        FROM transactional_outbox AS candidate
        WHERE candidate.tenant_id = ?
          AND candidate.delivered_at IS NULL
          AND candidate.dead_lettered_at IS NULL
          AND candidate.available_at <= ?
          AND (
            candidate.claimed_until IS NULL
            OR candidate.claimed_until <= ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM transactional_outbox AS predecessor
            WHERE predecessor.tenant_id = candidate.tenant_id
              AND predecessor.topic = candidate.topic
              AND predecessor.partition_key = candidate.partition_key
              AND predecessor.outbox_id < candidate.outbox_id
              AND predecessor.delivered_at IS NULL
              AND predecessor.dead_lettered_at IS NULL
          )
        ORDER BY candidate.outbox_id
        LIMIT 1
      `).get(
        this.#tenantId,
        now.toISOString(),
        now.toISOString(),
      ) as OutboxRow | undefined
      if (row === undefined) return undefined
      const claimed = this.#database.db.prepare(`
        UPDATE transactional_outbox
        SET claimed_by = ?, claimed_until = ?, attempts = attempts + 1
        WHERE outbox_id = ?
          AND delivered_at IS NULL
          AND dead_lettered_at IS NULL
          AND (claimed_until IS NULL OR claimed_until <= ?)
      `).run(
        workerId,
        new Date(now.getTime() + leaseMs).toISOString(),
        row.outbox_id,
        now.toISOString(),
      )
      if (Number(claimed.changes) !== 1) return undefined
      return { ...row, attempts: row.attempts + 1 }
    })
  }

  #ack(row: OutboxRow, workerId: string): void {
    this.#database.transaction(() => {
      const deliveredAt = new Date().toISOString()
      const result = this.#database.db.prepare(`
        UPDATE transactional_outbox
        SET delivered_at = ?, claimed_by = NULL, claimed_until = NULL
        WHERE tenant_id = ? AND outbox_id = ? AND claimed_by = ?
          AND attempts = ?
          AND delivered_at IS NULL
          AND dead_lettered_at IS NULL
      `).run(
        deliveredAt,
        this.#tenantId,
        row.outbox_id,
        workerId,
        row.attempts,
      )
      if (Number(result.changes) !== 1) {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          `outbox lease was lost before acknowledgement ${row.outbox_id}`,
        )
      }
      this.#database.db.prepare(`
        INSERT INTO outbox_delivery_receipts(
          tenant_id, outbox_id, topic, partition_key, event_id, attempts,
          delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, outbox_id) DO NOTHING
      `).run(
        this.#tenantId,
        row.outbox_id,
        row.topic,
        row.partition_key,
        row.event_id,
        row.attempts,
        deliveredAt,
      )
      this.#database.db.prepare(`
        INSERT INTO outbox_consumer_offsets(
          tenant_id, topic, partition_key, last_outbox_id, last_event_id,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, topic, partition_key) DO UPDATE SET
          last_outbox_id = CASE
            WHEN excluded.last_outbox_id > outbox_consumer_offsets.last_outbox_id
            THEN excluded.last_outbox_id
            ELSE outbox_consumer_offsets.last_outbox_id
          END,
          last_event_id = CASE
            WHEN excluded.last_outbox_id >= outbox_consumer_offsets.last_outbox_id
            THEN excluded.last_event_id
            ELSE outbox_consumer_offsets.last_event_id
          END,
          updated_at = excluded.updated_at
      `).run(
        this.#tenantId,
        row.topic,
        row.partition_key,
        row.outbox_id,
        row.event_id,
        deliveredAt,
      )
    })
  }

  #retry(
    outboxId: number,
    workerId: string,
    attempts: number,
    error: unknown,
  ): void {
    const delayMs = Math.min(60_000, 250 * (2 ** Math.min(8, attempts)))
    this.#database.transaction(() => {
      const changed = this.#database.db.prepare(`
        UPDATE transactional_outbox
        SET available_at = ?, claimed_by = NULL, claimed_until = NULL,
            last_error = ?
        WHERE tenant_id = ? AND outbox_id = ? AND claimed_by = ?
          AND attempts = ?
          AND delivered_at IS NULL
          AND dead_lettered_at IS NULL
      `).run(
        new Date(Date.now() + delayMs).toISOString(),
        boundedError(error),
        this.#tenantId,
        outboxId,
        workerId,
        attempts,
      )
      if (Number(changed.changes) !== 1) {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          `outbox lease was lost before retry ${outboxId}`,
        )
      }
      this.#database.db.prepare(`
        INSERT INTO durable_state_records(
          tenant_id, namespace, record_key, storage_revision, value_json,
          updated_at
        ) VALUES (?, 'outbox-last-failure', ?, 1, ?, ?)
        ON CONFLICT(tenant_id, namespace, record_key) DO UPDATE SET
          storage_revision = durable_state_records.storage_revision + 1,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(
        this.#tenantId,
        String(outboxId),
        stableJson({
          attempts,
          error: boundedError(error),
        }),
        new Date().toISOString(),
      )
    })
  }

  #deadLetter(
    outboxId: number,
    workerId: string,
    attempts: number,
    error: unknown,
  ): void {
    const timestamp = new Date().toISOString()
    this.#database.transaction(() => {
      const changed = this.#database.db.prepare(`
        UPDATE transactional_outbox
        SET dead_lettered_at = ?, last_error = ?,
            claimed_by = NULL, claimed_until = NULL
        WHERE tenant_id = ? AND outbox_id = ? AND claimed_by = ?
          AND attempts = ?
          AND delivered_at IS NULL
          AND dead_lettered_at IS NULL
      `).run(
        timestamp,
        boundedError(error),
        this.#tenantId,
        outboxId,
        workerId,
        attempts,
      )
      if (Number(changed.changes) !== 1) {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          `outbox lease was lost before dead-letter ${outboxId}`,
        )
      }
      this.#database.db.prepare(`
        INSERT INTO durable_state_records(
          tenant_id, namespace, record_key, storage_revision, value_json,
          updated_at
        ) VALUES (?, 'outbox-dead-letter', ?, 1, ?, ?)
        ON CONFLICT(tenant_id, namespace, record_key) DO UPDATE SET
          storage_revision = durable_state_records.storage_revision + 1,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(
        this.#tenantId,
        String(outboxId),
        stableJson({ attempts, error: boundedError(error), deadLetteredAt: timestamp }),
        timestamp,
      )
    })
  }
}

function boundedError(error: unknown): string {
  const privateDetail = error instanceof MilitaryError
    ? error.failure.message
    : error instanceof Error
      ? error.message
      : String(error)
  const category = error instanceof MilitaryError
    ? `MILITARY_${error.failure.code}`
    : error instanceof Error
      ? error.name.replaceAll(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
      : 'UNKNOWN'
  return `${category};fingerprint=${sha256(privateDetail).slice(0, 24)}`
}
