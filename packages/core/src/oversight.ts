import { MilitaryError, type AgentIdentity } from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from './util.js'

export interface FreezeRecord {
  readonly freezeId: string
  readonly agent: AgentIdentity
  readonly taskId?: string
  readonly reasonCodes: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly state: 'FROZEN' | 'PAUSED' | 'RELEASED' | 'TERMINATED'
  readonly frozenAt: string
  readonly releasedAt?: string
  readonly correctionOrderRef?: string
}

export interface OversightRecordStore {
  get(agent: AgentIdentity): FreezeRecord | undefined
  put(agent: AgentIdentity, record: FreezeRecord): void
}

export class InMemoryOversightRecordStore implements OversightRecordStore {
  readonly #records = new Map<string, FreezeRecord>()

  get(agent: AgentIdentity): FreezeRecord | undefined {
    const value = this.#records.get(agentKey(agent))
    return value === undefined ? undefined : cloneFrozen(value)
  }

  put(agent: AgentIdentity, record: FreezeRecord): void {
    this.#records.set(agentKey(agent), cloneFrozen(record))
  }
}

export class OversightController {
  readonly #records: OversightRecordStore
  readonly #clock: Clock

  constructor(clockOrOptions?: Clock | {
    readonly clock?: Clock
    readonly records?: OversightRecordStore
  }) {
    const options = typeof clockOrOptions === 'function'
      ? { clock: clockOrOptions }
      : clockOrOptions
    this.#clock = options?.clock ?? (() => new Date())
    this.#records = options?.records ?? new InMemoryOversightRecordStore()
  }

  freeze(input: {
    readonly agent: AgentIdentity
    readonly taskId?: string
    readonly reasonCodes: readonly string[]
    readonly evidenceRefs?: readonly string[]
  }): FreezeRecord {
    const existing = this.#records.get(input.agent)
    if (existing?.state === 'FROZEN') return cloneFrozen(existing)
    if (input.reasonCodes.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'freeze requires reason codes')
    const record = cloneFrozen({
      freezeId: uuid('freeze'),
      agent: input.agent,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      reasonCodes: [...input.reasonCodes],
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      state: 'FROZEN' as const,
      frozenAt: now(this.#clock),
    })
    this.#records.put(input.agent, record)
    return record
  }

  release(agent: AgentIdentity, correctionOrderRef: string): FreezeRecord {
    const record = this.#records.get(agent)
    if (record === undefined || record.state !== 'FROZEN') throw new MilitaryError('NOT_FOUND', 'agent is not frozen')
    if (correctionOrderRef.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT')
    const released = cloneFrozen({
      ...record,
      state: 'RELEASED' as const,
      releasedAt: now(this.#clock),
      correctionOrderRef,
    })
    this.#records.put(agent, released)
    return released
  }

  terminate(agent: AgentIdentity, reason: string): FreezeRecord {
    const record = this.#records.get(agent) ?? this.freeze({ agent, reasonCodes: [reason] })
    const terminated = cloneFrozen({ ...record, state: 'TERMINATED' as const })
    this.#records.put(agent, terminated)
    return terminated
  }

  /**
   * Record a transient execution stop without permanently poisoning the
   * stable General identity or a future Task Attempt.
   */
  pause(agent: AgentIdentity, reason: string): FreezeRecord {
    const existing = this.#records.get(agent)
    if (existing?.state === 'TERMINATED') return cloneFrozen(existing)
    const record = cloneFrozen({
      freezeId: existing?.freezeId ?? uuid('pause'),
      agent,
      reasonCodes: [...new Set([
        ...(existing?.reasonCodes ?? []),
        reason,
      ])],
      evidenceRefs: [...(existing?.evidenceRefs ?? [])],
      state: 'PAUSED' as const,
      frozenAt: existing?.frozenAt ?? now(this.#clock),
    })
    this.#records.put(agent, record)
    return record
  }

  requireAdmission(agent: AgentIdentity): void {
    const record = this.#records.get(agent)
    if (record?.state === 'FROZEN' || record?.state === 'TERMINATED') {
      throw new MilitaryError('POLICY_DENIED', `agent is ${record.state.toLowerCase()}`, { freezeId: record.freezeId })
    }
  }

  isFrozen(agent: AgentIdentity): boolean {
    return this.#records.get(agent)?.state === 'FROZEN'
  }

  record(agent: AgentIdentity): FreezeRecord | undefined {
    return this.#records.get(agent)
  }
}

function agentKey(agent: AgentIdentity): string { return `${String(agent.agentId)}@${agent.generation}` }
