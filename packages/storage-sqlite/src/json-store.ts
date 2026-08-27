import { MilitaryError } from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

/** Generic revisioned JSON repository used by policy/template/tag providers. */
export class SqliteVersionedJsonStore<T extends object> {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #kind: string

  constructor(database: SqliteMilitaryDatabase, tenantId: string, kind: string) {
    this.#database = database
    this.#tenantId = tenantId
    this.#kind = kind
  }

  put(id: string, revision: number, status: string, value: T): void {
    try {
      this.#database.db.prepare(`
        INSERT INTO policy_documents(tenant_id, policy_kind, policy_id, revision, status, document_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(this.#tenantId, this.#kind, id, revision, status, stableJson(value), new Date().toISOString())
    } catch (error) {
      throw new MilitaryError('REVISION_CONFLICT', `cannot store ${this.#kind} ${id}@${revision}`, undefined, { cause: error })
    }
  }

  get(id: string, revision?: number): T {
    const row = revision === undefined
      ? this.#database.db.prepare(`
          SELECT document_json FROM policy_documents
          WHERE tenant_id = ? AND policy_kind = ? AND policy_id = ?
          ORDER BY revision DESC LIMIT 1
        `).get(this.#tenantId, this.#kind, id)
      : this.#database.db.prepare(`
          SELECT document_json FROM policy_documents
          WHERE tenant_id = ? AND policy_kind = ? AND policy_id = ? AND revision = ?
        `).get(this.#tenantId, this.#kind, id, revision)
    if (row === undefined) throw new MilitaryError('NOT_FOUND', `unknown ${this.#kind} ${id}${revision === undefined ? '' : `@${revision}`}`)
    return cloneFrozen(JSON.parse((row as { document_json: string }).document_json) as T)
  }

  list(status?: string): readonly T[] {
    const rows = status === undefined
      ? this.#database.db.prepare(`
          SELECT p.document_json FROM policy_documents p
          JOIN (
            SELECT policy_id, MAX(revision) AS revision FROM policy_documents
            WHERE tenant_id = ? AND policy_kind = ? GROUP BY policy_id
          ) latest ON p.policy_id = latest.policy_id AND p.revision = latest.revision
          WHERE p.tenant_id = ? AND p.policy_kind = ? ORDER BY p.policy_id
        `).all(this.#tenantId, this.#kind, this.#tenantId, this.#kind)
      : this.#database.db.prepare(`
          SELECT p.document_json FROM policy_documents p
          JOIN (
            SELECT policy_id, MAX(revision) AS revision FROM policy_documents
            WHERE tenant_id = ? AND policy_kind = ? GROUP BY policy_id
          ) latest ON p.policy_id = latest.policy_id AND p.revision = latest.revision
          WHERE p.tenant_id = ? AND p.policy_kind = ? AND p.status = ? ORDER BY p.policy_id
        `).all(this.#tenantId, this.#kind, this.#tenantId, this.#kind, status)
    return cloneFrozen((rows as unknown as Array<{ document_json: string }>).map(row => JSON.parse(row.document_json) as T))
  }
}
