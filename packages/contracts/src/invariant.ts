/** Package-owned invariant companion for `@dsh-military/contracts`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/contracts'
export const name = 'dsh-military-contracts-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: this package is immutable types, generated catalogs,
 * JSON Schemas, and SQL migrations; generation drift and schema behavior are
 * verified before packaging and expose no continuous in-process relation.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
