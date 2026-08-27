/** Package-owned invariant companion for `@dsh-military/installer`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/installer'
export const name = 'dsh-military-installer-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: installation is an offline atomic filesystem
 * transaction with explicit verification and rollback; it owns no live
 * service after the command exits.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
