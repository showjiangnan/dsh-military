import { MilitaryError } from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

interface StateRow {
  readonly storage_revision: number
  readonly value_json: string
}

/**
 * Small CAS repository for durable service snapshots. Domain providers still
 * own validation; this class owns serialization, revision fencing and atomic
 * replacement on the shared SQLite unit of work.
 */
export class SqliteStateRecords {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async read<T>(namespace: string, key: string): Promise<T | null> {
    const row = this.#row(namespace, key)
    return row === undefined ? null : cloneFrozen(JSON.parse(row.value_json) as T)
  }

  readSync<T>(namespace: string, key: string): T | null {
    const row = this.#row(namespace, key)
    return row === undefined ? null : cloneFrozen(JSON.parse(row.value_json) as T)
  }

  listSync<T>(namespace: string): T[] {
    const rows = this.#database.db.prepare(`
      SELECT value_json
      FROM durable_state_records
      WHERE tenant_id = ? AND namespace = ?
      ORDER BY record_key
    `).all(this.#tenantId, namespace) as unknown as Array<{ value_json: string }>
    return cloneFrozen(rows.map(row => JSON.parse(row.value_json) as T))
  }

  putSync<T>(namespace: string, key: string, value: T, options?: { readonly createOnly?: boolean }): void {
    const current = this.#row(namespace, key)
    if (options?.createOnly === true && current !== undefined) {
      if (stableJson(JSON.parse(current.value_json)) === stableJson(value)) return
      throw new MilitaryError('REVISION_CONFLICT', `${namespace}/${key} already exists`)
    }
    const revision = (current?.storage_revision ?? 0) + 1
    this.#database.db.prepare(`
      INSERT INTO durable_state_records(
        tenant_id, namespace, record_key, storage_revision, value_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, namespace, record_key) DO UPDATE SET
        storage_revision = excluded.storage_revision,
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(
      this.#tenantId,
      namespace,
      key,
      revision,
      stableJson(value),
      new Date().toISOString(),
    )
  }

  deleteSync(namespace: string, key: string): void {
    this.#database.db.prepare(`
      DELETE FROM durable_state_records
      WHERE tenant_id = ? AND namespace = ? AND record_key = ?
    `).run(this.#tenantId, namespace, key)
  }

  async update<T, R>(
    namespace: string,
    key: string,
    initial: () => T,
    mutate: (current: T) => Promise<{ readonly next: T; readonly result: R }> | { readonly next: T; readonly result: R },
  ): Promise<R> {
    return await this.#database.transactionAsync(async () => {
      const row = this.#row(namespace, key)
      const current = row === undefined ? initial() : JSON.parse(row.value_json) as T
      const changed = await mutate(structuredClone(current))
      const revision = (row?.storage_revision ?? 0) + 1
      const write = this.#database.db.prepare(`
        INSERT INTO durable_state_records(
          tenant_id, namespace, record_key, storage_revision, value_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, namespace, record_key) DO UPDATE SET
          storage_revision = excluded.storage_revision,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
        WHERE durable_state_records.storage_revision = ?
      `).run(
        this.#tenantId,
        namespace,
        key,
        revision,
        stableJson(changed.next),
        new Date().toISOString(),
        row?.storage_revision ?? 0,
      )
      if (Number(write.changes) !== 1) {
        throw new MilitaryError('REVISION_CONFLICT', `${namespace}/${key} storage CAS failed`)
      }
      return cloneFrozen(changed.result)
    })
  }

  #row(namespace: string, key: string): StateRow | undefined {
    return this.#database.db.prepare(`
      SELECT storage_revision, value_json
      FROM durable_state_records
      WHERE tenant_id = ? AND namespace = ? AND record_key = ?
    `).get(this.#tenantId, namespace, key) as StateRow | undefined
  }
}
