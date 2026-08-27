/** Package-owned invariant companion for `@dsh-military/core`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/core'
export const name = 'dsh-military-core-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: Core is transport-independent domain logic whose
 * relations are checked at each mutation boundary and by reducer, transaction,
 * replay, authorization, budget, and verification tests.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
