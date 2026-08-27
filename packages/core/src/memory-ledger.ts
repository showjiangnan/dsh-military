import {
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
  type Sha256,
  type TaskId,
  brand,
} from '@dsh-military/contracts'
import { MilitaryError } from '@dsh-military/contracts'
import { asRevision, assertRevision, cloneFrozen, now, stableJson, uuid, type Clock } from './util.js'
import { reduceTaskEvent, type ReducedTask } from './task-reducer.js'

interface MissionBucket {
  revision: number
  events: MissionEvent[]
  idempotency: Map<string, { fingerprint: string; receipt: AppendReceipt }>
  commandReceipts: Map<string, {
    payloadSha256: Sha256
    receipt: MissionCommandReceipt
    value: unknown
  }>
  listeners: Set<(event: MissionEvent) => void>
}

interface AdministrativeBucket {
  revision: number
  events: MilitaryAdministrativeEvent[]
  idempotency: Map<string, { fingerprint: string; receipt: AppendReceipt }>
  listeners: Set<(event: MilitaryAdministrativeEvent) => void>
}

export class InMemoryMilitaryLedger implements MilitaryLedger {
  readonly #missions = new Map<string, MissionBucket>()
  readonly #transactions = new Map<string, MissionEvent[]>()
  readonly #clock: Clock

  constructor(clock?: Clock) {
    this.#clock = clock ?? (() => new Date())
  }

  async append(event: MissionEvent, expectedRevision?: Revision): Promise<AppendReceipt> {
    const missionId = String(event.missionId)
    const bucket = this.#missions.get(missionId) ?? this.#createMission(missionId)
    const fingerprint = stableJson({ type: event.type, payload: event.payload, actor: event.actor })
    if (event.idempotencyKey !== undefined) {
      const existing = bucket.idempotency.get(event.idempotencyKey)
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          throw new MilitaryError('IDEMPOTENCY_CONFLICT', 'idempotency key already refers to different event content', {
            idempotencyKey: event.idempotencyKey,
          })
        }
        return existing.receipt
      }
    }
    assertRevision(bucket.revision, expectedRevision)

    const revision = bucket.revision + 1
    const seq = bucket.events.length + 1
    const stored = cloneFrozen({
      ...event,
      schemaVersion: '2.0.0',
      eventId: event.eventId || uuid('evt'),
      seq,
      aggregateRevision: revision,
      timestamp: event.timestamp || now(this.#clock),
    } as MissionEvent)
    const receipt = cloneFrozen({
      eventId: brand<string, 'EventId'>(stored.eventId) as EventId,
      seq,
      revision: asRevision(revision),
    })
    bucket.events.push(stored)
    bucket.revision = revision
    if (stored.idempotencyKey !== undefined) {
      bucket.idempotency.set(stored.idempotencyKey, { fingerprint, receipt })
    }
    const transactionEvents = this.#transactions.get(missionId)
    if (transactionEvents === undefined) {
      for (const listener of [...bucket.listeners]) listener(stored)
    } else {
      transactionEvents.push(stored)
    }
    return receipt
  }

  async transactCommand<T>(
    command: MissionCommand,
    admissionEvent: MissionEvent,
    operation: () => Promise<T>,
  ): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }> {
    const missionId = String(command.missionId)
    if (String(admissionEvent.missionId) !== missionId) {
      throw new MilitaryError('INVALID_ARGUMENT', 'command admission event belongs to another mission')
    }
    const bucket = this.#missions.get(missionId) ?? this.#createMission(missionId)
    const commandKey = `${command.tenantId}:${command.idempotencyKey}`
    const prior = bucket.commandReceipts.get(commandKey)
    if (prior !== undefined) {
      if (String(prior.payloadSha256) !== String(command.payloadSha256)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT', 'idempotency key was reused with a different payload')
      }
      return {
        receipt: cloneFrozen({ ...prior.receipt, duplicate: true }),
        value: cloneFrozen(prior.value) as T,
      }
    }
    assertRevision(bucket.revision, command.expectedRevision)
    if (this.#transactions.has(missionId)) {
      throw new MilitaryError('PERSISTENCE_FAILED', 'nested Mission command transaction is not supported')
    }

    const before = {
      revision: bucket.revision,
      eventCount: bucket.events.length,
      idempotency: new Map(bucket.idempotency),
      commandReceipts: new Map(bucket.commandReceipts),
    }
    const deferred: MissionEvent[] = []
    this.#transactions.set(missionId, deferred)
    try {
      await this.append(admissionEvent, command.expectedRevision)
      const value = await operation()
      const committedEvents = bucket.events.slice(before.eventCount)
      const receiptValue: MissionCommandReceipt = cloneFrozen({
        commandId: command.commandId,
        missionId: command.missionId,
        previousRevision: asRevision(before.revision),
        revision: asRevision(bucket.revision),
        eventIds: committedEvents.map(event => String(event.eventId)),
        activityIds: [],
        duplicate: false,
      })
      bucket.commandReceipts.set(commandKey, {
        payloadSha256: command.payloadSha256,
        receipt: receiptValue,
        value: cloneFrozen(value),
      })
      this.#transactions.delete(missionId)
      for (const event of deferred) {
        for (const listener of [...bucket.listeners]) listener(event)
      }
      return { receipt: receiptValue, value }
    } catch (error) {
      bucket.revision = before.revision
      bucket.events.splice(before.eventCount)
      bucket.idempotency = before.idempotency
      bucket.commandReceipts = before.commandReceipts
      this.#transactions.delete(missionId)
      throw error
    }
  }

  async readMission(missionId: MissionId): Promise<MissionSnapshot> {
    const bucket = this.#missions.get(String(missionId))
    const events = bucket?.events ?? []
    const tasks = new Map<TaskId, ReducedTask>()
    const activeWaveIds = new Set<string>()
    for (const event of events) {
      if (event.type === 'wave/opened') activeWaveIds.add(event.payload.waveId)
      else if (event.type === 'wave/barrier-satisfied') activeWaveIds.delete(event.payload.waveId)
      reduceTaskEvent(tasks, event)
    }
    return cloneFrozen({
      missionId,
      revision: asRevision(bucket?.revision ?? 0),
      activeWaveIds: [...activeWaveIds].map(id => brand<string, 'WaveId'>(id)),
      tasks,
    })
  }

  async readEvents(missionId: MissionId, afterSeq = 0): Promise<readonly MissionEvent[]> {
    const events = this.#missions.get(String(missionId))?.events ?? []
    return cloneFrozen(events.filter(event => event.seq > afterSeq))
  }

  async findMissionByRootSession(rootSessionId: import('@dsh-military/contracts').SessionId): Promise<{ readonly missionId: MissionId; readonly general: AgentIdentity } | null> {
    for (const bucket of this.#missions.values()) {
      const start = bucket.events.find(event => event.type === 'mission/started'
        && event.payload.rootSessionId === String(rootSessionId))
      if (start !== undefined) return cloneFrozen({ missionId: brand<string, 'MissionId'>(String(start.missionId)), general: start.actor })
    }
    return null
  }

  subscribe(missionId: MissionId, listener: (event: MissionEvent) => void): () => void {
    const bucket = this.#missions.get(String(missionId)) ?? this.#createMission(String(missionId))
    bucket.listeners.add(listener)
    return () => { bucket.listeners.delete(listener) }
  }

  #createMission(missionId: string): MissionBucket {
    const bucket: MissionBucket = {
      revision: 0,
      events: [],
      idempotency: new Map(),
      commandReceipts: new Map(),
      listeners: new Set(),
    }
    this.#missions.set(missionId, bucket)
    return bucket
  }
}

export class InMemoryAdministrativeLedger implements MilitaryAdministrativeLedger {
  readonly #bucket: AdministrativeBucket = {
    revision: 0,
    events: [],
    idempotency: new Map(),
    listeners: new Set(),
  }
  readonly #clock: Clock

  constructor(clock?: Clock) {
    this.#clock = clock ?? (() => new Date())
  }

  async append(event: MilitaryAdministrativeEvent, expectedRevision?: Revision): Promise<AppendReceipt> {
    const fingerprint = stableJson({ type: event.type, payload: event.payload, actorId: event.actorId, tenantId: event.tenantId })
    if (event.idempotencyKey !== undefined) {
      const existing = this.#bucket.idempotency.get(event.idempotencyKey)
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
        return existing.receipt
      }
    }
    assertRevision(this.#bucket.revision, expectedRevision)
    const revision = this.#bucket.revision + 1
    const seq = this.#bucket.events.length + 1
    const stored = cloneFrozen({
      ...event,
      schemaVersion: '2.0.0',
      eventId: event.eventId || uuid('admin'),
      seq,
      aggregateRevision: revision,
      timestamp: event.timestamp || now(this.#clock),
    } as MilitaryAdministrativeEvent)
    const receipt = cloneFrozen({
      eventId: brand<string, 'EventId'>(stored.eventId) as EventId,
      seq,
      revision: asRevision(revision),
    })
    this.#bucket.events.push(stored)
    this.#bucket.revision = revision
    if (stored.idempotencyKey !== undefined) this.#bucket.idempotency.set(stored.idempotencyKey, { fingerprint, receipt })
    for (const listener of [...this.#bucket.listeners]) listener(stored)
    return receipt
  }

  async read(afterSeq = 0): Promise<readonly MilitaryAdministrativeEvent[]> {
    return cloneFrozen(this.#bucket.events.filter(event => event.seq > afterSeq))
  }

  subscribe(listener: (event: MilitaryAdministrativeEvent) => void): () => void {
    this.#bucket.listeners.add(listener)
    return () => { this.#bucket.listeners.delete(listener) }
  }
}
