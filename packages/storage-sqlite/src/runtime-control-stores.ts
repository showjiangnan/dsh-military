import type {
  AgentIdentity,
  ModelSelectionReceipt,
  SessionId,
  TacticalSkillId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  type FreezeRecord,
  type GeneralModelSelectionStore,
  type OversightRecordStore,
  type TacticalProcedure,
  type TacticalProcedureStore,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

/** Durable per-Session General model selection receipt store. */
export class SqliteGeneralModelSelectionStore implements GeneralModelSelectionStore {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  get(sessionId: SessionId): ModelSelectionReceipt | undefined {
    return this.#records.readSync<ModelSelectionReceipt>('general-model-selection', String(sessionId)) ?? undefined
  }

  put(sessionId: SessionId, receipt: ModelSelectionReceipt): void {
    this.#records.putSync('general-model-selection', String(sessionId), cloneFrozen(receipt))
  }
}

/** Durable freeze/release/termination records used by admission interlocks. */
export class SqliteOversightRecordStore implements OversightRecordStore {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  get(agent: AgentIdentity): FreezeRecord | undefined {
    return this.#records.readSync<FreezeRecord>('oversight-record', agentKey(agent)) ?? undefined
  }

  put(agent: AgentIdentity, record: FreezeRecord): void {
    this.#records.putSync('oversight-record', agentKey(agent), cloneFrozen(record))
  }
}

/** Durable private tactic versions used by Staff retrieval. */
export class SqliteTacticalProcedureStore implements TacticalProcedureStore {
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  versions(skillId: TacticalSkillId): readonly TacticalProcedure[] {
    return this.#records.readSync<readonly TacticalProcedure[]>('tactical-procedure', String(skillId)) ?? []
  }

  replace(skillId: TacticalSkillId, versions: readonly TacticalProcedure[]): void {
    this.#records.putSync('tactical-procedure', String(skillId), cloneFrozen([...versions]))
  }

  all(): readonly TacticalProcedure[] {
    return cloneFrozen(this.#records
      .listSync<readonly TacticalProcedure[]>('tactical-procedure')
      .flatMap(versions => versions))
  }
}

function agentKey(agent: AgentIdentity): string {
  return `${String(agent.agentId)}@${agent.generation}`
}
