/** Package-owned invariant companion for `@dsh-military/storage-sqlite`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/storage-sqlite'
export const name = 'dsh-military-storage-sqlite-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: SQLite atomicity and durability are observable only
 * through transaction fault injection, reopen, migration, unique-key, and
 * projection replay checks, not a continuous Cordis relation.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
