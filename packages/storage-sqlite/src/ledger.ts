import {
  MilitaryError,
  type AgentIdentity,
  type AppendReceipt,
  type EventId,
  type MilitaryAdministrativeEvent,
  type MilitaryAdministrativeLedger,
  type MilitaryLedger,
  type MissionCommand,
  type MissionCommandReceipt,
  type MissionEvent,
  type MissionId,
  type MissionSnapshot,
  type Revision,
  type TaskId,
  brand,
} from '@dsh-military/contracts'
import {
  asRevision,
  cloneFrozen,
  reduceTaskEvent,
  sha256,
  stableJson,
  type ReducedTask,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

interface StreamRow { readonly aggregate_revision: number; readonly last_seq: number }
interface EventRow {
  readonly seq: number
  readonly aggregate_revision: number
  readonly event_id: string
  readonly event_type: string
  readonly schema_version: string
  readonly actor_json: string
  readonly payload_json: string
  readonly causation_id: string | null
  readonly correlation_id: string | null
  readonly idempotency_key: string | null
  readonly occurred_at: string
}

interface MissionCommandOperationRow {
  readonly payload_sha256: string
  readonly command_fingerprint: string
  readonly command_id: string
  readonly expected_revision: number
  readonly previous_seq: number
  readonly state:
    | 'PENDING_EFFECT'
    | 'RETRYABLE'
    | 'EFFECT_APPLIED'
    | 'COMMITTED'
  readonly lease_owner: string | null
  readonly lease_version: number
  readonly lease_until: string | null
  readonly result_json: string | null
  readonly created_at: string
}

export class SqliteMilitaryLedger implements MilitaryLedger {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #listeners = new Map<string, Set<(event: MissionEvent) => void>>()

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async append(event: MissionEvent, expectedRevision?: Revision): Promise<AppendReceipt> {
    return this.#database.transaction(() =>
      this.#appendSync(event, expectedRevision).receipt)
  }

  async transactCommand<T>(
    command: MissionCommand,
    admissionEvent: MissionEvent,
    operation: () => Promise<T>,
  ): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }> {
    if (command.tenantId !== this.#tenantId) {
      throw new MilitaryError('UNAUTHORIZED', 'Mission command tenant does not match the ledger tenant')
    }
    if (String(admissionEvent.missionId) !== String(command.missionId)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'command admission event belongs to another mission')
    }
    const missionId = String(command.missionId)
    const fingerprint = commandFingerprint(command)
    const admission = this.#database.transaction(() => {
      const receiptRow = this.#receiptRow(
        missionId,
        command.idempotencyKey,
      )
      if (receiptRow !== undefined) {
        this.#assertCommandPayload(receiptRow.payload_sha256, command)
        const operationRow = this.#operationRow(
          missionId,
          command.idempotencyKey,
        )
        if (operationRow !== undefined) {
          this.#assertCommandOperation(operationRow, command, fingerprint)
        }
        return {
          receipt: {
            receipt: cloneFrozen({
              ...JSON.parse(receiptRow.receipt_json) as MissionCommandReceipt,
              duplicate: true,
            }),
            value: decodeCommandResult<T>(receiptRow.result_json),
          },
          operation: undefined,
          effectRequired: false,
        }
      }

      const now = new Date()
      const leaseUntil = new Date(now.getTime() + 30_000).toISOString()
      let stored = this.#operationRow(missionId, command.idempotencyKey)
      if (stored === undefined) {
        const activeCommand = this.#database.db.prepare(`
          SELECT idempotency_key, state, lease_until
          FROM mission_command_operations
          WHERE tenant_id = ? AND mission_id = ?
            AND idempotency_key <> ?
            AND state <> 'COMMITTED'
          ORDER BY created_at, idempotency_key
          LIMIT 1
        `).get(
          this.#tenantId,
          missionId,
          command.idempotencyKey,
        ) as {
          readonly idempotency_key: string
          readonly state: string
          readonly lease_until: string | null
        } | undefined
        if (activeCommand !== undefined) {
          throw new MilitaryError(
            'RESOURCE_LOCKED',
            'another durable command must settle before this mission can advance',
            {
              blockingIdempotencyKey: activeCommand.idempotency_key,
              blockingState: activeCommand.state,
              retryAfter: activeCommand.lease_until,
            },
          )
        }
        const before = this.#database.db.prepare(`
          SELECT aggregate_revision, last_seq
          FROM mission_streams
          WHERE tenant_id = ? AND mission_id = ?
        `).get(this.#tenantId, missionId) as StreamRow | undefined
        const previousRevision = before?.aggregate_revision ?? 0
        const previousSeq = before?.last_seq ?? 0
        if (previousRevision !== Number(command.expectedRevision)) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            'mission command revision conflict',
            {
              expectedRevision: Number(command.expectedRevision),
              actualRevision: previousRevision,
            },
          )
        }
        this.#appendSync(admissionEvent, command.expectedRevision)
        this.#database.db.prepare(`
          INSERT INTO mission_command_operations(
            tenant_id, mission_id, idempotency_key, payload_sha256,
            command_fingerprint, command_id, expected_revision, previous_seq,
            state, lease_owner, lease_version, lease_until, result_json,
            last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_EFFECT', ?, 1, ?,
            NULL, NULL, ?, ?)
        `).run(
          this.#tenantId,
          missionId,
          command.idempotencyKey,
          String(command.payloadSha256),
          fingerprint,
          String(command.commandId),
          previousRevision,
          previousSeq,
          String(command.commandId),
          leaseUntil,
          String(command.createdAt),
          now.toISOString(),
        )
        stored = this.#operationRow(missionId, command.idempotencyKey)
      } else {
        this.#assertCommandOperation(stored, command, fingerprint)
        if (stored.state === 'COMMITTED') {
          throw new MilitaryError(
            'PERSISTENCE_FAILED',
            'command operation is COMMITTED without its canonical receipt',
          )
        }
        if (stored.state === 'PENDING_EFFECT') {
          const held = stored.lease_owner !== null
            && stored.lease_until !== null
            && Date.parse(stored.lease_until) > now.getTime()
          if (held) {
            throw new MilitaryError(
              'RESOURCE_LOCKED',
              'mission command effect is leased by another recovery worker',
              { retryAfter: stored.lease_until },
            )
          }
        }
        if (
          stored.state === 'RETRYABLE'
          || stored.state === 'PENDING_EFFECT'
        ) {
          const changed = this.#database.db.prepare(`
            UPDATE mission_command_operations
            SET state = 'PENDING_EFFECT', lease_owner = ?,
              lease_version = lease_version + 1, lease_until = ?,
              last_error = NULL, updated_at = ?
            WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
              AND lease_version = ?
          `).run(
            String(command.commandId),
            leaseUntil,
            now.toISOString(),
            this.#tenantId,
            missionId,
            command.idempotencyKey,
            stored.lease_version,
          )
          if (Number(changed.changes) !== 1) {
            throw new MilitaryError('REVISION_CONFLICT')
          }
          stored = this.#operationRow(missionId, command.idempotencyKey)
        }
      }
      if (stored === undefined) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'mission command operation was not persisted',
        )
      }
      return {
        receipt: undefined,
        operation: stored,
        effectRequired: stored.state !== 'EFFECT_APPLIED',
      }
    })
    if (admission.receipt !== undefined) return admission.receipt
    let stored = admission.operation
    if (stored === undefined) {
      throw new MilitaryError('PERSISTENCE_FAILED')
    }

    if (admission.effectRequired) {
      try {
        const value = await operation()
        const encoded = encodeCommandResult(value)
        stored = this.#database.transaction(() => {
          const current = this.#operationRow(
            missionId,
            command.idempotencyKey,
          )
          if (
            current === undefined
            || current.state !== 'PENDING_EFFECT'
            || current.lease_owner !== String(command.commandId)
          ) {
            throw new MilitaryError(
              'REVISION_CONFLICT',
              'mission command effect lease was lost before checkpoint',
            )
          }
          const changed = this.#database.db.prepare(`
            UPDATE mission_command_operations
            SET state = 'EFFECT_APPLIED', result_json = ?,
              lease_owner = NULL, lease_until = NULL, updated_at = ?
            WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
              AND state = 'PENDING_EFFECT' AND lease_owner = ?
              AND lease_version = ?
          `).run(
            encoded,
            new Date().toISOString(),
            this.#tenantId,
            missionId,
            command.idempotencyKey,
            String(command.commandId),
            current.lease_version,
          )
          if (Number(changed.changes) !== 1) {
            throw new MilitaryError('REVISION_CONFLICT')
          }
          return this.#operationRow(
            missionId,
            command.idempotencyKey,
          )!
        })
      } catch (error) {
        this.#database.transaction(() => {
          const current = this.#operationRow(
            missionId,
            command.idempotencyKey,
          )
          if (
            current?.state === 'PENDING_EFFECT'
            && current.lease_owner === String(command.commandId)
          ) {
            this.#database.db.prepare(`
              UPDATE mission_command_operations
              SET state = 'RETRYABLE', lease_owner = NULL,
                lease_until = NULL, last_error = ?, updated_at = ?
              WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
                AND state = 'PENDING_EFFECT' AND lease_owner = ?
            `).run(
              boundedError(error),
              new Date().toISOString(),
              this.#tenantId,
              missionId,
              command.idempotencyKey,
              String(command.commandId),
            )
          }
        })
        throw error
      }
    }

    return this.#database.transaction(() => {
      const receiptRow = this.#receiptRow(
        missionId,
        command.idempotencyKey,
      )
      if (receiptRow !== undefined) {
        this.#assertCommandPayload(receiptRow.payload_sha256, command)
        const operationRow = this.#operationRow(
          missionId,
          command.idempotencyKey,
        )
        if (operationRow !== undefined) {
          this.#assertCommandOperation(operationRow, command, fingerprint)
        }
        return {
          receipt: cloneFrozen({
            ...JSON.parse(receiptRow.receipt_json) as MissionCommandReceipt,
            duplicate: true,
          }),
          value: decodeCommandResult<T>(receiptRow.result_json),
        }
      }
      const current = this.#operationRow(
        missionId,
        command.idempotencyKey,
      )
      if (current === undefined || current.state !== 'EFFECT_APPLIED') {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'mission command effect has no durable completion checkpoint',
        )
      }
      if (current.result_json === null) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'mission command effect checkpoint is missing its result envelope',
        )
      }
      const after = this.#database.db.prepare(`
        SELECT aggregate_revision, last_seq
        FROM mission_streams
        WHERE tenant_id = ? AND mission_id = ?
      `).get(this.#tenantId, missionId) as StreamRow | undefined
      if (after === undefined) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'mission stream disappeared before command finalization',
        )
      }
      const eventRows = this.#database.db.prepare(`
        SELECT event_id
        FROM mission_events
        WHERE tenant_id = ? AND mission_id = ? AND seq > ? AND seq <= ?
        ORDER BY seq
      `).all(
        this.#tenantId,
        missionId,
        current.previous_seq,
        after.last_seq,
      ) as unknown as Array<{ readonly event_id: string }>
      const outbox = this.#database.db.prepare(`
        INSERT INTO transactional_outbox(
          tenant_id, topic, partition_key, event_id, payload_json,
          available_at, claimed_by, claimed_until, delivered_at, attempts
        ) VALUES (?, 'mission-command.committed', ?, ?, '{}', ?, NULL, NULL,
          NULL, 0)
      `).run(
        this.#tenantId,
        missionId,
        current.command_id,
        new Date().toISOString(),
      )
      const activityId = `outbox:${String(outbox.lastInsertRowid)}`
      const receiptValue: MissionCommandReceipt = cloneFrozen({
        commandId: current.command_id,
        missionId: command.missionId,
        previousRevision: asRevision(current.expected_revision),
        revision: asRevision(after.aggregate_revision),
        eventIds: eventRows.map(row => row.event_id),
        activityIds: [activityId],
        duplicate: false,
      })
      this.#database.db.prepare(`
        INSERT INTO mission_command_receipts(
          tenant_id, mission_id, idempotency_key, payload_sha256, command_id,
          previous_revision, revision, receipt_json, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.#tenantId,
        missionId,
        command.idempotencyKey,
        current.payload_sha256,
        current.command_id,
        current.expected_revision,
        after.aggregate_revision,
        stableJson(receiptValue),
        current.result_json,
        current.created_at,
      )
      this.#database.db.prepare(`
        UPDATE transactional_outbox SET payload_json = ? WHERE outbox_id = ?
      `).run(stableJson({
        commandId: current.command_id,
        missionId,
        idempotencyKey: command.idempotencyKey,
        payloadSha256: current.payload_sha256,
        receipt: receiptValue,
      }), outbox.lastInsertRowid)
      const committed = this.#database.db.prepare(`
        UPDATE mission_command_operations
        SET state = 'COMMITTED', updated_at = ?
        WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
          AND state = 'EFFECT_APPLIED'
      `).run(
        new Date().toISOString(),
        this.#tenantId,
        missionId,
        command.idempotencyKey,
      )
      if (Number(committed.changes) !== 1) {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          'mission command operation lost its finalization fence',
        )
      }
      return {
        receipt: receiptValue,
        value: decodeCommandResult<T>(current.result_json),
      }
    })
  }

  #appendSync(
    event: MissionEvent,
    expectedRevision?: Revision,
  ): {
    readonly event: MissionEvent | null
    readonly receipt: AppendReceipt
  } {
    const missionId = String(event.missionId)
    this.#database.db.prepare(`
      INSERT INTO mission_streams(
        tenant_id, mission_id, aggregate_revision, last_seq, status,
        created_at, updated_at
      ) VALUES (?, ?, 0, 0, 'ACTIVE', ?, ?)
      ON CONFLICT(tenant_id, mission_id) DO NOTHING
    `).run(this.#tenantId, missionId, event.timestamp, event.timestamp)
    const stream = this.#database.db.prepare(`
      SELECT aggregate_revision, last_seq
      FROM mission_streams WHERE tenant_id = ? AND mission_id = ?
    `).get(this.#tenantId, missionId) as StreamRow | undefined
    if (stream === undefined) {
      throw new MilitaryError(
        'PERSISTENCE_FAILED',
        'mission stream missing after insert',
      )
    }
    const fingerprint = sha256(stableJson({
      type: event.type,
      actor: event.actor,
      payload: event.payload,
    }))
    if (event.idempotencyKey !== undefined) {
      const existing = this.#database.db.prepare(`
        SELECT seq, aggregate_revision, event_id, event_hash
        FROM mission_events
        WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
      `).get(
        this.#tenantId,
        missionId,
        event.idempotencyKey,
      ) as {
        readonly seq: number
        readonly aggregate_revision: number
        readonly event_id: string
        readonly event_hash: string
      } | undefined
      if (existing !== undefined) {
        if (existing.event_hash !== fingerprint) {
          throw new MilitaryError('IDEMPOTENCY_CONFLICT')
        }
        return {
          event: null,
          receipt: receipt(
            existing.event_id,
            existing.seq,
            existing.aggregate_revision,
          ),
        }
      }
    }
    if (
      expectedRevision !== undefined
      && stream.aggregate_revision !== Number(expectedRevision)
    ) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        'mission revision conflict',
        {
          expectedRevision: Number(expectedRevision),
          actualRevision: stream.aggregate_revision,
        },
      )
    }
    const revision = stream.aggregate_revision + 1
    const seq = stream.last_seq + 1
    const stamped = cloneFrozen({
      ...event,
      seq,
      aggregateRevision: revision,
    }) as MissionEvent
    this.#database.db.prepare(`
      INSERT INTO mission_events(
        tenant_id, mission_id, seq, aggregate_revision, event_id, event_type,
        schema_version, actor_json, payload_json, causation_id, correlation_id,
        idempotency_key, occurred_at, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.#tenantId,
      missionId,
      seq,
      revision,
      stamped.eventId,
      stamped.type,
      stamped.schemaVersion,
      stableJson(stamped.actor),
      stableJson(stamped.payload),
      stamped.causationId ?? null,
      stamped.correlationId ?? null,
      stamped.idempotencyKey ?? null,
      stamped.timestamp,
      fingerprint,
    )
    const update = this.#database.db.prepare(`
      UPDATE mission_streams
      SET aggregate_revision = ?, last_seq = ?, updated_at = ?
      WHERE tenant_id = ? AND mission_id = ? AND aggregate_revision = ?
    `).run(
      revision,
      seq,
      stamped.timestamp,
      this.#tenantId,
      missionId,
      stream.aggregate_revision,
    )
    if (Number(update.changes) !== 1) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        'mission stream CAS failed',
      )
    }
    this.#database.afterCommit(() => {
      for (const listener of [
        ...(this.#listeners.get(missionId) ?? []),
      ]) listener(stamped)
    })
    return {
      event: stamped,
      receipt: receipt(stamped.eventId, seq, revision),
    }
  }

  #receiptRow(
    missionId: string,
    idempotencyKey: string,
  ): {
    readonly payload_sha256: string
    readonly receipt_json: string
    readonly result_json: string | null
  } | undefined {
    return this.#database.db.prepare(`
      SELECT payload_sha256, receipt_json, result_json
      FROM mission_command_receipts
      WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
    `).get(
      this.#tenantId,
      missionId,
      idempotencyKey,
    ) as {
      readonly payload_sha256: string
      readonly receipt_json: string
      readonly result_json: string | null
    } | undefined
  }

  #operationRow(
    missionId: string,
    idempotencyKey: string,
  ): MissionCommandOperationRow | undefined {
    return this.#database.db.prepare(`
      SELECT payload_sha256, command_fingerprint, command_id,
        expected_revision, previous_seq, state, lease_owner, lease_version,
        lease_until, result_json, created_at
      FROM mission_command_operations
      WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
    `).get(
      this.#tenantId,
      missionId,
      idempotencyKey,
    ) as MissionCommandOperationRow | undefined
  }

  #assertCommandPayload(
    payloadSha256: string,
    command: MissionCommand,
  ): void {
    if (payloadSha256 !== String(command.payloadSha256)) {
      throw new MilitaryError(
        'IDEMPOTENCY_CONFLICT',
        'idempotency key was reused with a different payload',
      )
    }
  }

  #assertCommandOperation(
    stored: MissionCommandOperationRow,
    command: MissionCommand,
    fingerprint: string,
  ): void {
    this.#assertCommandPayload(stored.payload_sha256, command)
    if (stored.command_fingerprint !== fingerprint) {
      throw new MilitaryError(
        'IDEMPOTENCY_CONFLICT',
        'idempotent command authority or semantic fields changed',
      )
    }
  }

  async readMission(missionId: MissionId): Promise<MissionSnapshot> {
    const events = await this.readEvents(missionId)
    const stream = this.#database.db.prepare(
      'SELECT aggregate_revision FROM mission_streams WHERE tenant_id = ? AND mission_id = ?',
    ).get(this.#tenantId, String(missionId)) as { aggregate_revision: number } | undefined
    return foldMission(missionId, stream?.aggregate_revision ?? 0, events)
  }

  async readEvents(missionId: MissionId, afterSeq = 0): Promise<readonly MissionEvent[]> {
    const rows = this.#database.db.prepare(`
      SELECT seq, aggregate_revision, event_id, event_type, schema_version, actor_json,
             payload_json, causation_id, correlation_id, idempotency_key, occurred_at
      FROM mission_events
      WHERE tenant_id = ? AND mission_id = ? AND seq > ? ORDER BY seq
    `).all(this.#tenantId, String(missionId), afterSeq) as unknown as EventRow[]
    return cloneFrozen(rows.map(row => ({
      schemaVersion: row.schema_version,
      eventId: row.event_id,
      missionId: String(missionId),
      seq: row.seq,
      aggregateRevision: row.aggregate_revision,
      type: row.event_type,
      timestamp: row.occurred_at,
      actor: JSON.parse(row.actor_json),
      ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
      ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
      ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
      payload: JSON.parse(row.payload_json),
    }) as MissionEvent))
  }

  async findMissionByRootSession(rootSessionId: import('@dsh-military/contracts').SessionId): Promise<{ readonly missionId: MissionId; readonly general: AgentIdentity } | null> {
    const rows = this.#database.db.prepare(`
      SELECT mission_id, actor_json, payload_json
      FROM mission_events
      WHERE tenant_id = ? AND event_type = 'mission/started'
      ORDER BY occurred_at DESC, seq DESC
    `).all(this.#tenantId) as unknown as Array<{ mission_id: string; actor_json: string; payload_json: string }>
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as { rootSessionId?: unknown }
      if (payload.rootSessionId !== String(rootSessionId)) continue
      return cloneFrozen({
        missionId: brand<string, 'MissionId'>(row.mission_id),
        general: JSON.parse(row.actor_json) as AgentIdentity,
      })
    }
    return null
  }

  subscribe(missionId: MissionId, listener: (event: MissionEvent) => void): () => void {
    const key = String(missionId)
    const listeners = this.#listeners.get(key) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(key, listeners)
    return () => { listeners.delete(listener) }
  }
}

interface CommandResultEnvelope {
  readonly present: boolean
  readonly value?: unknown
}

function encodeCommandResult(value: unknown): string {
  return stableJson(value === undefined
    ? { present: false }
    : { present: true, value } satisfies CommandResultEnvelope)
}

function decodeCommandResult<T>(source: string | null): T {
  if (source === null) return undefined as T
  const envelope = JSON.parse(source) as CommandResultEnvelope
  return cloneFrozen(envelope.present ? envelope.value : undefined) as T
}

function commandFingerprint(command: MissionCommand): string {
  const {
    commandId: _commandId,
    expectedRevision: _expectedRevision,
    createdAt: _createdAt,
    deadlineAt: _deadlineAt,
    ...semantic
  } = command
  return sha256(stableJson(semantic))
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
  // Provider errors can contain credentials, request bodies, and absolute
  // paths. Persist only a stable diagnostic category and fingerprint.
  return `${category};fingerprint=${sha256(privateDetail).slice(0, 24)}`
}

export class SqliteAdministrativeLedger implements MilitaryAdministrativeLedger {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #listeners = new Set<(event: MilitaryAdministrativeEvent) => void>()

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async append(event: MilitaryAdministrativeEvent, expectedRevision?: Revision): Promise<AppendReceipt> {
    return this.#database.transaction(() => {
      this.#database.db.prepare(`
        INSERT INTO administrative_streams(tenant_id, aggregate_revision, last_seq, updated_at)
        VALUES (?, 0, 0, ?) ON CONFLICT(tenant_id) DO NOTHING
      `).run(this.#tenantId, event.timestamp)
      const stream = this.#database.db.prepare(
        'SELECT aggregate_revision, last_seq FROM administrative_streams WHERE tenant_id = ?',
      ).get(this.#tenantId) as StreamRow | undefined
      if (stream === undefined) throw new MilitaryError('PERSISTENCE_FAILED')
      const fingerprint = sha256(stableJson({ type: event.type, actorId: event.actorId, payload: event.payload }))
      if (event.idempotencyKey !== undefined) {
        const existing = this.#database.db.prepare(`
          SELECT seq, aggregate_revision, event_id, event_hash FROM administrative_events
          WHERE tenant_id = ? AND idempotency_key = ?
        `).get(this.#tenantId, event.idempotencyKey) as { seq: number; aggregate_revision: number; event_id: string; event_hash: string } | undefined
        if (existing !== undefined) {
          if (existing.event_hash !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return receipt(
            existing.event_id,
            existing.seq,
            existing.aggregate_revision,
          )
        }
      }
      if (expectedRevision !== undefined && stream.aggregate_revision !== Number(expectedRevision)) throw new MilitaryError('REVISION_CONFLICT')
      const seq = stream.last_seq + 1
      const revision = stream.aggregate_revision + 1
      const stamped = cloneFrozen({ ...event, seq, aggregateRevision: revision, tenantId: this.#tenantId })
      this.#database.db.prepare(`
        INSERT INTO administrative_events(
          tenant_id, seq, aggregate_revision, event_id, event_type, schema_version,
          actor_id, payload_json, idempotency_key, occurred_at, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(this.#tenantId, seq, revision, stamped.eventId, stamped.type, stamped.schemaVersion,
        stamped.actorId, stableJson(stamped.payload), stamped.idempotencyKey ?? null, stamped.timestamp, fingerprint)
      const update = this.#database.db.prepare(`
        UPDATE administrative_streams SET aggregate_revision = ?, last_seq = ?, updated_at = ?
        WHERE tenant_id = ? AND aggregate_revision = ?
      `).run(revision, seq, stamped.timestamp, this.#tenantId, stream.aggregate_revision)
      if (Number(update.changes) !== 1) throw new MilitaryError('REVISION_CONFLICT', 'administrative stream CAS failed')
      const stored = {
        event: stamped as MilitaryAdministrativeEvent,
        receipt: receipt(stamped.eventId, seq, revision),
      }
      this.#database.afterCommit(() => {
        for (const listener of [...this.#listeners]) listener(stored.event)
      })
      return stored.receipt
    })
  }

  async read(afterSeq = 0): Promise<readonly MilitaryAdministrativeEvent[]> {
    const rows = this.#database.db.prepare(`
      SELECT seq, aggregate_revision, event_id, event_type, schema_version, actor_id,
             payload_json, idempotency_key, occurred_at
      FROM administrative_events WHERE tenant_id = ? AND seq > ? ORDER BY seq
    `).all(this.#tenantId, afterSeq) as unknown as Array<{
      seq: number; aggregate_revision: number; event_id: string; event_type: string; schema_version: string;
      actor_id: string; payload_json: string; idempotency_key: string | null; occurred_at: string
    }>
    return cloneFrozen(rows.map(row => ({
      schemaVersion: row.schema_version,
      eventId: row.event_id,
      seq: row.seq,
      aggregateRevision: row.aggregate_revision,
      type: row.event_type,
      timestamp: row.occurred_at,
      actorId: row.actor_id,
      tenantId: this.#tenantId,
      ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
      payload: JSON.parse(row.payload_json),
    }) as MilitaryAdministrativeEvent))
  }

  subscribe(listener: (event: MilitaryAdministrativeEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}

function receipt(eventId: string, seq: number, revision: number): AppendReceipt {
  return cloneFrozen({
    eventId: brand<string, 'EventId'>(eventId) as EventId,
    seq,
    revision: asRevision(revision),
  })
}

function foldMission(missionId: MissionId, revision: number, events: readonly MissionEvent[]): MissionSnapshot {
  const tasks = new Map<TaskId, ReducedTask>()
  const activeWaves = new Set<string>()
  for (const event of events) {
    if (event.type === 'wave/opened') activeWaves.add(event.payload.waveId)
    else if (event.type === 'wave/barrier-satisfied') activeWaves.delete(event.payload.waveId)
    reduceTaskEvent(tasks, event)
  }
  return cloneFrozen({ missionId, revision: asRevision(revision), activeWaveIds: [...activeWaves].map(id => brand<string, 'WaveId'>(id)), tasks })
}
