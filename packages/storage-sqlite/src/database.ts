import { readFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const moduleDir = dirname(fileURLToPath(import.meta.url))

interface TransactionContext {
  readonly database: SqliteMilitaryDatabase
  readonly afterCommit: Array<() => void>
}

export interface SqliteMilitaryDatabaseOptions {
  readonly path: string
  readonly applyMigrations?: boolean
}

export class SqliteMilitaryDatabase {
  readonly db: DatabaseSync
  readonly #context = new AsyncLocalStorage<TransactionContext>()
  #writeTail: Promise<void> = Promise.resolve()
  #asyncTransactionActive = false

  constructor(options: SqliteMilitaryDatabaseOptions) {
    this.db = new DatabaseSync(options.path)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    if (options.applyMigrations !== false) this.migrate()
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS military_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)
    const migrations = [
      '0001-core.sql',
      '0002-indexes.sql',
      '0003-projections.sql',
      '0004-governance.sql',
      '0005-command-runtime.sql',
      '0006-durable-state.sql',
      '0007-command-results.sql',
      '0008-evaluation-v2.sql',
    ]
    for (const file of migrations) {
      const existing = this.db.prepare('SELECT version FROM military_schema_migrations WHERE version = ?').get(file)
      if (existing !== undefined) continue
      const sourcePath = join(moduleDir, 'migrations', file)
      const fallbackPath = join(moduleDir, '..', 'src', 'migrations', file)
      let sql: string
      try { sql = readFileSync(sourcePath, 'utf8') } catch { sql = readFileSync(fallbackPath, 'utf8') }
      this.transaction(() => {
        this.db.exec(sql)
        this.db.prepare('INSERT INTO military_schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
      })
    }
  }

  transaction<T>(operation: () => T): T {
    const nested = this.#context.getStore()
    if (nested?.database === this) return operation()
    if (this.#asyncTransactionActive) {
      throw new Error('SQLite write attempted outside the active asynchronous transaction')
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      throw error
    }
  }

  /**
   * Serialize asynchronous domain work on the one SQLite connection while
   * preserving a single BEGIN/COMMIT across awaited ledger/repository calls.
   */
  async transactionAsync<T>(operation: () => Promise<T>): Promise<T> {
    const nested = this.#context.getStore()
    if (nested?.database === this) return await operation()

    const previous = this.#writeTail
    let release!: () => void
    const turn = new Promise<void>(resolveTurn => { release = resolveTurn })
    this.#writeTail = previous.then(() => turn)
    await previous

    this.#asyncTransactionActive = true
    this.db.exec('BEGIN IMMEDIATE')
    const context: TransactionContext = { database: this, afterCommit: [] }
    try {
      const result = await this.#context.run(context, operation)
      this.db.exec('COMMIT')
      this.#asyncTransactionActive = false
      release()
      for (const callback of context.afterCommit) {
        try { callback() } catch { /* observers cannot make a committed transaction appear failed */ }
      }
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      this.#asyncTransactionActive = false
      release()
      throw error
    }
  }

  /** Defer observable notifications until the surrounding transaction commits. */
  afterCommit(callback: () => void): void {
    const context = this.#context.getStore()
    if (context?.database === this) {
      context.afterCommit.push(callback)
      return
    }
    callback()
  }

  close(): void { this.db.close() }
}
