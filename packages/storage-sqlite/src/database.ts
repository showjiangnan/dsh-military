import { mkdirSync, readFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const moduleDir = dirname(fileURLToPath(import.meta.url))

interface TransactionContext {
  readonly database: SqliteMilitaryDatabase
  readonly afterCommit: Array<() => void>
  active: boolean
}

export interface SqliteMilitaryDatabaseOptions {
  readonly path: string
  readonly applyMigrations?: boolean
}

export class SqliteMilitaryDatabase {
  readonly db: DatabaseSync
  readonly #rawDatabase: DatabaseSync
  readonly #context = new AsyncLocalStorage<TransactionContext>()
  #maintenanceDepth = 0

  constructor(options: SqliteMilitaryDatabaseOptions) {
    if (options.path !== ':memory:' && !options.path.startsWith('file:')) {
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
    }
    this.#rawDatabase = new DatabaseSync(options.path)
    this.db = this.#guardDatabase(this.#rawDatabase)
    this.maintenance(() => {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    })
    if (options.applyMigrations !== false) this.migrate()
  }

  migrate(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS military_schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `)
    })
    const migrations = [
      '0001-core.sql',
      '0002-indexes.sql',
      '0003-projections.sql',
      '0004-governance.sql',
      '0005-command-runtime.sql',
      '0006-durable-state.sql',
      '0007-command-results.sql',
      '0008-evaluation-v2.sql',
      '0009-outbox-runtime.sql',
      '0010-command-saga.sql',
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
    if (nested?.database === this) {
      if (!nested.active) {
        throw new TypeError(
          'SQLite transaction context expired after an asynchronous callback yielded',
        )
      }
      const result = operation()
      this.#assertSynchronousResult(result)
      return result
    }
    this.#rawDatabase.exec('BEGIN IMMEDIATE')
    const context: TransactionContext = {
      database: this,
      afterCommit: [],
      active: true,
    }
    try {
      const result = this.#context.run(context, operation)
      this.#assertSynchronousResult(result)
      this.#rawDatabase.exec('COMMIT')
      context.active = false
      for (const callback of context.afterCommit) {
        try {
          callback()
        } catch {
          // Observers cannot make a committed transaction appear failed.
        }
      }
      return result
    } catch (error) {
      try { this.#rawDatabase.exec('ROLLBACK') } catch { /* preserve original */ }
      context.active = false
      throw error
    } finally {
      context.active = false
    }
  }

  /**
   * Execute one synchronous SQLite maintenance statement that SQLite forbids
   * inside a transaction (currently PRAGMA initialization and VACUUM INTO).
   * Normal callers must use transaction(); the guarded public handle
   * automatically wraps every standalone run/exec in a short transaction.
   */
  maintenance<T>(operation: () => T): T {
    const context = this.#context.getStore()
    if (context?.database === this) {
      throw new TypeError(
        'SQLite maintenance cannot run inside a domain transaction',
      )
    }
    this.#maintenanceDepth += 1
    try {
      const result = operation()
      this.#assertSynchronousResult(result)
      return result
    } finally {
      this.#maintenanceDepth -= 1
    }
  }

  /** Defer observable notifications until the surrounding transaction commits. */
  afterCommit(callback: () => void): void {
    const context = this.#context.getStore()
    if (context?.database === this) {
      if (!context.active) {
        throw new TypeError(
          'SQLite transaction context expired before afterCommit registration',
        )
      }
      context.afterCommit.push(callback)
      return
    }
    callback()
  }

  #assertSynchronousResult(result: unknown): void {
    if (
      result !== null
      && (typeof result === 'object' || typeof result === 'function')
      && 'then' in result
    ) {
      throw new TypeError(
        'SQLite transaction callbacks must be synchronous; stage external work as a Saga operation',
      )
    }
  }

  /**
   * Guard the public RC.2 compatibility handle against a subtle async leak:
   * an invalid async transaction callback inherits its ALS context even after
   * rollback. A Statement prepared before the yield must not be able to write
   * later under that expired context. Reads remain available for diagnostics.
   */
  #guardDatabase(database: DatabaseSync): DatabaseSync {
    return new Proxy(database, {
      get: (target, property) => {
        if (property === 'prepare') {
          return (sql: string) => {
            const statement = target.prepare(sql)
            return new Proxy(statement, {
              get: (statementTarget, statementProperty) => {
                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementTarget,
                ) as unknown
                if (typeof value !== 'function') return value
                if (statementProperty === 'run') {
                  return (...args: unknown[]) => {
                    const context = this.#writableContext()
                    if (context !== undefined) {
                      return Reflect.apply(
                        value,
                        statementTarget,
                        args,
                      ) as unknown
                    }
                    if (this.#maintenanceDepth > 0) {
                      if (!VACUUM_INTO_STATEMENT.test(sql)) {
                        throw new TypeError(
                          'SQLite maintenance only permits VACUUM INTO writes',
                        )
                      }
                      return Reflect.apply(
                        value,
                        statementTarget,
                        args,
                      ) as unknown
                    }
                    return this.transaction(() => Reflect.apply(
                      value,
                      statementTarget,
                      args,
                    ) as unknown)
                  }
                }
                return (value as (...args: unknown[]) => unknown)
                  .bind(statementTarget)
              },
            })
          }
        }
        if (property === 'exec') {
          return (sql: string) => {
            const context = this.#writableContext()
            if (context !== undefined) return target.exec(sql)
            if (this.#maintenanceDepth > 0) {
              if (!allowedMaintenanceExec(sql)) {
                throw new TypeError(
                  'SQLite maintenance only permits startup PRAGMA or VACUUM INTO statements',
                )
              }
              return target.exec(sql)
            }
            if (TRANSACTION_CONTROL.test(sql)) {
              throw new TypeError(
                'direct SQLite transaction control is forbidden; use transaction()',
              )
            }
            return this.transaction(() => target.exec(sql))
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
  }

  #writableContext(): TransactionContext | undefined {
    const context = this.#context.getStore()
    if (context?.database === this && !context.active) {
      throw new TypeError(
        'SQLite write attempted from an expired asynchronous transaction context',
      )
    }
    return context?.database === this ? context : undefined
  }

  close(): void { this.#rawDatabase.close() }
}

const TRANSACTION_CONTROL = /^\s*(?:BEGIN(?:\s+IMMEDIATE)?|COMMIT|ROLLBACK)\s*;?\s*$/iu
const VACUUM_INTO_STATEMENT = /^\s*VACUUM\s+INTO\s+\?\s*;?\s*$/iu
const STARTUP_PRAGMA = /^\s*PRAGMA\s+(?:foreign_keys|journal_mode|busy_timeout)\s*=\s*[^;]+\s*$/iu
const VACUUM_INTO_LITERAL = /^\s*VACUUM\s+INTO\s+'(?:[^']|'')*'\s*$/iu

function allowedMaintenanceExec(sql: string): boolean {
  const statements = sql
    .split(';')
    .map(value => value.trim())
    .filter(Boolean)
  return statements.length > 0
    && statements.every(value =>
      STARTUP_PRAGMA.test(value) || VACUUM_INTO_LITERAL.test(value))
}
