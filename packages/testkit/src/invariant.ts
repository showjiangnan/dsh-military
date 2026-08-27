/** Package-owned invariant companion for `@dsh-military/testkit`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/testkit'
export const name = 'dsh-military-testkit-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: this package provides deterministic test fixtures and
 * owns no production service or event stream.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
