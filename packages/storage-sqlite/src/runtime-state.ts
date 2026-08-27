import {
  MilitaryError,
  brand,
  type SessionId,
  type TaskId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  stableJson,
  type MilitaryRuntimeStateStore,
  type RuntimeMissionRecord,
  type RuntimeTaskRecord,
} from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

/** SQLite-backed Mission/Task projection used to resume runtime work after restart. */
export class SqliteMilitaryRuntimeStateStore implements MilitaryRuntimeStateStore {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async getMission(rootSessionId: SessionId): Promise<RuntimeMissionRecord | null> {
    const row = this.#database.db.prepare(`
      SELECT state_json
      FROM mission_runtime_missions
      WHERE tenant_id = ? AND root_session_id = ?
    `).get(this.#tenantId, String(rootSessionId)) as { state_json: string } | undefined
    return row === undefined ? null : cloneFrozen(JSON.parse(row.state_json) as RuntimeMissionRecord)
  }

  async putMission(mission: RuntimeMissionRecord): Promise<void> {
    const encoded = stableJson(mission)
    const current = this.#database.db.prepare(`
      SELECT state_json
      FROM mission_runtime_missions
      WHERE tenant_id = ? AND root_session_id = ?
    `).get(this.#tenantId, String(mission.rootSessionId)) as { state_json: string } | undefined
    if (current !== undefined) {
      if (stableJson(JSON.parse(current.state_json)) !== encoded) {
        throw new MilitaryError('REVISION_CONFLICT', 'root Session is already bound to another Mission runtime projection')
      }
      return
    }
    this.#database.db.prepare(`
      INSERT INTO mission_runtime_missions(
        tenant_id, root_session_id, mission_id, state_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      this.#tenantId,
      String(mission.rootSessionId),
      String(mission.missionId),
      encoded,
      new Date().toISOString(),
    )
  }

  async getTask(taskId: TaskId): Promise<RuntimeTaskRecord | null> {
    const row = this.#database.db.prepare(`
      SELECT state_json
      FROM mission_runtime_tasks
      WHERE tenant_id = ? AND task_id = ?
    `).get(this.#tenantId, String(taskId)) as { state_json: string } | undefined
    return row === undefined ? null : cloneFrozen(JSON.parse(row.state_json) as RuntimeTaskRecord)
  }

  async createTask(task: RuntimeTaskRecord): Promise<void> {
    try {
      this.#database.db.prepare(`
        INSERT INTO mission_runtime_tasks(
          tenant_id, task_id, mission_id, task_version, state, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.#tenantId,
        String(task.order.taskId),
        String(task.order.missionId),
        Number(task.order.taskVersion),
        task.state,
        stableJson(task),
        new Date().toISOString(),
      )
    } catch (error) {
      throw new MilitaryError('REVISION_CONFLICT', `task ${String(task.order.taskId)} already exists`, undefined, { cause: error })
    }
  }

  async putTask(task: RuntimeTaskRecord): Promise<void> {
    const updated = this.#database.db.prepare(`
      UPDATE mission_runtime_tasks
      SET mission_id = ?, task_version = ?, state = ?, state_json = ?, updated_at = ?
      WHERE tenant_id = ? AND task_id = ?
    `).run(
      String(task.order.missionId),
      Number(task.order.taskVersion),
      task.state,
      stableJson(task),
      new Date().toISOString(),
      this.#tenantId,
      String(task.order.taskId),
    )
    if (Number(updated.changes) !== 1) {
      throw new MilitaryError('NOT_FOUND', `unknown task ${String(task.order.taskId)}`)
    }
  }

  async listTasks(): Promise<readonly RuntimeTaskRecord[]> {
    const rows = this.#database.db.prepare(`
      SELECT state_json
      FROM mission_runtime_tasks
      WHERE tenant_id = ?
      ORDER BY task_id
    `).all(this.#tenantId) as unknown as Array<{ state_json: string }>
    return cloneFrozen(rows.map(row => JSON.parse(row.state_json) as RuntimeTaskRecord))
  }

  /** Rebuild a missing projection from a caller-supplied durable record. */
  async restoreTask(record: RuntimeTaskRecord): Promise<void> {
    const taskId = brand<string, 'TaskId'>(String(record.order.taskId))
    if (await this.getTask(taskId) === null) await this.createTask(record)
  }
}
