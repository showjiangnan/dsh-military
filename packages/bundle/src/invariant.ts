/** Package-owned invariant companion for `@dsh-military/bundle`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/bundle'
export const name = 'dsh-military-bundle-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: Bundle correctness is the RC.2 Loader graph,
 * package closure, and clean-Profile activation result, all of which are
 * finite assembly checks performed by the release E2E gate.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
