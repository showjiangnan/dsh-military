export * from './generated-event-catalog.js'

import { isoNow, newId } from './ids.js'
import type {
  AdministrativeEventPayloadMap,
  AdministrativeEventType,
  MilitaryAdministrativeEvent,
  MissionEvent,
  MissionEventPayloadMap,
  MissionEventType,
} from './generated-event-catalog.js'
import type { AgentIdentity, MissionId } from './domain.js'

export interface EventMetadata {
  readonly causationId?: string
  readonly correlationId?: string
  readonly idempotencyKey?: string
}

/** Create an unstamped mission event draft. A ledger replaces seq/revision. */
export function missionEvent<T extends MissionEventType>(input: {
  readonly type: T
  readonly missionId: MissionId
  readonly actor: AgentIdentity
  readonly payload: MissionEventPayloadMap[T]
  readonly metadata?: EventMetadata
}): MissionEvent {
  return Object.freeze({
    schemaVersion: '2.0.0',
    eventId: newId<'EventId'>('evt'),
    missionId: String(input.missionId),
    seq: 0,
    aggregateRevision: 0,
    type: input.type,
    timestamp: isoNow(),
    actor: input.actor,
    payload: structuredClone(input.payload),
    ...(input.metadata?.causationId === undefined ? {} : { causationId: input.metadata.causationId }),
    ...(input.metadata?.correlationId === undefined ? {} : { correlationId: input.metadata.correlationId }),
    ...(input.metadata?.idempotencyKey === undefined ? {} : { idempotencyKey: input.metadata.idempotencyKey }),
  } as MissionEvent)
}

/** Create an unstamped administrative event draft. A ledger replaces seq/revision. */
export function administrativeEvent<T extends AdministrativeEventType>(input: {
  readonly type: T
  readonly actorId: string
  readonly tenantId: string
  readonly payload: AdministrativeEventPayloadMap[T]
  readonly metadata?: EventMetadata
}): MilitaryAdministrativeEvent {
  return Object.freeze({
    schemaVersion: '2.0.0',
    eventId: newId<'EventId'>('admin'),
    seq: 0,
    aggregateRevision: 0,
    type: input.type,
    timestamp: isoNow(),
    actorId: input.actorId,
    tenantId: input.tenantId,
    payload: structuredClone(input.payload),
    ...(input.metadata?.causationId === undefined ? {} : { causationId: input.metadata.causationId }),
    ...(input.metadata?.correlationId === undefined ? {} : { correlationId: input.metadata.correlationId }),
    ...(input.metadata?.idempotencyKey === undefined ? {} : { idempotencyKey: input.metadata.idempotencyKey }),
  } as MilitaryAdministrativeEvent)
}
